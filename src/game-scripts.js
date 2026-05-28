import { sitePath } from './paths.js';

/** Official game Lua scripts — list updated by `npm run dist`. */
const GAME_SCRIPT_RELATIVE = [
  'assets/games/test/Script.lua',
  'assets/games/timetag/main.lua',
  'assets/games/touchfootball/Sprint.lua',
  'assets/games/touchfootball/ball.lua',
  'assets/games/touchfootball/team.lua',
  'assets/games/touchfootball/tp1.lua',
  'assets/games/touchfootball/tp2.lua',
];

export async function loadGameScriptModules() {
  const modules = {};
  await Promise.all(
    GAME_SCRIPT_RELATIVE.map(async (rel) => {
      const path = sitePath(rel);
      try {
        const res = await fetch(path);
        if (res.ok) modules[path] = await res.text();
      } catch (e) {
        console.warn('[game-scripts] Failed to load', path, e);
      }
    })
  );
  return modules;
}
