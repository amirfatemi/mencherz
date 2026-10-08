import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServer, ServerToClient } from '../../shared/protocol.ts';

export type GameSocket = Socket<ServerToClient, ClientToServer>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  socket ??= io({ withCredentials: true });
  return socket;
}

// A page kept in the back/forward cache would otherwise hold its connection open and look "here".
window.addEventListener('pagehide', () => socket?.disconnect());
window.addEventListener('pageshow', (e) => {
  if (e.persisted) socket?.connect();
});

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

type Listener<E extends keyof ClientToServer> = Parameters<ClientToServer[E]>;
type Payload<E extends keyof ClientToServer> = Listener<E> extends [infer R, unknown] ? [R] : [];
type Result<E extends keyof ClientToServer> = Listener<E> extends [...unknown[], Ack<infer T>] ? T : never;

/** Emits an event and resolves with the server's ack, or rejects with its error message. */
export function call<E extends keyof ClientToServer>(event: E, ...payload: Payload<E>): Promise<Result<E>> {
  return new Promise((resolve, reject) => {
    const s = getSocket() as unknown as {
      timeout(ms: number): { emit(ev: string, ...args: unknown[]): void };
    };
    s.timeout(10_000).emit(event, ...payload, (err: Error | null, res: Parameters<Ack<Result<E>>>[0]) => {
      if (err) return reject(new Error('The server did not answer. Check your connection.'));
      if (res.ok) resolve(res.data);
      else reject(new Error(res.error));
    });
  });
}
