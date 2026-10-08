import { FORBIDDEN, PING_MS, UNAUTHORIZED, type ClientFrame, type ServerFrame } from './wire.ts';

/** The parts of a WebSocket this client uses: the browser's, or the `ws` package's in tests. */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

type Listener = (...args: never[]) => void;

/**
 * A reconnecting game socket with Socket.IO-style events and acks:
 * `on`/`off`/`once`, `emit(event, ...args, ack?)`, and the `connect`, `disconnect` and
 * `connect_error` events. Frames sent while offline wait and go out on the next connect.
 */
export class GameSocket {
  connected = false;
  private ws: WsLike | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private acks = new Map<number, (...args: unknown[]) => void>();
  private queue: string[] = [];
  private nextId = 0;
  private retries = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private open: () => WsLike;
  private opts: { reconnect: boolean };

  constructor(open: () => WsLike, opts: { reconnect: boolean } = { reconnect: true }) {
    this.open = open;
    this.opts = opts;
    this.connect();
  }

  on(event: string, fn: Listener): this {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  once(event: string, fn: Listener): this {
    const wrap = ((...args: never[]) => {
      this.off(event, wrap);
      fn(...args);
    }) as Listener;
    return this.on(event, wrap);
  }

  /** Sends an event. A function as the last argument receives the server's ack. */
  emit(event: string, ...args: unknown[]): this {
    const frame: ClientFrame = { t: 'e', e: event, a: args };
    const last = args.at(-1);
    if (typeof last === 'function') {
      const id = ++this.nextId;
      frame.a = args.slice(0, -1);
      frame.i = id;
      this.acks.set(id, last as (...a: unknown[]) => void);
    }
    this.send(JSON.stringify(frame));
    return this;
  }

  /** Emits and resolves with the ack, or rejects if none comes within `ms`. */
  request<T>(event: string, args: unknown[], ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acks.delete(id);
        reject(new Error('timeout'));
      }, ms);
      this.emit(event, ...args, (res: T) => {
        clearTimeout(timer);
        resolve(res);
      });
      const id = this.nextId;
    });
  }

  connect() {
    if (this.ws) return;
    this.stopped = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    let ws: WsLike;
    try {
      ws = this.open();
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    let live = false;
    ws.onmessage = (ev) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (frame.t === 'h') {
        live = true;
        this.connected = true;
        this.retries = 0;
        this.startPing();
        for (const text of this.queue.splice(0)) ws.send(text);
        this.fire('connect');
      } else if (frame.t === 'e') {
        this.fire(frame.e, ...frame.a);
      } else if (frame.t === 'a') {
        const ack = this.acks.get(frame.i);
        this.acks.delete(frame.i);
        ack?.(...frame.a);
      } else if (frame.t === 'x') {
        this.stopped = true;
        if (this.ws === ws) this.ws = null;
        ws.onclose = null;
        ws.onmessage = null;
        ws.close(1000, frame.m);
        this.fire('connect_error', new Error(frame.m));
      }
    };
    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      this.connected = false;
      this.stopPing();
      if (ev.code === UNAUTHORIZED || ev.code === FORBIDDEN) {
        this.stopped = true;
        this.fire('connect_error', new Error(ev.code === UNAUTHORIZED ? 'unauthorized' : 'forbidden'));
        return;
      }
      if (live) this.fire('disconnect');
      else this.fire('connect_error', new Error('Could not reach the server'));
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* a close event follows */
    };
  }

  disconnect() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.close(1000, 'bye');
      if (this.connected) {
        this.connected = false;
        this.stopPing();
        this.fire('disconnect');
      }
    }
  }

  private send(text: string) {
    if (this.connected && this.ws) this.ws.send(text);
    else this.queue.push(text);
  }

  private fire(event: string, ...args: unknown[]) {
    for (const fn of [...(this.listeners.get(event) ?? [])]) (fn as (...a: unknown[]) => void)(...args);
  }

  private scheduleRetry() {
    if (this.stopped || !this.opts.reconnect || this.retryTimer) return;
    const delay = Math.min(5000, 400 * 2 ** this.retries++) * (0.75 + Math.random() * 0.5);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.ws?.send(JSON.stringify({ t: 'p' } satisfies ClientFrame)), PING_MS);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
