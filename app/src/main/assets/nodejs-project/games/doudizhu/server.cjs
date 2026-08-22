"use strict";

// 斗地主局域网服务器（零依赖版）。取自 Hanazar-Games/Doudizhu-webgame 的 server/index.js，
// 用 lib/ws-server.cjs 替代 express + ws，适配为本宿主 createGameServer(root) -> http.Server 接口。
// 客户端（vite 构建产物，位于本目录 index.html + assets/）通过 ws://<host>/ws 通信。

const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { join: joinPath, extname } = require("node:path");
const { networkInterfaces } = require("node:os");
const { WebSocketServer, WebSocket } = require("../../lib/ws-server.cjs");
const { RoomManager } = require("./room-manager.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
};

function createGameServer(root, { logger = console } = {}) {
  const roomManager = new RoomManager();
  const port = Number(process.env.PORT) || 4174;
  const HOST = "0.0.0.0";

  const sendJson = (response, status, body, extra = {}) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
    response.end(JSON.stringify(body));
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const pathname = url.pathname;

      // ---- HTTP API ----
      if (pathname === "/api/health" && request.method === "GET") {
        return sendJson(response, 200, { status: "ok", rooms: roomManager.rooms.size, mode: "prod", uptime: process.uptime() });
      }
      if (pathname === "/api/lan-info" && request.method === "GET") {
        const urls = Object.values(networkInterfaces()).flat()
          .filter((a) => a && a.family === "IPv4" && !a.internal)
          .map((a) => `http://${a.address}:${port}`);
        return sendJson(response, 200, { port, host: HOST, urls, wsPath: "/ws", mode: "prod" });
      }
      if (pathname === "/api/rooms" && request.method === "GET") {
        return sendJson(response, 200, { rooms: roomManager.getRoomList() });
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
        return;
      }

      // ---- 静态/Spa 服务 ----
      let file = pathname === "/" ? "/index.html" : pathname;
      // SPA fallback：无扩展名且非 /api 的路径返回 index.html
      if (extname(file) === "" && file !== "/index.html") file = "/index.html";
      const filename = joinPath(root, file);
      if (!filename.startsWith(root) || extname(file) === "") {
        // 越界或再次回退到 index.html
        return sendJson(response, 404, { error: "Not found" });
      }
      if (!existsSync(filename)) return sendJson(response, 404, { error: "Not found" });
      const body = await readFile(filename);
      response.writeHead(200, {
        "Content-Type": MIME[extname(filename)] || "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": extname(filename) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      logger?.error(error);
      if (!response.headersSent) sendJson(response, 500, { error: "Internal server error" });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  const generatePeerId = () => "ddz_" + Math.random().toString(36).substr(2, 9);

  const handleMessage = (ws, msg) => {
    const type = msg.type;
    switch (type) {
      case "create_room": {
        roomManager.leaveRoom(ws);
        const peerId = msg.peerId || generatePeerId();
        const room = roomManager.createRoom(ws, peerId);
        roomManager.sendToPeer(ws, { type: "room_created", roomId: room.id, peerId, playerCount: room.players.size });
        logger?.log(`[Room ${room.id}] created by ${peerId}`);
        break;
      }
      case "join_room": {
        const roomId = msg.targetPeerId || msg.roomId;
        const peerId = msg.peerId || generatePeerId();
        if (!roomId) { roomManager.sendToPeer(ws, { type: "error", message: "Room ID is required" }); break; }
        const result = roomManager.joinRoom(ws, roomId, peerId);
        if (!result.success) roomManager.sendToPeer(ws, { type: "error", message: result.error });
        break;
      }
      case "start_game": {
        const roomId = roomManager.playerToRoom.get(ws);
        if (!roomId) return roomManager.sendToPeer(ws, { type: "error", message: "Not in a room" });
        const room = roomManager.rooms.get(roomId);
        if (!room) return;
        if (room.hostId !== roomManager._getPeerIdByWs(room, ws)) return roomManager.sendToPeer(ws, { type: "error", message: "Only host can start" });
        if (room.players.size !== 3) return roomManager.sendToPeer(ws, { type: "error", message: "Need exactly 3 players" });
        if (room.gameStarted) return roomManager.sendToPeer(ws, { type: "error", message: "Game already started" });
        roomManager.startGame(roomId);
        roomManager.broadcastToRoom(room, { type: "game_starting", roomId, playerCount: room.players.size });
        break;
      }
      case "game_start": {
        const roomId = roomManager.playerToRoom.get(ws);
        if (!roomId) return roomManager.sendToPeer(ws, { type: "error", message: "Not in a room" });
        const room = roomManager.rooms.get(roomId);
        if (!room) return roomManager.sendToPeer(ws, { type: "error", message: "Room not found" });
        if (roomManager._getPeerIdByWs(room, ws) !== room.hostId) return roomManager.sendToPeer(ws, { type: "error", message: "Only host can start game" });
        if (room.players.size !== 3) return roomManager.sendToPeer(ws, { type: "error", message: "Need exactly 3 players" });
        if (room.gameStarted) return roomManager.sendToPeer(ws, { type: "error", message: "Game already started" });
        roomManager.startGame(roomId);
        roomManager.relayMessage(ws, msg);
        break;
      }
      case "player_action":
      case "game_state_sync":
      case "request_state_sync":
      case "chat":
        roomManager.relayMessage(ws, msg);
        break;
      default:
        roomManager.sendToPeer(ws, { type: "error", message: "Unknown message type: " + type });
    }
  };

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return roomManager.sendToPeer(ws, { type: "error", message: "Invalid JSON" }); }
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) return roomManager.sendToPeer(ws, { type: "error", message: "Message must be an object" });
      if (typeof msg.type !== "string") return roomManager.sendToPeer(ws, { type: "error", message: "Missing or invalid message type" });
      try { handleMessage(ws, msg); } catch (err) { roomManager.sendToPeer(ws, { type: "error", message: "Internal error" }); }
    });
    ws.on("close", () => roomManager.leaveRoom(ws));
    ws.on("error", (err) => logger?.error(err.message));
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) { roomManager.leaveRoom(ws); ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  heartbeat.unref();
  server.on("close", () => { clearInterval(heartbeat); roomManager.destroy(); });

  return server;
}

module.exports = { createGameServer };
