"use strict";

// 骗子酒馆局域网服务器（零依赖版）。
// 取自 Hanazar-Games/Liars-Bar-webgame 的 server.js，由 ESM 转 CJS，
// 用 lib/ws-server.cjs 替代 npm `ws`，并适配为本宿主的
// createGameServer(root) -> http.Server 接口（不自行 listen，由 host.js 决定端口）。

const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { networkInterfaces } = require("node:os");
const { join: joinPath } = require("node:path");
const { randomUUID } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("../../lib/ws-server.cjs");
const { GameEngine } = require("./_cjs/game-engine.cjs");

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AVATARS = ["♠", "☠", "♦", "♣"];
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/game.js", ["game.js", "text/javascript; charset=utf-8"]],
  ["/src/game-engine.js", ["src/game-engine.js", "text/javascript; charset=utf-8"]],
  ["/src/guest-profile.js", ["src/guest-profile.js", "text/javascript; charset=utf-8"]],
  ["/src/i18n.js", ["src/i18n.js", "text/javascript; charset=utf-8"]],
  ["/assets/tavern-bg.png", ["assets/tavern-bg.png", "image/png"]],
]);

function roomCode(rooms) {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ").slice(0, 12);
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function createGameServer(root, { revealDelay = 4200, logger = console } = {}) {
  const rooms = new Map();

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
        return;
      }
      const pathname = new URL(request.url, "http://localhost").pathname;
      const asset = STATIC_FILES.get(pathname);
      if (!asset) { response.writeHead(404).end("Not Found"); return; }
      const [file, type] = asset;
      const body = await readFile(joinPath(root, file));
      response.writeHead(200, {
        "Content-Type": type,
        "Content-Length": body.length,
        "Cache-Control": pathname.endsWith(".png") ? "public, max-age=3600" : "no-cache",
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; script-src 'self'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      logger?.error(error);
      response.writeHead(500).end("Internal Server Error");
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("error", (error) => { if (server.listening) logger?.error(error); });

  function roomView(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      started: Boolean(room.engine),
      players: [...room.members.values()].map(({ id, name, avatar }) => ({ id, name, avatar })),
    };
  }
  function broadcastRoom(room) {
    const view = roomView(room);
    room.members.forEach((member) => send(member.socket, { type: "room", youId: member.id, room: view }));
  }
  function broadcastState(room) {
    if (!room.engine) return;
    room.members.forEach((member) => {
      send(member.socket, { type: "game-state", youId: member.id, room: roomView(room), state: room.engine.viewFor(member.id) });
    });
  }
  function broadcast(room, message) {
    room.members.forEach((member) => send(member.socket, message));
  }
  function requireRoom(socket) {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.members.has(socket.playerId)) throw new Error("你还没有加入房间");
    return room;
  }
  function joinRoom(socket, room, name) {
    if (socket.roomCode) throw new Error("请先离开当前房间");
    if (room.engine) throw new Error("牌局已经开始");
    if (room.members.size >= 4) throw new Error("房间已满");
    const id = randomUUID();
    const usedAvatars = new Set([...room.members.values()].map(({ avatar }) => avatar));
    const member = { id, name, avatar: AVATARS.find((avatar) => !usedAvatars.has(avatar)), socket };
    room.members.set(id, member);
    socket.roomCode = room.code;
    socket.playerId = id;
  }

  function handleMessage(socket, raw) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { throw new Error("消息格式无效"); }
    if (!message || typeof message.type !== "string") throw new Error("消息类型无效");

    if (message.type === "create-room") {
      const name = cleanName(message.name);
      if (!name) throw new Error("请输入玩家昵称");
      const code = roomCode(rooms);
      const room = { code, hostId: null, members: new Map(), engine: null, roundTimer: null };
      rooms.set(code, room);
      joinRoom(socket, room, name);
      room.hostId = socket.playerId;
      broadcastRoom(room);
      return;
    }
    if (message.type === "join-room") {
      const name = cleanName(message.name);
      const code = String(message.code ?? "").trim().toUpperCase();
      if (!name) throw new Error("请输入玩家昵称");
      const room = rooms.get(code);
      if (!room) throw new Error("找不到该房间");
      joinRoom(socket, room, name);
      broadcastRoom(room);
      return;
    }

    const room = requireRoom(socket);
    if (message.type === "start-game") {
      if (room.hostId !== socket.playerId) throw new Error("只有房主可以开始");
      if (room.members.size < 2) throw new Error("至少需要 2 名玩家");
      if (room.engine && room.engine.phase !== "ended") throw new Error("牌局已经开始");
      clearTimeout(room.roundTimer);
      room.engine = new GameEngine([...room.members.values()].map(({ id, name, avatar }) => ({ id, name, avatar })));
      room.engine.start();
      broadcastState(room);
      return;
    }

    if (!room.engine) throw new Error("牌局尚未开始");
    if (message.type === "play") {
      room.engine.play(socket.playerId, message.indices);
      broadcastState(room);
      return;
    }
    if (message.type === "challenge") {
      const result = room.engine.challenge(socket.playerId);
      broadcast(room, { type: "reveal", result });
      broadcastState(room);
      clearTimeout(room.roundTimer);
      room.roundTimer = setTimeout(() => {
        if (room.engine && room.engine.phase !== "reveal") return;
        room.engine.nextRound();
        broadcastState(room);
      }, revealDelay);
      return;
    }
    if (message.type === "leave-room") {
      socket.close(1000, "left room");
      return;
    }
    throw new Error("未知操作");
  }

  function cleanup(socket) {
    if (socket.cleaned) return;
    socket.cleaned = true;
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const member = room.members.get(socket.playerId);
    if (!member) return;
    room.members.delete(socket.playerId);
    if (room.engine) room.engine.forfeit(socket.playerId);
    if (!room.members.size) {
      clearTimeout(room.roundTimer);
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.playerId) room.hostId = room.members.keys().next().value;
    broadcastRoom(room);
    broadcastState(room);
  }

  wss.on("connection", (socket) => {
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
    socket.on("message", (raw) => {
      try { handleMessage(socket, raw); }
      catch (error) { send(socket, { type: "error", message: error.message || "操作失败" }); }
    });
    socket.on("close", () => cleanup(socket));
    socket.on("error", (error) => logger?.error(error));
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (socket.isAlive === false) { socket.terminate(); return; }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30000);
  heartbeat.unref();
  server.on("close", () => clearInterval(heartbeat));

  return server;
}

module.exports = { createGameServer };
