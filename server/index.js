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
  const { gameId, userId } = parsedUrl.query;

  if (!gameId || !userId) {
    ws.close(1008, 'Missing gameId or userId');
    return;
  }

  ws.gameId = gameId;
  ws.userId = userId;

  if (!games.has(gameId)) {
    games.set(gameId, new Set());
  }
  games.get(gameId).add(ws);

  console.log(`User ${userId} joined game ${gameId}. Total in game: ${games.get(gameId).size}`);

  ws.on('message', (message) => {
    const room = games.get(gameId);
    if (room) {
      for (const client of room) {
        // Broadcast to all other players in the room
        if (client !== ws && client.readyState === 1 /* OPEN */) {
          client.send(message);
        }
      }
    }
  });

  ws.on('close', () => {
    const room = games.get(gameId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        games.delete(gameId);
      } else {
        // Tell others that this user left so they can remove their mesh
        const leaveMsg = JSON.stringify({ type: 'leave', userId });
        for (const client of room) {
          if (client.readyState === 1) {
            client.send(leaveMsg);
          }
        }
      }
    }
    console.log(`User ${userId} left game ${gameId}.`);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
