let ws = null;
let currentUserId = null;
let onVoiceSignal = null;

const SERVER_URL = 'wss://bloxverse.onrender.com';

export function connectMultiplayer(gameId, userId, username, onPlayerUpdate, onPlayerLeave, onPlayerList, onChatMsg, onPhysicsState, userIdNum) {
  currentUserId = userId;
  const url = `${SERVER_URL}?gameId=${gameId}&userId=${userId}&username=${encodeURIComponent(username)}${userIdNum ? `&userIdNum=${userIdNum}` : ''}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('Connected to multiplayer server');
  };

  ws.onmessage = async (event) => {
    try {
      let text = event.data;
      if (text instanceof Blob) {
        text = await text.text();
      }
      const data = JSON.parse(text);
      if (data.type === 'leave') {
        onPlayerLeave(data.userId);
      } else if (data.type === 'update') {
        onPlayerUpdate(data.userId, data.x, data.y, data.z, data.ry, data.moving, data.grounded, data.climbState, data.qx, data.qy, data.qz, data.qw, data.dead, data.health, data.deathType);
      } else if (data.type === 'playerList' && onPlayerList) {
        onPlayerList(data.players);
      } else if (data.type === 'chat' && onChatMsg) {
        onChatMsg(data);
      } else if (data.type === 'physicsState' && onPhysicsState) {
        onPhysicsState(data.userId, data.bodies);
      } else if ((data.type === 'voice-offer' || data.type === 'voice-answer' || data.type === 'voice-ice') && onVoiceSignal) {
        onVoiceSignal(data);
      }
    } catch (e) {
      console.error('Error parsing WS message', e);
    }
  };

  ws.onclose = () => {
    console.log('Disconnected from multiplayer server');
  };
}

export function setOnVoiceSignal(cb) {
  onVoiceSignal = cb;
}

export function sendVoiceSignal(type, payload, targetUserId) {
  if (ws && ws.readyState === WebSocket.OPEN && currentUserId) {
    ws.send(JSON.stringify({
      type,
      userId: currentUserId,
      targetUserId,
      ...payload
    }));
  }
}

export function sendChat(message, username, userId, unfiltered = false) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat', username, message, userId, unfiltered }));
  }
}

export function sendLocalTransform(x, y, z, ry, moving, grounded, climbState, qx, qy, qz, qw, dead, health, deathType) {
  if (ws && ws.readyState === WebSocket.OPEN && currentUserId) {
    const payload = JSON.stringify({
      type: 'update',
      userId: currentUserId,
      x, y, z, ry, moving, grounded, climbState, qx, qy, qz, qw, dead, health, deathType
    });
    ws.send(payload);
  }
}

export function sendPhysicsState(bodies) {
  if (ws && ws.readyState === WebSocket.OPEN && currentUserId) {
    ws.send(JSON.stringify({
      type: 'physicsState',
      userId: currentUserId,
      bodies
    }));
  }
}

export function disconnectMultiplayer() {
  if (ws) {
    ws.close();
    ws = null;
  }
}
