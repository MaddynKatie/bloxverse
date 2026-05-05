const { WebSocketServer } = require('ws');
const http = require('http');
const url = require('url');

const server = http.createServer((req, res) => {
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

  ws.on('message', (message) => {
    const currentRoom = games.get(gameId);
    if (currentRoom) {
      let isChat = false;
      try {
        const data = JSON.parse(message);
        if (data.type === 'chat') isChat = true;
      } catch (e) {}

      for (const client of currentRoom) {
        if ((client !== ws || isChat) && client.readyState === 1) {
          client.send(message);
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
