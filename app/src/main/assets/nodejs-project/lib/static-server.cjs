"use strict";

// 通用零依赖静态文件服务器：为"纯静态 + 前端 P2P"的游戏（如中国象棋）提供
// 静态资源服务 + /api/info（局域网地址），无需游戏自建服务器。
// 约定：目录内文件全部可访问，仅拒绝隐藏路径与越界路径。

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg"
};

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(item => item && !item.internal)
    .filter(item => (item.family === "IPv4" || item.family === 4) && !item.address.startsWith("169.254"))
    .map(item => item.address);
}

function createStaticServer(root = __dirname) {
  const rootResolved = path.resolve(root);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      // 通用局域网地址接口（启动页/游戏页均可轮询）
      if (request.method === "GET" && url.pathname === "/api/info") {
        return sendJson(response, 200, { addresses: lanAddresses() });
      }
      // 允许跨源访问（手机浏览器扫 IP 打开）
      if (url.pathname === "/api/info") {
        response.setHeader("Access-Control-Allow-Origin", "*");
      }

      if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "不支持的请求" });

      const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      if (pathname.split("/").some(segment => segment.startsWith("."))) return sendJson(response, 403, { error: "禁止访问" });

      const filename = path.resolve(rootResolved, `.${pathname}`);
      if (!filename.startsWith(rootResolved + path.sep) && filename !== rootResolved) return sendJson(response, 403, { error: "禁止访问" });

      const content = await fs.readFile(filename);
      response.writeHead(200, {
        "Content-Type": MIME[path.extname(filename)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Access-Control-Allow-Origin": "*"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error.code === "ENOENT") return sendJson(response, 404, { error: "资源不存在" });
      if (error instanceof URIError) return sendJson(response, 400, { error: "请求地址无效" });
      sendJson(response, 500, { error: "服务器内部错误" });
    }
  });

  return server;
}

module.exports = { createStaticServer, lanAddresses };
