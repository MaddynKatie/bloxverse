const { WebSocketServer } = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const { GameServer } = require('./game-server.js');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyA-4DyZMqHgMCme2-hicVg4AV5ax-_fnmY';
const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';

// Store scripts in memory (in production, use a database)
const gameScripts = new Map();

// gameId -> GameServer instance
const gameServers = new Map();

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Handle script API endpoints
  if (pathname.startsWith('/api/game-scripts/') && req.method === 'GET') {
    const gameId = pathname.replace('/api/game-scripts/', '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(gameScripts.get(gameId) || {}));
    return;
  }

  if (pathname === '/api/save-script' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { gameId, scriptName, code, userId } = data;

        if (!gameId || !scriptName || !code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        if (!gameScripts.has(gameId)) {
          gameScripts.set(gameId, {});
        }
        gameScripts.get(gameId)[scriptName] = { code, savedAt: new Date().toISOString(), userId };

        // Also save to filesystem for persistence
        const scriptsDir = path.join(__dirname, '../assets/games', gameId);
        if (!fs.existsSync(scriptsDir)) {
          fs.mkdirSync(scriptsDir, { recursive: true });
        }
        fs.writeFileSync(path.join(scriptsDir, `${scriptName}.lua`), code);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/publish-scripts' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { gameId, scripts, userId } = data;

        if (!gameId || !scripts) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        // Save all scripts
        const scriptsDir = path.join(__dirname, '../assets/games', gameId);
        if (!fs.existsSync(scriptsDir)) {
          fs.mkdirSync(scriptsDir, { recursive: true });
        }

        for (const [scriptName, scriptData] of Object.entries(scripts)) {
          fs.writeFileSync(path.join(scriptsDir, `${scriptName}.lua`), scriptData.code || '');
          if (!gameScripts.has(gameId)) {
            gameScripts.set(gameId, {});
          }
          gameScripts.get(gameId)[scriptName] = {
            code: scriptData.code,
            publishedAt: new Date().toISOString(),
            userId
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, publishedAt: new Date().toISOString() }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── 2FA Endpoints ────────────────────────────────────────────────────────────

  if (pathname === '/api/2fa/setup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, password } = JSON.parse(body);
        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email and password required' }));
          return;
        }

        // Verify password via Firebase Auth REST API
        const signInRes = await fetch(`${FIREBASE_AUTH_URL}:signInWithPassword?key=${FIREBASE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        });
        const signInData = await signInRes.json();
        if (!signInRes.ok) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: signInData.error?.message === 'INVALID_PASSWORD' ? 'Current password is incorrect' : (signInData.error?.message || 'Authentication failed') }));
          return;
        }

        // Generate TOTP secret using otplib
        const secret = authenticator.generateSecret();
        const otpauthUrl = authenticator.keyuri(encodeURIComponent(email), 'BloxVerse', secret);
        const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 200, margin: 1 });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ qr_code: qrCodeDataUrl, secret }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/2fa/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, code, secret } = JSON.parse(body);
        if (!email || !code || !secret) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email, code, and secret required' }));
          return;
        }

        const isValid = authenticator.check(code, secret);
        if (!isValid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid code. Try again.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/2fa/disable' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, password, code, secret } = JSON.parse(body);
        if (!email || !password || !code || !secret) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Email, password, code, and secret required' }));
          return;
        }

        // Verify password
        const signInRes = await fetch(`${FIREBASE_AUTH_URL}:signInWithPassword?key=${FIREBASE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        });
        const signInData = await signInRes.json();
        if (!signInRes.ok) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: signInData.error?.message === 'INVALID_PASSWORD' ? 'Current password is incorrect' : (signInData.error?.message || 'Authentication failed') }));
          return;
        }

        if (!authenticator.check(code, secret)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid code. Try again.' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Default response
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('BloxVerse WebSocket Server Running');
});

const wss = new WebSocketServer({ server });

// gameId -> set of client sockets
const games = new Map();

wss.on('connection', (ws, req) => {
  const parsedUrl = url.parse(req.url, true);
  const { gameId, userId, username } = parsedUrl.query;

  if (!gameId || !userId) {
    ws.close(1008, 'Missing gameId or userId');
    return;
  }

  ws.gameId = gameId;
  ws.userId = userId;
  ws.username = username || 'Player';

  if (!games.has(gameId)) {
    games.set(gameId, new Set());
  }
  const room = games.get(gameId);
  room.add(ws);

  // Initialize GameServer for this game if not already running
  if (!gameServers.has(gameId)) {
    const gs = new GameServer(gameId, room);
    gameServers.set(gameId, gs);
  }
  const gs = gameServers.get(gameId);

  function broadcastPlayerList(targetRoom) {
    const players = Array.from(targetRoom).map(c => ({ userId: c.userId, username: c.username }));
    const msg = JSON.stringify({ type: 'playerList', players });
    for (const client of targetRoom) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  console.log(`User ${userId} joined game ${gameId}. Total in game: ${room.size}`);

  broadcastPlayerList(room);
  const joinMsg = JSON.stringify({ type: 'chat', system: true, message: `${ws.username} joined.` });
  for (const client of room) {
    if (client.readyState === 1) client.send(joinMsg);
  }

  // Notify game server script
  gs.handlePlayerJoin(userId, ws.username);

  ws.on('message', (message) => {
    const currentRoom = games.get(gameId);
    if (!currentRoom) return;

    let data;
    let isChat = false;
    let isVoice = false;
    try {
      data = JSON.parse(message);
      if (data.type === 'chat') {
        isChat = true;
        if (!data.userId) data.userId = userId;

        // Route to server-side game script for processing
        if (data.message && typeof data.message === 'string') {
          gs.handleChat(data.userId, data.message);
        }
      } else if (data.type === 'voice-offer' || data.type === 'voice-answer' || data.type === 'voice-ice') {
        isVoice = true;
        if (!data.userId) data.userId = userId;
      }
    } catch (e) {}

    const msgToSend = isChat ? JSON.stringify(data) : message;

    for (const client of currentRoom) {
      if (client.readyState !== 1) continue;
      // Send back to sender for chat; for voice/others, skip sender unless targeted relay should still exclude sender
      if (client === ws && !isChat) continue;
      // Targeted relay: if payload specifies targetUserId, only send to that peer
      if (isVoice && data.targetUserId && client.userId !== data.targetUserId) continue;
      client.send(msgToSend);
    }
  });

  ws.on('close', () => {
    const currentRoom = games.get(gameId);
    if (currentRoom) {
      currentRoom.delete(ws);
      gs.handlePlayerLeave(userId, ws.username);
      if (currentRoom.size === 0) {
        games.delete(gameId);
        const oldGs = gameServers.get(gameId);
        if (oldGs) {
          oldGs.destroy();
          gameServers.delete(gameId);
          console.log(`[GameServer ${gameId}] Destroyed (no players left)`);
        }
      } else {
        const leaveMsg = JSON.stringify({ type: 'leave', userId });
        const chatMsg = JSON.stringify({ type: 'chat', system: true, message: `${ws.username} left.` });
        for (const client of currentRoom) {
          if (client.readyState === 1) {
            client.send(leaveMsg);
            client.send(chatMsg);
          }
        }
        broadcastPlayerList(currentRoom);
      }
    }
    console.log(`User ${userId} left game ${gameId}.`);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
