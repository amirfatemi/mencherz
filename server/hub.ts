import { IDLE, IDLE_MS, type ClientFrame, type ServerFrame } from '../shared/wire.ts';

// A small Socket.IO-like layer over plain WebSockets (see shared/wire.ts), so the same game server
// runs on Node (the `ws` package) and in a Cloudflare Durable Object (WebSocketPair).

/** A connected WebSocket, as the runtime hands it over. */
export interface Conn {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

/** An interface of event handlers, like ClientToServer. */
type EventMap<T> = { [K in keyof T]: (...args: never[]) => void };
type Args<F> = F extends (...args: infer A) => void ? A : never;

export class HubSocket<Listen extends EventMap<Listen>, Emit extends EventMap<Emit>, Data> {
  readonly rooms = new Set<string>();
  readonly handlers = new Map<string, (...args: unknown[]) => void>();
  lastSeen = Date.now();
  readonly id: string;
  readonly conn: Conn;
  data: Data;
  private hub: Hub<Listen, Emit, Data>;

  constructor(id: string, conn: Conn, data: Data, hub: Hub<Listen, Emit, Data>) {
    this.id = id;
    this.conn = conn;
    this.data = data;
    this.hub = hub;
  }

  on<E extends keyof Listen & string>(event: E, fn: Listen[E]): void;
  on(event: 'disconnect', fn: () => void): void;
  on(event: string, fn: (...args: never[]) => void) {
    this.handlers.set(event, fn as (...args: unknown[]) => void);
  }

  join(room: string) {
    this.hub.join(this, room);
  }

  leave(room: string) {
    this.hub.leave(this, room);
  }

  emit<E extends keyof Emit & string>(event: E, ...args: Args<Emit[E]>) {
    this.send({ t: 'e', e: event, a: args });
  }

  send(frame: ServerFrame) {
    try {
      this.conn.send(JSON.stringify(frame));
    } catch {
      // The connection is going away; its close handler cleans up.
    }
  }
}

export class Hub<Listen extends EventMap<Listen>, Emit extends EventMap<Emit>, Data> {
  private sockets = new Map<string, HubSocket<Listen, Emit, Data>>();
  private rooms = new Map<string, Set<HubSocket<Listen, Emit, Data>>>();
  private ids = 0;

  /** Sends to every socket in a room. */
  to(room: string) {
    return {
      emit: <E extends keyof Emit & string>(event: E, ...args: Args<Emit[E]>) => {
        for (const s of this.rooms.get(room) ?? []) s.emit(event, ...args);
      },
    };
  }

  /** Acts on every socket in a room. */
  in(room: string) {
    return {
      socketsLeave: (leave: string) => {
        for (const s of [...(this.rooms.get(room) ?? [])]) s.leave(leave);
      },
    };
  }

  join(s: HubSocket<Listen, Emit, Data>, room: string) {
    s.rooms.add(room);
    let set = this.rooms.get(room);
    if (!set) this.rooms.set(room, (set = new Set()));
    set.add(s);
  }

  leave(s: HubSocket<Listen, Emit, Data>, room: string) {
    s.rooms.delete(room);
    const set = this.rooms.get(room);
    if (!set) return;
    set.delete(s);
    if (!set.size) this.rooms.delete(room);
  }

  /**
   * Takes on a connection whose session has been checked: says hello, lets `onConnection` register
   * its handlers, and returns what the runtime calls on each message and on close.
   */
  attach(conn: Conn, data: Data, onConnection: (s: HubSocket<Listen, Emit, Data>) => void) {
    const s = new HubSocket(`s${++this.ids}`, conn, data, this);
    this.sockets.set(s.id, s);
    onConnection(s);
    s.send({ t: 'h' });
    return {
      message: (text: string) => this.receive(s, text),
      close: () => this.drop(s),
    };
  }

  /** Closes sockets that have stopped pinging, so their players show as away. */
  sweep(now = Date.now()) {
    for (const s of [...this.sockets.values()]) {
      if (now - s.lastSeen <= IDLE_MS) continue;
      try {
        s.conn.close(IDLE, 'idle');
      } catch {
        /* already closed */
      }
      this.drop(s);
    }
  }

  closeAll() {
    for (const s of [...this.sockets.values()]) {
      try {
        s.conn.close(1001, 'server stopping');
      } catch {
        /* already closed */
      }
      this.drop(s);
    }
  }

  private receive(s: HubSocket<Listen, Emit, Data>, text: string) {
    s.lastSeen = Date.now();
    if (text.length > 64 * 1024) return;
    let frame: ClientFrame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (frame?.t !== 'e' || typeof frame.e !== 'string' || !Array.isArray(frame.a) || frame.e === 'disconnect') return;
    const fn = s.handlers.get(frame.e);
    if (!fn) return;
    // Payloads are untrusted; handlers validate them. At most one payload plus the ack.
    const args: unknown[] = frame.a.slice(0, 1);
    const id = frame.i;
    if (typeof id === 'number') args.push((...res: unknown[]) => s.send({ t: 'a', i: id, a: res }));
    try {
      fn(...args);
    } catch (err) {
      console.error(`Handler for ${frame.e} failed:`, err);
    }
  }

  private drop(s: HubSocket<Listen, Emit, Data>) {
    if (!this.sockets.delete(s.id)) return;
    for (const room of [...s.rooms]) this.leave(s, room);
    s.handlers.get('disconnect')?.();
  }
}
