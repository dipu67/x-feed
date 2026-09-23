import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "@/lib/api";

/**
 * Returns the singleton socket connected to the backend. Browser reconnects
 * are automatic (`reconnection: true`); the server-side `user:<id>` room
 * join happens on the handshake so anonymous viewers simply don't receive
 * `feed:new` events.
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
  }
  return socket;
}
