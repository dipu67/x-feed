import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "@/lib/api";

/**
 * Returns the singleton socket connected to the backend. The socket lives for
 * the browser session — pages attach/detach their own listeners but never
 * disconnect the shared instance, so a disconnected socket (e.g. after a
 * backend restart) is revived on the next getSocket() call. The server-side
 * `user:<id>` room join happens on the handshake so anonymous viewers simply
 * don't receive `feed:new` events.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });
  } else if (!socket.connected) {
    // An explicit disconnect() disables socket.io's auto-reconnect; revive
    // the shared instance so a newly mounted page gets a live connection.
    socket.connect();
  }
  return socket;
}
