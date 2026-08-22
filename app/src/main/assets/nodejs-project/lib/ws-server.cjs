"use strict";

// 零依赖 RFC6455 WebSocket 服务器（纯 node:http）。
// 对外接口尽量对齐 npm `ws` 的常用子集：
//   const wss = new WebSocketServer({ server, path })
//   wss.on('connection', ws => { ws.on('message', fn); ws.on('close', fn); ws.on('pong', fn); ws.on('error', fn); ws.send(text); ws.ping(); ws.close(); ws.terminate(); ws.isAlive; ws.readyState; })
//   wss.clients 为 Set<WebSocket>
// 用于把依赖 Express + ws 的服务器改成零 npm 依赖。

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const OPCODE = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class WebSocket extends EventEmitter {
  constructor(socket, request) {
    super();
    this._socket = socket;
    this._request = request;
    this.readyState = 1; // 1=OPEN
    this.isAlive = true;
    this._fragments = [];
    this._fragmentOpcode = -1;
    this._closeSent = false;
    this._closeReceived = false;

    socket.on("data", chunk => this._onData(chunk));
    socket.on("close", () => {
      this.readyState = 3; // CLOSED
      this.emit("close", 1006, "");
    });
    socket.on("error", err => this.emit("error", err));
  }

  _onData(chunk) {
    try {
      this._parseFrames(chunk);
    } catch (err) {
      this.emit("error", err);
      this.terminate();
    }
  }

  _parseFrames(buffer) {
    let offset = 0;
    const length = buffer.length;
    while (offset + 2 <= length) {
      const first = buffer[offset];
      const second = buffer[offset + 1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;
      let cursor = offset + 2;

      if (payloadLength === 126) {
        if (cursor + 2 > length) return;
        payloadLength = buffer.readUInt16BE(cursor);
        cursor += 2;
      } else if (payloadLength === 127) {
        if (cursor + 8 > length) return;
        const big = buffer.readBigUInt64BE(cursor);
        if (big > Number.MAX_SAFE_INTEGER) throw new Error("payload too large");
        payloadLength = Number(big);
        cursor += 8;
      }

      let maskKey = null;
      if (masked) {
        if (cursor + 4 > length) return;
        maskKey = buffer.slice(cursor, cursor + 4);
        cursor += 4;
      }
      if (cursor + payloadLength > length) return;

      let payload = buffer.slice(cursor, cursor + payloadLength);
      if (masked) {
        const out = Buffer.allocUnsafe(payload.length);
        for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ maskKey[i & 3];
        payload = out;
      }

      offset = cursor + payloadLength;
      this._handleFrame(fin, opcode, payload);
    }
  }

  _handleFrame(fin, opcode, payload) {
    if (opcode === OPCODE.TEXT || opcode === OPCODE.BINARY) {
      if (this._fragmentOpcode !== -1) throw new Error("unexpected new data frame during fragmentation");
      if (fin) {
        this._emitMessage(opcode, payload);
      } else {
        this._fragmentOpcode = opcode;
        this._fragments = [payload];
      }
      return;
    }
    if (opcode === OPCODE.CONTINUATION) {
      if (this._fragmentOpcode === -1) throw new Error("unexpected continuation frame");
      this._fragments.push(payload);
      if (fin) {
        const full = Buffer.concat(this._fragments);
        const originalOpcode = this._fragmentOpcode;
        this._fragmentOpcode = -1;
        this._fragments = [];
        this._emitMessage(originalOpcode, full);
      }
      return;
    }
    if (opcode === OPCODE.PING) {
      this.send(payload, OPCODE.PONG);
      return;
    }
    if (opcode === OPCODE.PONG) {
      this.isAlive = true;
      this.emit("pong");
      return;
    }
    if (opcode === OPCODE.CLOSE) {
      this._closeReceived = true;
      this.readyState = 2; // CLOSING
      if (!this._closeSent) this._sendClose(payload.length >= 2 ? payload : Buffer.alloc(0));
      this._socket.end();
      return;
    }
    throw new Error("unknown opcode " + opcode);
  }

  _emitMessage(opcode, payload) {
    if (opcode === OPCODE.TEXT) this.emit("message", payload.toString("utf8"));
    else this.emit("message", payload);
  }

  _frame(opcode, payload) {
    let data;
    if (Buffer.isBuffer(payload)) data = payload;
    else if (ArrayBuffer.isView(payload)) data = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    else data = Buffer.from(String(payload), "utf8");
    const length = data.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode; // FIN + opcode (server frames unmasked)
    return Buffer.concat([header, data]);
  }

  send(data, opcode) {
    if (this.readyState !== 1) return;
    // 与 ws 一致：Buffer/TypedArray 默认发二进制帧，字符串默认发文本帧
    if (opcode === undefined) opcode = Buffer.isBuffer(data) || ArrayBuffer.isView(data) ? OPCODE.BINARY : OPCODE.TEXT;
    this._socket.write(this._frame(opcode, data));
  }

  ping() {
    if (this.readyState === 1) this._socket.write(this._frame(OPCODE.PING, Buffer.alloc(0)));
  }

  _sendClose(payload) {
    this._closeSent = true;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(1000, 0);
    this._socket.write(this._frame(OPCODE.CLOSE, Buffer.concat([body, payload])));
  }

  close() {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    this._sendClose(Buffer.alloc(0));
    this._socket.end();
  }

  terminate() {
    this.readyState = 3;
    this._socket.destroy();
  }
}

// ws 包兼容的状态常量
WebSocket.CONNECTING = 0;
WebSocket.OPEN = 1;
WebSocket.CLOSING = 2;
WebSocket.CLOSED = 3;

class WebSocketServer extends EventEmitter {
  constructor(options) {
    super();
    this.clients = new Set();
    const { server, path } = options || {};

    server.on("upgrade", (request, socket) => {
      if (path && request.url.split("?")[0] !== path) return socket.destroy();
      if (request.headers["upgrade"] === undefined || request.headers.upgrade.toLowerCase() !== "websocket") {
        socket.destroy();
        return;
      }
      const key = request.headers["sec-websocket-key"];
      if (!key) { socket.destroy(); return; }
      const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
      const head = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Accept: " + accept
      ].join("\r\n") + "\r\n\r\n";
      socket.write(head);

      const ws = new WebSocket(socket, request);
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
      this.emit("connection", ws, request);
    });

    server.on("close", () => {
      for (const ws of this.clients) ws.terminate();
      this.clients.clear();
    });
  }
}

module.exports = { WebSocketServer, WebSocket };
