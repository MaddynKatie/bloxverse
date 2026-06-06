const { WebSocketServer } = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Store scripts in memory (in production, use a database)
const gameScripts = new Map();

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

  // Default response
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('BloxVerse WebSocket Server Running');
});

const wss = new WebSocketServer({ server });

// gameId -> set of client sockets
const games = new Map();

wss.on('connection', (ws, req) => {
  const parsedUrl = url.parse(req.url, true);
  const { gameId, userIdNum, username, userId } = parsedUrl.query;

  if (!gameId || !userIdNum) {
    ws.close(1008, 'Missing gameId or userIdNum');
    return;
  }

  ws.gameId = gameId;
  ws.userIdNum = Number(userIdNum);
  ws.username = username || 'Player';
  ws.firebaseUid = userId || null; // kept for legacy logging

  if (!games.has(gameId)) {
    games.set(gameId, new Set());
  }
  const room = games.get(gameId);
  room.add(ws);

  function broadcastPlayerList(targetRoom) {
    const players = Array.from(targetRoom).map(c => ({ userIdNum: c.userIdNum, username: c.username, uid: c.firebaseUid }));
    const msg = JSON.stringify({ type: 'playerList', players });
    for (const client of targetRoom) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  console.log(`User ${userIdNum || ws.firebaseUid} joined game ${gameId}. Total in game: ${room.size}`);
  
  broadcastPlayerList(room);
  const joinMsg = JSON.stringify({ type: 'chat', system: true, message: `${ws.username} joined.` });
  for (const client of room) {
    if (client.readyState === 1) client.send(joinMsg);
  }

  ws.on('message', (message) => {
    const currentRoom = games.get(gameId);
    if (currentRoom) {
      let data;
      let isChat = false;
      try {
        data = JSON.parse(message);
        if (data.type === 'chat') {
          isChat = true;
          // Ensure userIdNum is included in chat messages
          if (!data.userIdNum) data.userIdNum = ws.userIdNum;
        }
      } catch (e) {}
      
      const msgToSend = isChat ? JSON.stringify(data) : message;
      
      for (const client of currentRoom) {
        if ((client !== ws || isChat) && client.readyState === 1) {
          client.send(msgToSend);
        }
      }
    }
  });

  ws.on('close', () => {
    const currentRoom = games.get(gameId);
    if (currentRoom) {
      currentRoom.delete(ws);
      if (currentRoom.size === 0) {
        games.delete(gameId);
      } else {
        const leaveMsg = JSON.stringify({ type: 'leave', userIdNum: ws.userIdNum });
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
    console.log(`User ${ws.userIdNum} left game ${gameId}.`);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
