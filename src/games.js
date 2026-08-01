import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db, getGameStats } from './firebase.js';

export const games = [
  {
    id: 'demo',
    name: 'Demo',
    official: true,
    creator: 1,
    icon: './assets/icons/demo.png',
    mapPath: './js/parts.js',
    description: 'A blank canvas to explore the BloxVerse engine. Run around and test the physics, climbing, and building tools!',
    category: 'Sandbox',
    maxPlayers: 6,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/05/03',
  },
  {
    id: 'bvbaseplate',
    name: 'Bloxverse Baseplate',
    official: true,
    creator: 1,
    icon: './assets/icons/demo.png',
    mapPath: './assets/models/bvBaseplate.json',
    scriptsPath: './assets/games/bvbaseplate',
    description: 'A simple baseplate with structures to explore. Great for testing your scripts and learning the engine.',
    category: 'Sandbox',
    maxPlayers: 6,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/05/03',
  },
  {
    id: 'classichouse',
    name: 'Classic House',
    official: true,
    creator: 1,
    icon: './assets/icons/classichouse.png',
    mapPath: './assets/models/classichouse.json',
    scriptsPath: './assets/games/classichouse',
    mapOffset: { x: 0, y: 28, z: 0 },
    spawn: { x: 11, y: 1.60, z: 46.32 },
    description: 'Explore a beautifully crafted classic house with multiple rooms, furniture, and a cozy atmosphere.',
    category: 'Exploration',
    maxPlayers: 6,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/05/03',
  },
  {
    id: 'touchfootball',
    name: 'Touch Football',
    official: true,
    creator: 1,
    icon: './assets/icons/touchfootball.png',
    mapPath: './assets/models/touchfootballMap.json',
    scriptsPath: './assets/games/touchfootball',
    description: 'Team up and play touch football on a custom-built field. Score goals and dominate the leaderboard!',
    category: 'Sports',
    maxPlayers: 12,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/05/09',
  },
  {
    id: 'snowypeaks',
    name: 'Snowy Peaks',
    official: true,
    creator: 1,
    icon: './assets/icons/snowypeak.png',
    mapPath: './assets/models/snowypeak.json',
    scriptsPath: './assets/games/snowypeaks',
    spawn: { x: -99.37, y: 17, z: -7.95, ry: Math.PI / 2 },
    effects: { snow: true },
    maxPlayers: 6,
    worldFloor: false,
    respawnY: -200,
    description: 'Climb up this snowy mountain and enjoy the scenic views. Watch out for slippery slopes and broken ladders!',
    category: 'Exploration',
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/05/11',
  },
  {
    id: 'crossbridges',
    name: 'The Crossbridges',
    official: true,
    creator: 1,
    icon: './assets/icons/crossbridges.png',
    mapPath: './js/crossbridges.js',
    scriptsPath: './assets/games/crossbridges',
    description: 'A game featuring towering bridges crossing over each other and several environments to explore.',
    category: 'Exploration',
    maxPlayers: 6,
    worldFloor: false,
    respawnY: -60,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/05/20',
  },
  {
    id: 'timetag',
    name: 'Time Tag',
    official: true,
    creator: 1,
    icon: './assets/icons/classichouse.png',
    mapPath: './assets/models/classichouse.json',
    scriptsPath: './assets/games/timetag',
    mapOffset: { x: 0, y: 28, z: 0 },
    spawn: { x: 11, y: 1.60, z: 46.32 },
    description: 'A fast-paced game where players tag each other to pass on the "time bomb". Avoid being the one holding it when the timer runs out!',
    category: 'Strategy',
    maxPlayers: 6,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/05/27',
  },
  {
    id: 'blockyfights',
    name: 'Blocky Fights',
    official: true,
    creator: 1,
    icon: './assets/icons/blockyfights.png',
    mapPath: './assets/models/blockyfights.json',
    scriptsPath: './assets/games/blockyfights',
    description: 'A competitive fighting game where players battle it out in an a variety of maps using their fists. Last one standing wins!',
    category: 'Strategy',
    maxPlayers: 6,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/06/2',
  },
  {
    id: 'backrooms',
    name: 'Backrooms',
    official: true,
    creator: 1,
    icon: './assets/icons/backroomsbv.png',
    mapPath: './assets/models/backrooms.json',
    scriptsPath: './assets/games/backrooms',
    description: 'A exploration game set in the eerie and endless backrooms. Explore the maze-like environment.',
    category: 'Exploration',
    maxPlayers: 4,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/06/7',
  },
  {
    id: 'mergeapart',
    name: 'Merge a Part',
    official: true,
    creator: 1,
    icon: './assets/icons/mergeapart.png',
    //mapPath: './assets/models/.json',
    scriptsPath: './assets/games/mergeapart',
    description: `Merge parts. Stack your parts. Get the highest score. 🏆
    
🔧 Merge parts into BIGGER parts`,
    category: 'Strategy',
    maxPlayers: 6,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/06/18',
  },
  {
    id: 'plus1speedrun',
    name: '+1 Speed Run',
    official: true,
    creator: 1,
    icon: './assets/icons/demo.png',
    mapPath: './assets/models/+1speedrun.json',
    scriptsPath: './assets/games/+1speedrun',
    description: `🏃 Welcome to +1 Speed Run! 🏃
⚡ Every step = +1 Speed
💪 Train your speed and unlock powerful multipliers
👥 Race against friends and other players
🌍 Become the FASTEST on the server`,
    category: 'Strategy',
    maxPlayers: 10,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/06/18',
  },
  {
    id: 'beachtown',
    name: 'Beach Town',
    official: false,
    creator: 4,
    icon: './assets/icons/beachtown.png',
    mapPath: './assets/models/beachtown.json',
    scriptsPath: './assets/games/beachtown',
    description: `🏖️ Welcome to Beach Town! 🏖️
This is a relaxing and fun game where you can explore the beach, interact with other players, and enjoy various activities. Play soccer, or just chill by the ocean. Perfect for a sunny day in the virtual world!`,
    category: 'Sandbox',
    maxPlayers: 12,
    worldFloor: false,
    respawnY: -200,
    activePlayers: 0,
    visits: 0,
    createdAt: '2026/07/11',
  },
];

