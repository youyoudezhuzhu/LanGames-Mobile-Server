"use strict";

// 统一入口：Android 侧通过 nodejs-mobile 启动本文件（node host.js）。
// 由于 nodejs-mobile 在进程内只能启动一次 Node 且无法重启，这里一次性把
// 注册表 games.json 里的所有游戏服务器都拉起，各自绑定独立端口：
//   node host.js                     -> 启动全部游戏
//   node host.js guandan             -> 只启动 guandan
// 每个游戏优先用自己的 server.cjs(createGameServer)，否则回落通用静态服务器。

const path = require("node:path");
const os = require("node:os");
const registry = require("./games.json");

const HOST = process.env.HOST || "0.0.0.0";
const ONLY = (process.argv[2] || "").trim();

const info = (game, msg) => console.log(`[host:${game}] ${msg}`.trim());

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(item => item && !item.internal)
    .filter(item => (item.family === "IPv4" || item.family === 4) && !item.address.startsWith("169.254"))
    .map(item => item.address);
}

function loadServerFor(game) {
  const root = path.join(__dirname, "games", game);
  try {
    return { create: require(path.join(root, "server.cjs")).createGameServer, root };
  } catch (error) {
    return { create: require(path.join(__dirname, "lib", "static-server.cjs")).createStaticServer, root };
  }
}

function startGame(gameId) {
  const entry = registry.games[gameId];
  if (!entry) {
    info(gameId, `unknown game; available: ${Object.keys(registry.games).join(", ")}`);
    return false;
  }
  const { create, root } = loadServerFor(gameId);
  const port = Number(process.env[`PORT_${gameId.toUpperCase()}`]) || entry.port;
  const server = create(root);
  server.on("error", error => info(gameId, `fatal: ${error.message}`));
  server.listen(port, HOST, () => info(gameId, `listening http://0.0.0.0:${port} (${entry.name})`));
  return true;
}

// 目录接口：列出所有游戏及当前地址（供启动页/诊断）
function startCatalog(port) {
  const http = require("node:http");
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/catalog") {
      const addresses = lanAddresses();
      const games = Object.values(registry.games).map(entry => ({
        id: entry.id,
        name: entry.name,
        port: entry.port,
        url: `http://${addresses[0] || "127.0.0.1"}:${entry.port}`
      }));
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ addresses, games }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(port, HOST, () => info("catalog", `listening http://0.0.0.0:${port}`));
}

function main() {
  const catalogPort = Number(process.env.CATALOG_PORT) || 4780;
  startCatalog(catalogPort);
  const targets = ONLY ? [ONLY] : Object.keys(registry.games);
  let started = 0;
  for (const gameId of targets) if (startGame(gameId)) started++;
  if (started === 0) {
    info("all", "no games started");
    process.exit(1);
  }
  info("all", `${started} game server(s) started`);
}

main();
