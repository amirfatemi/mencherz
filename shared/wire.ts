// The game's WebSocket protocol: JSON text frames, a small subset of what Socket.IO offered.
//
//   client → server   { t: 'e', e: event, a: args, i?: id }   an event; with `i`, the server answers with an ack
//                     { t: 'p' }                              keep-alive ping
//   server → client   { t: 'h' }                              hello: the session checked out, the socket is live
//                     { t: 'e', e: event, a: args }           an event
//                     { t: 'a', i: id, a: args }              the ack for request `i`
//                     { t: 'x', m: 'unauthorized' | 'forbidden' }  turned away: no or expired session, or a
//                                                             foreign page. The client closes the socket.

export type ClientFrame = { t: 'e'; e: string; a: unknown[]; i?: number } | { t: 'p' };
export type ServerFrame =
  | { t: 'h' }
  | { t: 'e'; e: string; a: unknown[] }
  | { t: 'a'; i: number; a: unknown[] }
  | { t: 'x'; m: 'unauthorized' | 'forbidden' };

export const WS_PATH = '/ws';
/** Close codes. */
export const UNAUTHORIZED = 4401;
export const FORBIDDEN = 4403;
export const IDLE = 4408;
/** The client pings this often; the server drops sockets silent for IDLE_MS. */
export const PING_MS = 20_000;
export const IDLE_MS = 50_000;
