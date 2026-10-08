import type { Ack, ClientToServer } from '../../shared/protocol.ts';
import { GameSocket, type WsLike } from '../../shared/socket-client.ts';
import { WS_PATH } from '../../shared/wire.ts';

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`;
  socket ??= new GameSocket(() => new WebSocket(url) as unknown as WsLike);
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
export async function call<E extends keyof ClientToServer>(event: E, ...payload: Payload<E>): Promise<Result<E>> {
  let res: Parameters<Ack<Result<E>>>[0];
  try {
    res = await getSocket().request(event, payload, 10_000);
  } catch {
    throw new Error('The server did not answer. Check your connection.');
  }
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
