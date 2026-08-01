let ws = null;
let currentUserId = null;
let onVoiceSignal = null;
let onQueueStatus = null;

const SERVER_URL = 'wss://bloxverse.onrender.com';
const RETRY_DELAY_MS = 5000;
const CONNECT_TIMEOUT_MS = 15000;

let manualClose = false;
let retryTimer = null;
let connectTimer = null;
let retryCount = 0;
let connected = false;

function notifyQueueStatus(status) {
  if (onQueueStatus) {
    try {
      onQueueStatus(status);
    } catch (e) {
      console.error('[Multiplayer] Queue status callback error:', e);
    }
  }
}

function clearTimers() {
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

export function setOnQueueStatus(cb) {
  onQueueStatus = cb;
}

export function getServerHttpUrl() {
  return SERVER_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export function connectMultiplayer(gameId, serverId, userId, username, onPlayerUpdate, onPlayerLeave, onPlayerList, onChatMsg, onPhysicsState, userIdNum) {
  currentUserId = userId;
  manualClose = false;
  retryCount = 0;
  connected = false;
  clearTimers();
  notifyQueueStatus({ connecting: true });

  function tryConnect() {
    if (manualClose) return;
    clearTimers();
    const url = `${SERVER_URL}?gameId=${gameId}${serverId ? `&serverId=${serverId}` : ''}&userId=${userId}&username=${encodeURIComponent(username)}${userIdNum ? `&userIdNum=${userIdNum}` : ''}`;

    ws = new WebSocket(url);

    // If the socket never opens (e.g. server cold start on Render), close and retry
    connectTimer = setTimeout(() => {
      if (!connected && ws && ws.readyState !== WebSocket.OPEN) {
        try { ws.close(); } catch (_) {}
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (manualClose) return;
      connected = true;
      retryCount = 0;
      clearTimers();
      console.log('Connected to multiplayer server');
      notifyQueueStatus({ connected: true });
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
      if (manualClose) return;
      clearTimers();
      if (connected) {
        connected = false;
        console.log('Disconnected from multiplayer server');
        notifyQueueStatus({ disconnected: true });
      } else {
        scheduleRetry();
      }
    };
  }

  function scheduleRetry() {
    if (manualClose) return;
    retryCount += 1;
    notifyQueueStatus({ retry: retryCount });
    retryTimer = setTimeout(() => {
      if (!manualClose) tryConnect();
    }, RETRY_DELAY_MS);
  }

  tryConnect();
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
  manualClose = true;
  clearTimers();
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
}
