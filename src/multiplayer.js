import { resolveServerUrl, cacheServerHost } from './servers.js';

let ws = null;
let currentUserId = null;
let onVoiceSignal = null;
let onQueueStatus = null;
let onConnectionLost = null;

// All known Render instances. A node that doesn't host the logical server
// bounces us to the owner with a redirect; an unreachable node is simply
// skipped on the next attempt. No node registry / heartbeat is written to
// Firestore.
const NODE_URLS = ['wss://bloxverse.onrender.com', 'wss://bloxverse-c19f.onrender.com'];
const DEFAULT_SERVER_URL = NODE_URLS[0];
const RETRY_DELAY_MS = 5000;
const CONNECT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

let manualClose = false;
let retryTimer = null;
let connectTimer = null;
let retryCount = 0;
let redirectCount = 0;
let connected = false;
let redirecting = false;
let currentServerUrl = DEFAULT_SERVER_URL;
let reclaimPending = false;

function normalizeWsUrl(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (!/^wss?:\/\//i.test(s)) s = s.replace(/^https?:\/\//i, 'wss://');
  return s.replace(/\/+$/, '');
}

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

// Called when a live connection is lost unexpectedly (game.html shows the
// wifi disconnect overlay instead of silently reconnecting).
export function setOnConnectionLost(cb) {
  onConnectionLost = cb;
}

// HTTP form of whichever node we're currently connected to (used by the
// sendBeacon leave-server endpoint, so the right instance handles it).
export function getServerHttpUrl() {
  return currentServerUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export async function connectMultiplayer(gameId, serverId, userId, username, onPlayerUpdate, onPlayerLeave, onPlayerList, onChatMsg, onPhysicsState, userIdNum) {
  currentUserId = userId;
  manualClose = false;
  retryCount = 0;
  redirectCount = 0;
  redirecting = false;
  connected = false;
  reclaimPending = false;
  clearTimers();
  notifyQueueStatus({ connecting: true });

  // Start at the node that claims this logical server (or a random node for a
  // new one). Redirects and skip-on-failure handle routing from there.
  currentServerUrl = await resolveServerUrl(serverId, NODE_URLS);

  function tryConnect() {
    if (manualClose) return;
    clearTimers();
    const url = `${currentServerUrl}?gameId=${gameId}${serverId ? `&serverId=${serverId}` : ''}&userId=${userId}&username=${encodeURIComponent(username)}${userIdNum ? `&userIdNum=${userIdNum}` : ''}${reclaimPending ? '&reclaim=1' : ''}`;

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
      reclaimPending = false;
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
        if (data.type === 'redirect' && data.url && redirectCount < MAX_REDIRECTS) {
          // This logical server is hosted on another Render instance — switch.
          redirectCount += 1;
          redirecting = true;
          const target = normalizeWsUrl(String(data.url));
          if (target && target !== currentServerUrl) {
            currentServerUrl = target;
            if (serverId) cacheServerHost(serverId, target);
          }
          try { ws.close(); } catch (_) {}
          scheduleRetry(300);
          return;
        }
        if (data.type === 'leave') {
          onPlayerLeave(data.userId);
        } else if (data.type === 'update') {
          onPlayerUpdate(data.userId, data.x, data.y, data.z, data.ry, data.moving, data.grounded, data.climbState, data.qx, data.qy, data.qz, data.qw, data.dead, data.health, data.deathType);
        } else if (data.type === 'updates' && onPlayerUpdate) {
          const players = data.players;
          for (let i = 0; i < players.length; i++) {
            const p = players[i];
            onPlayerUpdate(p.userId, p.x, p.y, p.z, p.ry, p.moving, p.grounded, p.climbState, p.qx, p.qy, p.qz, p.qw, p.dead, p.health, p.deathType);
          }
        } else if (data.type === 'playerList' && onPlayerList) {
          onPlayerList(data.players);
        } else if (data.type === 'chat' && onChatMsg) {
          onChatMsg(data);
        } else if (data.type === 'physicsState' && onPhysicsState) {
          onPhysicsState(data.userId, data.bodies);
        } else if (data.type === 'physicsStates' && onPhysicsState) {
          const states = data.states;
          for (let i = 0; i < states.length; i++) {
            const s = states[i];
            onPhysicsState(s.userId, s.bodies);
          }
        } else if ((data.type === 'voice-offer' || data.type === 'voice-answer' || data.type === 'voice-ice') && onVoiceSignal) {
          onVoiceSignal(data);
        }
      } catch (e) {
        console.error('Error parsing WS message', e);
      }
    };

    ws.onclose = () => {
      if (manualClose) return;
      if (redirecting) { redirecting = false; return; }
      clearTimers();
      if (connected) {
        // Live connection lost — hand it to the page (wifi disconnect overlay).
        connected = false;
        console.log('Disconnected from multiplayer server');
        notifyQueueStatus({ disconnected: true });
        if (onConnectionLost) {
          try { onConnectionLost(); } catch (e) { console.error('[Multiplayer] Connection lost callback error:', e); }
        }
        return;
      }
      // Never connected: skip this node, try the next one.
      advanceNode();
      scheduleRetry(RETRY_DELAY_MS);
    };
  }

  // Move to the next known node. Once we've been redirected and the target is
  // unreachable, ask the next node to take over ownership (reclaim).
  function advanceNode() {
    if (redirectCount > 0) reclaimPending = true;
    const idx = NODE_URLS.indexOf(currentServerUrl);
    currentServerUrl = NODE_URLS[idx === -1 ? 0 : (idx + 1) % NODE_URLS.length];
  }

  function scheduleRetry(delay) {
    if (manualClose) return;
    retryCount += 1;
    notifyQueueStatus({ retry: retryCount });
    retryTimer = setTimeout(() => {
      if (!manualClose) tryConnect();
    }, delay);
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
