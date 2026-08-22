/**
 * 万能麻将 - 局域网信令服务器
 * Node.js 原生 HTTP + SSE，零外部依赖
 * 只负责 WebRTC SDP/ICE 交换，游戏数据通过 DataChannel P2P 传输
 *
 * 启动: node server/signaling-server.js [端口]
 * 默认端口: 8081
 */

const http = require('http');
const url = require('url');
const os = require('os');
const fs = require('fs');
const pathMod = require('path');

let STATIC_ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};
// 静态资源服务（独立函数，避免与 handler 内的局部变量 path 冲突）
async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.includes('..')) return false;
  const file = pathMod.join(STATIC_ROOT, rel);
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    const ext = pathMod.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
    return true;
  } catch { return false; }
}

const PORT = parseInt(process.argv[2]) || 8081;
const isDev = process.env.NODE_ENV !== 'production';
const devLog = isDev ? console.log.bind(console) : () => {};
const devWarn = isDev ? console.warn.bind(console) : () => {};

// ===== 安全配置 =====
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080').split(',').map(s => s.trim());
const MAX_BODY_SIZE = parseInt(process.env.MAX_BODY_SIZE) || 65536; // 64KB
const ALLOWED_MESSAGE_TYPES = new Set(['sdp-offer', 'sdp-answer', 'ice-candidate']);

// ===== 内存状态 =====
const rooms = new Map();   // roomId -> Room
const players = new Map(); // playerId -> { roomId, name, isHost, res, lastEventId }
let nextMsgId = 1;

// ===== 速率限制 =====
const rateLimits = new Map(); // ip -> { count, resetTime }
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分钟
const RATE_LIMIT_MAX = 60; // 每分钟最多60请求
const MAX_SSE_PER_IP = 5; // 每IP最多5个SSE连接

function checkRateLimit(ip) {
    const now = Date.now();
    const limit = rateLimits.get(ip);
    if (!limit || now > limit.resetTime) {
        rateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return true;
    }
    if (limit.count >= RATE_LIMIT_MAX) return false;
    limit.count++;
    return true;
}

function getIpSSECount(ip) {
    let count = 0;
    for (const p of players.values()) {
        if (p._clientIP === ip && p.res) count++;
    }
    return count;
}

// ===== 工具函数 =====
function getCorsOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return null;
    return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function jsonResponse(res, status, data, req) {
    const headers = {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
    };
    const corsOrigin = getCorsOrigin(req);
    if (corsOrigin) {
        headers['Access-Control-Allow-Origin'] = corsOrigin;
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(data));
}

function readBody(req, maxSize = MAX_BODY_SIZE) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > maxSize) {
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
        });
        req.on('error', reject);
    });
}

function broadcast(roomId, msg, excludePlayerId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const msgWithId = { ...msg, id: nextMsgId++ };
    room.messages.push(msgWithId);
    if (room.messages.length > 200) room.messages = room.messages.slice(-100);

    for (const pid of room.playerIds) {
        if (pid === excludePlayerId) continue;
        const p = players.get(pid);
        if (p && p.res && !p.res.writableEnded) {
            try { p.res.write(`data: ${JSON.stringify(msgWithId)}\n\n`); }
            catch (e) { /* SSE 写入失败 */ }
        }
    }
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || 'unknown';
}

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const maxAttempts = 100;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let id = '';
        for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
        if (!rooms.has(id)) return id;
    }
    throw new Error('无法生成唯一房间ID');
}

function generatePlayerId() {
    return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ===== 清理过期房间（每60秒） =====
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [roomId, room] of rooms) {
        if (room.lastActivity < cutoff) {
            for (const pid of room.playerIds) {
                const p = players.get(pid);
                if (p && p.res && !p.res.writableEnded) {
                    try { p.res.end(); } catch (e) {}
                }
                players.delete(pid);
            }
            rooms.delete(roomId);
            devLog(`[清理] 房间 ${roomId} 已过期删除`);
        }
    }
}, 60 * 1000);

