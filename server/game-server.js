const fs = require('fs');
const path = require('path');

function luaToJS(lua) {
  const _transforms = [
    (s) => s.replace(/--\[\[[\s\S]*?\]\]/g, ''),
    (s) => s.replace(/--.*$/gm, ''),
    (s) => s.replace(/\{(\s*\w+)\s*=\s*/g, '{$1: '),
    (s) => s.replace(/(,\s*)(\w+)\s*=\s*/g, '$1$2: '),
    (s) => s.replace(/\blocal\s+function\s+(\w+)\s*\(/g, 'function $1('),
    (s) => s.replace(/\bfunction\s+(\w+)\s*\(/g, 'function $1('),
    (s) => s.replace(/(\bfunction\s*\([^)]*\))(?!\s*\{)/g, '$1 {'),
    (s) => s.replace(/^(\s*)end\b/gm, '$1}'),
    (s) => s.replace(/if\s+(?!\()(.*?)\s+then/g, 'if ($1) then'),
    (s) => s.replace(/while\s+(?!\()(.*?)\s+do/g, 'while ($1) {'),
    (s) => s.replace(/elseif\s+(?!\()(.*?)\s+then/g, 'else if ($1) then'),
    (s) => s.replace(/\blocal\s+/g, 'let '),
    (s) => s.replace(/\bthen\b/g, '{'),
    (s) => s.replace(/\belseif\b/g, '} else if'),
    (s) => s.replace(/\belse\b(?!\s*\{)/g, '} else {'),
    (s) => s.replace(/(\w+(?:\.\w+)*):([\w]+)\s*\(/g, '$1.$2('),
    (s) => s.replace(/=\s*\{\}/g, '= []'),
    (s) => {
      let _forIdx = 0;
      const _np = /((?:[^()]|(?:\([^()]*\)))*)/
      const _iv  = new RegExp('for\\s+_,\\s*(\\w+)\\s+in\\s+ipairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
      const _ikv = new RegExp('for\\s+(\\w+)\\s*,\\s*(\\w+)\\s+in\\s+ipairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
      const _ik  = new RegExp('for\\s+(\\w+)\\s+in\\s+ipairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
      const _pkv = new RegExp('for\\s+(\\w+)\\s*,\\s*(\\w+)\\s+in\\s+pairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
      s = s.replace(_iv,  (_m, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<${_e}.length; _ip${_i}++) { let ${_v}=${_e}[_ip${_i}];`; });
      s = s.replace(_ikv, (_m, _k, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<${_e}.length; _ip${_i}++) { let ${_v}=${_e}[_ip${_i}]; let ${_k}=_ip${_i};`; });
      s = s.replace(_ik,  (_m, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<${_e}.length; _ip${_i}++) { let ${_v}=${_e}[_ip${_i}];`; });
      s = s.replace(_pkv, (_m, _k, _v, _e) => { const _i = _forIdx++; return `for (let _pk${_i} in ${_e}) { let ${_v}=${_e}[_pk${_i}]; let ${_k}=_pk${_i};`; });
      return s;
    },
    (s) => {
      let _nfi = 0;
      return s.replace(/for\s+(\w+)\s*=\s*([^,\n]+)\s*,\s*([^,\n{]+?)(?:\s*,\s*([^,\n{]+?))?\s+do/g,
        (_m, _v, _start, _stop, _step) => {
          _nfi++;
          const _st = _step ? _step.trim() : '1';
          const _sn = parseFloat(_st);
          const _cmp = (!isNaN(_sn) && _sn < 0) ? '>=' : '<=';
          return `for (let ${_v}=${_start.trim()}; ${_v}${_cmp}${_stop.trim()}; ${_v}+=(${_st})) {`;
        });
    },
    (s) => s.replace(/\bdo\b(?!\s*\{)/g, '{'),
    (s) => s.replace(/\brepeat\b/g, 'do {'),
    (s) => s.replace(/\buntil\b\s*/g, '} while (!('),
    (s) => s.replace(/\bthen\b/g, '{'),
    (s) => s.replace(/\bend\b\s*$/gm, '}'),
    (s) => s.replace(/\bnot\s+/g, '!'),
    (s) => s.replace(/\band\b/g, '&&'),
    (s) => s.replace(/\bor\b/g, '||'),
    (s) => s.replace(/\bnil\b/g, 'null'),
    (s) => s.replace(/([^.]?)\.\.([^.]?)/g, '$1 + $2'),
    (s) => s.replace(/~=/g, '!=='),
    (s) => s.replace(/(?<![=!<>])===(?!=)/g, '==='),
    (s) => s.replace(/(?<![=!<>])==(?!=)/g, '==='),
    (s) => s.replace(/#(\w+(?:\.\w+)*)/g, '$1.length'),
    (s) => s.replace(/^return\s*\{([^}]*)\}\s*;?\s*$/m, (_match, _inner) =>
      'Object.assign(exports, {' + _inner.replace(/(\w+)\s*:\s*([a-zA-Z_]\w*)/g, (_m, _k, _v) =>
        `${_k}: (typeof ${_v} !== 'undefined' ? ${_v} : exports.${_v})`
      ) + '});'
    ),
    (s) => s.replace(/\bmath\./g, 'Math.'),
    (s) => s.replace(/\btostring\s*\(/g, 'String('),
    (s) => s.replace(/\btonumber\s*\(/g, 'Number('),
    (s) => s.replace(/\bos\.clock\s*\(\s*\)/g, '(Date.now()/1000)'),
    (s) => s.replace(
      /(\w+(?:\s*\.\s*\w+)*(?:\s*\[[^\]]+\])*)\s*([+\-*/%]|\.\.)=\s*/g,
      (_m, _v, _op) => {
        if (_op === '..') return `${_v} = ${_v} + `;
        return `${_v} = ${_v} ${_op} `;
      }
    ),
    (s) => s.replace(/\^=(?=\s|$)/g, '**='),
    (s) => s.replace(
      /(\w+(?:\s*\.\s*\w+)*(?:\s*\[[^\]]+\])*)\s*\/\/=\s*([^;\n]+)/g,
      (_m, _v, _rhs) => `${_v} = Math.floor(${_v} / ${_rhs})`
    ),
  ];
  return _transforms.reduce((acc, fn) => fn(acc), lua);
}

function makeServerAPI(server) {
  const gameApi = {
    _server: server,
    _values: {},
    Broadcast: function(msg) { server.broadcast(msg); },
    SendChat: function(msg) { server.broadcastChat(msg); },
    GetPlayers: function() {
      return server.getPlayers().map(p => ({
        userId: p.userId,
        username: p.username,
        userIdNum: parseInt(p.userId, 36) || 0
      }));
    },
    GetProperty: function(key) { return gameApi._values[key]; },
    SetProperty: function(key, value) { gameApi._values[key] = value; },
    GetGameTime: function() { return Date.now() / 1000; },
  };

  const luaTable = {
    insert: (t, v) => { if (Array.isArray(t)) t.push(v); },
    remove: (t, i) => { if (Array.isArray(t)) { if (i) t.splice(i-1, 1); else t.pop(); } },
    sort: (t, f) => { if (Array.isArray(t)) t.sort(f); },
    concat: (t, sep) => { if (Array.isArray(t)) return t.join(sep || ''); return ''; },
  };

  const luaString = {
    char: (c) => String.fromCharCode(c),
    sub: (s, i, j) => s.substring(i-1, j),
    len: (s) => s.length,
    lower: (s) => s.toLowerCase(),
    upper: (s) => s.toUpperCase(),
    reverse: (s) => s.split('').reverse().join(''),
    split: (s, sep) => s.split(sep),
    byte: (s, i) => s.charCodeAt((i || 1) - 1),
  };

  const luaMath = Object.assign({}, Math);
  luaMath.random = () => { const s = server._randomSeed || Date.now(); server._randomSeed = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (server._randomSeed >>> 0) / 0x100000000; };
  luaMath.randomseed = (seed) => { server._randomSeed = seed; };

  return {
    game: gameApi,
    table: luaTable,
    string: luaString,
    math: luaMath,
    print: (...args) => console.log(`[ServerScript ${server.gameId}]`, ...args),
    warn: (...args) => console.warn(`[ServerScript ${server.gameId}]`, ...args),
    error: (...args) => console.error(`[ServerScript ${server.gameId}]`, ...args),
    wait: (secs) => new Promise(resolve => setTimeout(resolve, secs * 1000)),
    spawn: (fn) => { setTimeout(fn, 0); },
    delay: (secs, fn) => { setTimeout(fn, secs * 1000); },
    typeof: (v) => typeof v,
    ipairs: (t) => { if (!Array.isArray(t)) return []; return t.map((v, i) => [i, v]); },
    pairs: (t) => { return Object.entries(t || {}); },
    Color3: {
      new: (r, g, b) => ({ r, g, b }),
      fromRGB: (r, g, b) => ({ r: r/255, g: g/255, b: b/255 }),
      fromHSV: (h, s, v) => {
        let r = 0, g = 0, b = 0;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
          case 0: r = v; g = t; b = p; break;
          case 1: r = q; g = v; b = p; break;
          case 2: r = p; g = v; b = t; break;
          case 3: r = p; g = q; b = v; break;
          case 4: r = t; g = p; b = v; break;
          case 5: r = v; g = p; b = q; break;
        }
        return { r, g, b };
      }
    },
    Vector3: {
      new: (x, y, z) => ({ x: x || 0, y: y || 0, z: z || 0 }),
    },
  };
}

class GameServer {
  constructor(gameId, room) {
    this.gameId = gameId;
    this._room = room;
    this._scriptsDir = path.join(__dirname, 'games', gameId);
    this._exports = [];
    this._randomSeed = Date.now();

    if (!fs.existsSync(this._scriptsDir)) {
      console.log(`[GameServer ${gameId}] No server scripts directory, skipping`);
      return;
    }

    const files = fs.readdirSync(this._scriptsDir).filter(f => f.endsWith('.lua')).sort();
    if (files.length === 0) {
      console.log(`[GameServer ${gameId}] No .lua files found, skipping`);
      return;
    }

    const api = makeServerAPI(this);
    for (const file of files) {
      const filePath = path.join(this._scriptsDir, file);
      const luaCode = fs.readFileSync(filePath, 'utf8');
      try {
        const jsCode = luaToJS(luaCode);
        const exports = {};
    const fn = new Function(
      'game', 'print', 'warn', 'error', 'wait', 'spawn', 'delay',
      'table', 'string', 'math', '_typeof', 'ipairs', 'pairs',
      'Color3', 'Vector3', 'exports',
      jsCode
    );
    fn(
      api.game, api.print, api.warn, api.error, api.wait, api.spawn, api.delay,
      api.table, api.string, api.math, api.typeof, api.ipairs, api.pairs,
      api.Color3, api.Vector3, exports
    );
        this._exports.push(exports);
        console.log(`[GameServer ${gameId}] Loaded ${file}`);
      } catch (err) {
        console.error(`[GameServer ${gameId}] Error loading ${file}:`, err);
      }
    }

    // Call lifecycle hooks
    setTimeout(() => {
      for (const ex of this._exports) {
        try { ex.onGameStart?.(); } catch (e) { console.error(`[GameServer ${gameId}] onGameStart error:`, e); }
      }
    }, 0);
  }

  broadcast(msg) {
    const data = JSON.stringify({ type: 'chat', system: true, message: msg });
    const clients = Array.from(this._room);
    for (const client of clients) {
      if (client.readyState === 1) client.send(data);
    }
  }

  broadcastChat(msg) {
    this.broadcast(msg);
  }

  getPlayers() {
    return Array.from(this._room).map(c => ({ userId: c.userId, username: c.username }));
  }

  handleChat(userId, message) {
    for (const ex of this._exports) {
      try {
        const playerObj = { userId, userIdNum: parseInt(userId, 36) || 0 };
        const data = { userId, username: '' };
        ex.onChat?.(playerObj, message, data);
      } catch (e) {
        console.error(`[GameServer ${gameId}] onChat error:`, e);
      }
    }
  }

  handlePlayerJoin(userId, username) {
    for (const ex of this._exports) {
      try {
        const playerObj = { userId, userIdNum: parseInt(userId, 36) || 0, username };
        ex.onPlayerJoin?.(playerObj);
      } catch (e) {
        console.error(`[GameServer ${gameId}] onPlayerJoin error:`, e);
      }
    }
  }

  handlePlayerLeave(userId, username) {
    for (const ex of this._exports) {
      try {
        const playerObj = { userId, userIdNum: parseInt(userId, 36) || 0, username };
        ex.onPlayerLeave?.(playerObj);
      } catch (e) {
        console.error(`[GameServer ${gameId}] onPlayerLeave error:`, e);
      }
    }
  }

  destroy() {
    for (const ex of this._exports) {
      try { ex.onDestroy?.(); } catch (e) { console.error(`[GameServer ${gameId}] onDestroy error:`, e); }
    }
    this._exports = [];
  }
}

module.exports = { GameServer };
