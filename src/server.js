import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './room-manager.js';

const port = Number(process.env.PORT || 3000);
const root = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
const rooms = new RoomManager();
const sockets = new Set();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function serveStatic(request, response, url) {
  const routes = { '/': 'index.html', '/host': 'host.html', '/play': 'play.html' };
  const requested = routes[url.pathname] || url.pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(root, safePath);
  if (!filePath.startsWith(root)) return false;
  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      'content-type': mime[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/healthz') {
    return json(response, 200, { status: 'ok' });
  }

  if (request.method === 'POST' && url.pathname === '/api/rooms') {
    const created = rooms.createRoom();
    return json(response, 201, created);
  }

  if (request.method === 'GET' && url.pathname === '/api/qr') {
    const code = String(url.searchParams.get('room') || '').toUpperCase();
    if (!rooms.getRoom(code)) return json(response, 404, { error: 'ROOM_NOT_FOUND' });
    const publicOrigin = process.env.PUBLIC_ORIGIN || `${url.protocol}//${request.headers.host}`;
    const joinUrl = `${publicOrigin}/play?room=${encodeURIComponent(code)}`;
    response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    response.end(await QRCode.toString(joinUrl, { type: 'svg', margin: 1, color: { dark: '#101114', light: '#FFFFFF' } }));
    return;
  }

  if (request.method === 'GET' && (await serveStatic(request, response, url))) return;
  json(response, 404, { error: 'NOT_FOUND' });
});

const wss = new WebSocketServer({ server, path: '/ws' });

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function broadcastRoom(code) {
  const room = rooms.getRoom(code);
  if (!room) return;
  for (const socket of sockets) {
    if (socket.context?.code !== code) continue;
    send(socket, rooms.publicState(room, socket.context));
  }
}

rooms.on('change', broadcastRoom);

wss.on('connection', (socket) => {
  socket.isAlive = true;
  sockets.add(socket);

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());

      if (message.type === 'host:connect') {
        if (!rooms.isHost(message.room, message.hostToken)) throw new Error('UNAUTHORIZED');
        socket.context = { role: 'host', code: message.room.toUpperCase() };
        return broadcastRoom(socket.context.code);
      }

      if (message.type === 'player:join') {
        const player = rooms.joinPlayer(message.room, message.name, message.resumeToken);
        socket.context = { role: 'player', code: message.room.toUpperCase(), playerId: player.id };
        send(socket, { type: 'joined', playerId: player.id, resumeToken: player.resumeToken, name: player.name });
        return broadcastRoom(socket.context.code);
      }

      if (!socket.context) throw new Error('NOT_CONNECTED');
      const { code, role, playerId } = socket.context;

      if (message.type === 'player:press' && role === 'player') {
        const result = rooms.press(code, playerId);
        return send(socket, { type: 'press:result', ...result });
      }

      if (role !== 'host') throw new Error('UNAUTHORIZED');
      const room = rooms.getRoom(code);
      const hostToken = message.hostToken;
      if (message.type === 'round:start') rooms.startRound(code, hostToken);
      else if (message.type === 'round:reset') rooms.resetRound(code, hostToken);
      else if (message.type === 'round:finish') rooms.finishRound(code, hostToken);
      else if (message.type === 'answer:judge') rooms.judgeAnswer(code, hostToken, Boolean(message.correct));
      else send(socket, { type: 'error', code: 'UNKNOWN_MESSAGE' });
    } catch (error) {
      send(socket, { type: 'error', code: error.message || 'BAD_REQUEST' });
    }
  });

  socket.on('close', () => {
    sockets.delete(socket);
    if (socket.context?.role === 'player') {
      const hasAnotherConnection = [...sockets].some((candidate) =>
        candidate.context?.role === 'player'
        && candidate.context.code === socket.context.code
        && candidate.context.playerId === socket.context.playerId
        && candidate.readyState === WebSocket.OPEN);
      if (!hasAnotherConnection) {
        rooms.setPlayerOnline(socket.context.code, socket.context.playerId, false);
      }
    }
  });
});

const heartbeat = setInterval(() => {
  for (const socket of sockets) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 15_000);

server.on('close', () => clearInterval(heartbeat));
server.listen(port, '0.0.0.0', () => {
  console.log(`Bletbox «Кто первый?» запущен: http://localhost:${port}`);
});