// ===== HTTP 服务器 =====
const server = http.createServer(async (req, res) => {
    const clientIP = getClientIP(req);

    // 速率限制
    if (!checkRateLimit(clientIP)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many requests' }));
        return;
    }

    // CORS
    const corsOrigin = getCorsOrigin(req);
    if (corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const parsed = url.parse(req.url, true);
    const path = parsed.pathname;

    try {
        // --- GET /rooms ---
        if (path === '/rooms' && req.method === 'GET') {
            const list = [];
            for (const [id, room] of rooms) {
                if (room.started) continue; // 已开始的不显示
                const pinfos = room.playerIds.map(pid => {
                    const p = players.get(pid);
                    return { id: pid, name: p?.name || '未知', isHost: p?.isHost || false };
                });
                list.push({ id, name: room.name, type: room.mahjongType,
                    players: room.playerIds.length, maxPlayers: room.maxPlayers, pinfos });
            }
            jsonResponse(res, 200, { rooms: list }, req);
            return;
        }

        // --- POST /room/create ---
        if (path === '/room/create' && req.method === 'POST') {
            const body = await readBody(req);
            const roomId = generateRoomId();
            const playerId = generatePlayerId();
            const room = {
                id: roomId, name: String(body.name || '麻将房').slice(0, 20),
                mahjongType: body.mahjongType || 'guangdong',
                maxPlayers: Math.min(4, Math.max(2, parseInt(body.maxPlayers) || 4)),
                playerIds: [playerId], messages: [], createdAt: Date.now(),
                lastActivity: Date.now(), started: false
            };
            rooms.set(roomId, room);
            players.set(playerId, {
                roomId, name: String(body.playerName || '房主').slice(0, 12),
                isHost: true, res: null, lastEventId: 0
            });
            devLog(`[创建] 房间 ${roomId} 来自 ${getClientIP(req)}`);
            jsonResponse(res, 200, { roomId, playerId, isHost: true }, req);
            return;
        }

        // --- POST /room/:id/join ---
        const joinMatch = path.match(/^\/room\/([a-zA-Z0-9_-]+)\/join$/);
        if (joinMatch && req.method === 'POST') {
            const roomId = joinMatch[1];
            const room = rooms.get(roomId);
            if (!room) { jsonResponse(res, 404, { error: '房间不存在' }, req); return; }
            if (room.started) { jsonResponse(res, 403, { error: '游戏已开始' }, req); return; }
            if (room.playerIds.length >= room.maxPlayers) {
                jsonResponse(res, 403, { error: '房间已满' }, req); return;
            }
            const body = await readBody(req);
            const playerId = generatePlayerId();
            room.playerIds.push(playerId);
            room.lastActivity = Date.now();
            players.set(playerId, {
                roomId, name: String(body.playerName || '玩家').slice(0, 12),
                isHost: false, res: null, lastEventId: 0
            });
            broadcast(roomId, {
                type: 'playerJoined', playerId,
                name: players.get(playerId).name,
                count: room.playerIds.length,
                maxPlayers: room.maxPlayers
            });
            devLog(`[加入] ${playerId} -> 房间 ${roomId}`);
            jsonResponse(res, 200, { roomId, playerId, isHost: false }, req);
            return;
        }

        // --- GET /room/:id/events (SSE) ---
        const eventsMatch = path.match(/^\/room\/([a-zA-Z0-9_-]+)\/events$/);
        if (eventsMatch && req.method === 'GET') {
            const roomId = eventsMatch[1];
            const playerId = parsed.query.playerId;
            const p = players.get(playerId);
            if (!p || p.roomId !== roomId) {
                res.writeHead(403, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': corsOrigin });
                res.end('Forbidden'); return;
            }
            // SSE连接数限制
            if (getIpSSECount(clientIP) >= MAX_SSE_PER_IP) {
                res.writeHead(429, { 'Content-Type': 'text/plain' });
                res.end('Too many SSE connections'); return;
            }
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            res.write(':ok\n\n');
            // 清除旧离线通知timer，防止快速重连时错误广播离线
            if (p.offlineTimeout) { clearTimeout(p.offlineTimeout); p.offlineTimeout = null; }
            p.res = res;
            p._clientIP = clientIP;
            p.lastEventId = parseInt(parsed.query.lastId) || 0;
            const room = rooms.get(roomId);
            room.lastActivity = Date.now();

            // 补发历史消息
            for (const msg of room.messages) {
                if (msg.id > p.lastEventId) {
                    try { res.write(`data: ${JSON.stringify(msg)}\n\n`); }
                    catch (e) {}
                }
            }

            // 向新连接玩家发送当前房间中所有其他玩家信息
            for (const pid of room.playerIds) {
                if (pid === playerId) continue;
                const other = players.get(pid);
                if (other) {
                    try {
                        res.write(`data: ${JSON.stringify({
                            type: 'playerOnline',
                            playerId: pid,
                            name: other.name,
                            isHost: other.isHost
                        })}\n\n`);
                    } catch (e) {}
                }
            }

            // 通知其他人此玩家上线
            broadcast(roomId, { type: 'playerOnline', playerId, name: p.name }, playerId);

            // SSE 心跳（25秒）
            const heartbeat = setInterval(() => {
                if (res.writableEnded) { clearInterval(heartbeat); return; }
                try { res.write(`:ping\n\n`); }
                catch (e) { clearInterval(heartbeat); }
            }, 25000);

            req.on('error', () => {
                clearInterval(heartbeat);
            });
            req.on('close', () => {
                clearInterval(heartbeat);
                p.res = null;
                if (p.offlineTimeout) clearTimeout(p.offlineTimeout);
                p.offlineTimeout = setTimeout(() => {
                    p.offlineTimeout = null;
                    const cp = players.get(playerId);
                    if (cp && !cp.res) {
                        broadcast(roomId, { type: 'playerOffline', playerId, name: cp.name });
                    }
                }, 1500);
            });
            return;
        }

        // --- POST /room/:id/send ---
        const sendMatch = path.match(/^\/room\/([a-zA-Z0-9_-]+)\/send$/);
        if (sendMatch && req.method === 'POST') {
            const roomId = sendMatch[1];
            const body = await readBody(req);
            const room = rooms.get(roomId);
            if (!room) { jsonResponse(res, 404, { error: '房间不存在' }, req); return; }
            const p = players.get(body.playerId);
            if (!p || p.roomId !== roomId) { jsonResponse(res, 403, { error: '无效玩家' }, req); return; }
            if (!ALLOWED_MESSAGE_TYPES.has(body.type)) {
                jsonResponse(res, 400, { error: 'Invalid message type' }, req); return;
            }
            // 校验 targetId 合法性（如果存在）
            const targetId = body.data?.targetId;
            if (targetId && !room.playerIds.includes(targetId)) {
                jsonResponse(res, 400, { error: 'Invalid targetId' }, req); return;
            }
            room.lastActivity = Date.now();
            broadcast(roomId, {
                type: body.type,
                from: body.playerId, fromName: p.name,
                data: body.data || {}
            }, body.excludeSelf ? body.playerId : null);
            jsonResponse(res, 200, { ok: true }, req);
            return;
        }

        // --- POST /room/:id/start ---
        const startMatch = path.match(/^\/room\/([a-zA-Z0-9_-]+)\/start$/);
        if (startMatch && req.method === 'POST') {
            const roomId = startMatch[1];
            const body = await readBody(req);
            const room = rooms.get(roomId);
            if (!room) { jsonResponse(res, 404, { error: '房间不存在' }, req); return; }
            const p = players.get(body.playerId);
            if (!p || !p.isHost) { jsonResponse(res, 403, { error: '只有房主可以开始' }, req); return; }
            if (room.playerIds.length < 2) { jsonResponse(res, 403, { error: '至少需要2人' }, req); return; }
            room.started = true;
            broadcast(roomId, { type: 'gameStart', from: body.playerId, config: body.config || {} });
            devLog(`[开始] 房间 ${roomId} 游戏开始 (${room.playerIds.length}人)`);
            jsonResponse(res, 200, { ok: true }, req);
            return;
        }

        // --- POST /room/:id/leave ---
        const leaveMatch = path.match(/^\/room\/([a-zA-Z0-9_-]+)\/leave$/);
        if (leaveMatch && req.method === 'POST') {
            const roomId = leaveMatch[1];
            const body = await readBody(req);
            const p = players.get(body.playerId);
            if (!p || p.roomId !== roomId) {
                jsonResponse(res, 403, { error: 'Forbidden' }, req);
                return;
            }
            const room = rooms.get(roomId);
            if (room) {
                room.playerIds = room.playerIds.filter(id => id !== body.playerId);
                broadcast(roomId, { type: 'playerLeft', playerId: body.playerId, count: room.playerIds.length });
                if (room.playerIds.length === 0) {
                    rooms.delete(roomId);
                    devLog(`[解散] 房间 ${roomId} 无人，自动删除`);
                }
            }
            if (p.res && !p.res.writableEnded) { try { p.res.end(); } catch (e) {} }
            players.delete(body.playerId);
            jsonResponse(res, 200, { ok: true }, req);
            return;
        }

        if (await serveStatic(req, res, path)) return;
        jsonResponse(res, 404, { error: 'Not Found' }, req);
    } catch (e) {
        console.error('[错误]', e.message);
        if (e.message === 'Request body too large') {
            jsonResponse(res, 413, { error: 'Request body too large' }, req);
        } else {
            jsonResponse(res, 500, { error: 'Internal Server Error' }, req);
        }
    }
});

// 适配宿主接口：createGameServer(root) -> http.Server（不自行 listen）
function createGameServer(root) {
  STATIC_ROOT = root;
  return server;
}

module.exports = { createGameServer };