export async function loadGameStats() {
  try {
    const statsSnap = await getDocs(collection(db, 'gameStats'));
    const stats = {};
    statsSnap.forEach(docSnap => {
      stats[docSnap.id] = docSnap.data();
    });
    for (const g of games) {
      if (stats[g.id]) {
        g.visits = stats[g.id].visits || 0;
      }
    }
    // Count active players per game (client-side filter to avoid composite index)
    const presenceQuery = query(collection(db, 'presence'), where('inGame', '==', true));
    const presenceSnap = await getDocs(presenceQuery);
    const playerCounts = {};
    const twoMinAgo = Date.now() - 120000;
    presenceSnap.forEach(docSnap => {
      const data = docSnap.data();
      const gid = data.gameId;
      const lastSeen = data.lastSeen?.toMillis?.() ?? data.lastSeen;
      if (lastSeen && lastSeen < twoMinAgo) return;
      if (gid) {
        playerCounts[gid] = (playerCounts[gid] || 0) + 1;
      }
    });
    for (const g of games) {
      g.activePlayers = playerCounts[g.id] || 0;
    }
  } catch (e) {
    console.warn('Could not load game stats:', e);
  }
}

export async function getActivePlayerCount(gameId) {
  try {
    const presenceQuery = query(collection(db, 'presence'), where('inGame', '==', true));
    const snap = await getDocs(presenceQuery);
    const twoMinAgo = Date.now() - 120000;
    let count = 0;
    snap.forEach(d => {
      const data = d.data();
      if (data.gameId !== gameId) return;
      const lastSeen = data.lastSeen?.toMillis?.() ?? data.lastSeen;
      if (lastSeen && lastSeen < twoMinAgo) return;
      count++;
    });
    return count;
  } catch { return 0; }
}

export async function getPublishedGames() {
  try {
    const snap = await getDocs(collection(db, 'publishedGames'));
    const results = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      results.push({
        id: docSnap.id,
        name: data.name || 'Untitled',
        icon: data.icon || './assets/icons/demo.png',
        description: data.description || '',
        category: data.category || 'User Created',
        activePlayers: 0,
        visits: data.visits || 0,
        mapUrl: data.mapUrl,
        scripts: data.scripts || {},
        authorId: data.authorId,
        authorName: data.authorName || 'Unknown',
        createdAt: data.createdAt,
        isPublished: true,
        deleted: data.deleted === true,
      });
    });
    // Also count active players for published games (client-side filter)
    const presenceQuery = query(collection(db, 'presence'), where('inGame', '==', true));
    const presenceSnap = await getDocs(presenceQuery);
    const playerCounts = {};
    const twoMinAgo = Date.now() - 120000;
    presenceSnap.forEach(docSnap => {
      const data = docSnap.data();
      const gid = data.gameId;
      const lastSeen = data.lastSeen?.toMillis?.() ?? data.lastSeen;
      if (lastSeen && lastSeen < twoMinAgo) return;
      if (gid) {
        playerCounts[gid] = (playerCounts[gid] || 0) + 1;
      }
    });
    for (const g of results) {
      g.activePlayers = playerCounts[g.id] || 0;
    }
    // Merge visit counts from gameStats (the authoritative counter, since
    // publishedGames rules don't allow non-owners to write)
    try {
      const statsSnap = await getDocs(collection(db, 'gameStats'));
      const stats = {};
      statsSnap.forEach(docSnap => {
        stats[docSnap.id] = docSnap.data();
      });
      for (const g of results) {
        if (stats[g.id]) {
          g.visits = stats[g.id].visits || 0;
        }
      }
    } catch {}
    return results;
  } catch (e) {
    console.warn('Could not load published games:', e);
    return [];
  }
}

export function getAllGames() {
  return games;
}

export function findGame(id) {
  return games.find(g => g.id === id) || null;
}

export async function findGameAsync(id) {
  const staticGame = findGame(id);
  if (staticGame) {
    const stats = await getGameStats(id);
    staticGame.visits = stats.visits || 0;
    staticGame.activePlayers = await getActivePlayerCount(id);
    return staticGame;
  }
  const published = await getPublishedGames();
  return published.find(g => g.id === id) || null;
}
