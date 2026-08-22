"use strict";

// 3D 台球局域网服务器（零依赖版）。取自 Hanazar-Games/Billiards 的 server/lan-server.js，
// 用 lib/ws-server.cjs 替代 npm `ws`，同时服务 dist/ 静态资源 + WebSocket 中继，
// 适配为本宿主 createGameServer(root) -> http.Server 接口。
// 客户端通过 ws://<当前页面 host>（无 /ws 路径）连入；host.js 启动时用游戏端口。

const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { join: joinPath, extname } = require("node:path");
const { WebSocketServer, WebSocket } = require("../../lib/ws-server.cjs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".glb": "model/gltf-binary",
};

function createGameServer(root, { logger = console } = {}) {
  const rooms = new Map();

  function generateRoomId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";
    const len = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }
  function ensureUniqueRoomId() {
    let id;
    do { id = generateRoomId(); } while (rooms.has(id));
    return id;
  }

  function send(ws, msg) {
    let payload;
    try { payload = JSON.stringify(msg); } catch { return; }
    if (ws && ws.readyState === 1) ws.send(payload);
  }

  class Room {
    constructor(id, hostWs) {
      this.id = id;
      this.host = hostWs;
      this.guests = new Map();
      this.nextGuestId = 2;
      this.started = false;
      this.maxPlayers = 2;
    }
    addGuest(ws, nickname = "") {
      const guestId = this.nextGuestId++;
      const info = { id: guestId, nickname: nickname || `玩家 ${guestId}` };
      this.guests.set(ws, info);
      return info;
    }
    removeGuest(ws) {
      const info = this.guests.get(ws);
      if (info) { this.guests.delete(ws); this.broadcast({ type: "playerLeft", playerId: info.id }); }
    }
    getPlayerList() {
      const list = [{ id: 1, nickname: "Host", isHost: true }];
      for (const info of this.guests.values()) list.push({ id: info.id, nickname: info.nickname, isHost: false });
      return list;
    }
    broadcast(msg, excludeWs = null) {
      let payload;
      try { payload = JSON.stringify(msg); } catch { return; }
      if (this.host && this.host !== excludeWs && this.host.readyState === 1) this.host.send(payload);
      for (const [ws] of this.guests) if (ws !== excludeWs && ws.readyState === 1) ws.send(payload);
    }
    sendToHost(msg) {
      let payload;
      try { payload = JSON.stringify(msg); } catch { return; }
      if (this.host && this.host.readyState === 1) this.host.send(payload);
    }
    sendToGuest(guestWs, msg) {
      let payload;
      try { payload = JSON.stringify(msg); } catch { return; }
      if (guestWs && guestWs.readyState === 1) guestWs.send(payload);
    }
  }

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && (pathname === "/api/health" || pathname === "/health")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end("Method Not Allowed");
        return;
      }
      // 静态：dist/ 内容位于 root
      let rel = pathname === "/" ? "/index.html" : pathname;
      if (rel.includes("..")) { res.writeHead(403); res.end("Forbidden"); return; }
      const filename = joinPath(root, rel);
      if (!existsSync(filename)) { res.writeHead(404); res.end("Not Found"); return; }
      const body = await readFile(filename);
      res.writeHead(200, {
        "Content-Type": MIME[extname(filename)] || "application/octet-stream",
        "Cache-Control": extname(filename) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      logger?.error(error);
      if (!res.headersSent) { res.writeHead(500); res.end("Internal Server Error"); }
    }
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    ws._room = null;
    ws._isHost = false;
    ws._playerId = null;

    ws.on("message", (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch { send(ws, { type: "error", error: "Invalid JSON" }); return; }
      if (!data || typeof data !== "object") { send(ws, { type: "error", error: "Invalid message format" }); return; }
      const { type } = data;

      if (type === "createRoom") {
        if (ws._room) { send(ws, { type: "error", error: "Already in a room" }); return; }
        const roomId = ensureUniqueRoomId();
        const room = new Room(roomId, ws);
        rooms.set(roomId, room);
        ws._room = room; ws._isHost = true; ws._playerId = 1;
        send(ws, { type: "roomCreated", roomId, playerId: 1, maxPlayers: room.maxPlayers, playerList: room.getPlayerList() });
        return;
      }

      if (type === "joinRoom") {
        if (ws._room) { send(ws, { type: "error", error: "Already in a room" }); return; }
        const roomId = String(data.roomId || "").toUpperCase().trim();
        const room = rooms.get(roomId);
        if (!room) { send(ws, { type: "error", error: "Room not found" }); return; }
        if (room.started) { send(ws, { type: "error", error: "Game already started" }); return; }
        if (room.guests.size >= room.maxPlayers - 1) { send(ws, { type: "error", error: "Room is full" }); return; }
        const info = room.addGuest(ws, data.nickname);
        ws._room = room; ws._isHost = false; ws._playerId = info.id;
        send(ws, { type: "joinedRoom", roomId, playerId: info.id, maxPlayers: room.maxPlayers, playerList: room.getPlayerList() });
        room.broadcast({ type: "playerJoined", playerId: info.id, nickname: info.nickname, maxPlayers: room.maxPlayers, playerList: room.getPlayerList() }, ws);
        return;
      }

      if (type === "startGame") {
        const room = ws._room;
        if (!room || !ws._isHost) { send(ws, { type: "error", error: "Only host can start game" }); return; }
        room.started = true;
        room.broadcast({ type: "startGame", mode: data.mode || "8ball", tableProfileId: data.tableProfileId || "pool9ft", startedBy: ws._playerId });
        return;
      }

      if (type === "leaveRoom") {
        const room = ws._room;
        if (!room) return;
        if (ws._isHost) {
          room.broadcast({ type: "roomClosed", reason: "hostLeft" });
          for (const [gws] of room.guests) { gws._room = null; gws._isHost = false; gws._playerId = null; gws.close(); }
          rooms.delete(room.id);
        } else {
          room.removeGuest(ws);
        }
        ws._room = null; ws._isHost = false; ws._playerId = null;
        return;
      }

      const room = ws._room;
      if (!room) { send(ws, { type: "error", error: "Not in a room" }); return; }

      switch (type) {
        case "shotInput":
          if (ws._isHost) room.broadcast({ ...data, fromHost: true }, ws);
          else room.sendToHost({ ...data, fromPlayer: ws._playerId });
          break;
        case "stateSnapshot":
        case "turnResolved":
        case "pocketEvent":
          if (!ws._isHost) { send(ws, { type: "error", error: "Only host may broadcast" }); return; }
          room.broadcast({ ...data, fromHost: true }, ws);
          break;
        case "pushOutDeclare":
        case "pushOutChoice":
          if (ws._isHost) room.broadcast({ ...data, fromHost: true }, ws);
          else room.sendToHost({ ...data, fromPlayer: ws._playerId });
          break;
        case "chat":
        case "ping":
          room.broadcast({ ...data, fromPlayer: ws._playerId }, ws);
          break;
        default:
          break;
      }
    });

    ws.on("close", () => {
      const room = ws._room;
      if (!room) return;
      if (ws._isHost) {
        room.broadcast({ type: "roomClosed", reason: "hostDisconnected" });
        for (const [gws] of room.guests) { gws._room = null; gws.close(); }
        rooms.delete(room.id);
      } else {
        room.removeGuest(ws);
        if (room.guests.size === 0 && !room.started) { if (room.host) room.host._room = null; rooms.delete(room.id); }
      }
    });
    ws.on("error", (err) => logger?.warn("WebSocket error:", err.message));
  });

  return server;
}

module.exports = { createGameServer };
