// Server-side profanity filtering for chat. Mirrors the client filter in
// game.html so masked output is consistent everywhere. Uses a dynamic import
// because glin-profanity is ESM and this server is CommonJS.
'use strict';

let filter = null;
let initPromise = null;

// Safe words that should never be censored despite appearing in profanity lists
const SAFE_WORDS = new Set(['top', 'xx', 'xxx', 'kk', 'kkk', 'wt']);

const LEET_MAP = {
  'a': '[aA4@\u00C0-\u00C5\u0430\u03B1\u0250]',
  'b': '[bB8\u03B2\u0299]',
  'c': '[cC(<{\u00A2\u0441\u03C2\u03BF\u0254]',
  'd': '[dD|)]',
  'e': '[eE3\u00E8-\u00EB\u0435\u03B5\u01DD]',
  'g': '[gG69]',
  'h': '[hH#\u0445\u0265]',
  'i': '[iI1!|!\u00EC-\u00EF\u0456\u03B9\u0131]',
  'l': '[lL1|!|_]',
  'o': '[oO0\u00F2-\u00F6\u043E\u03BF\u03F5\u0251]',
  'p': '[pP\u00FE\u0440\u03C1]',
  's': '[sS5$]',
  't': '[tT7+\u2020\u0164\u0165\u0287]',
  'u': '[uUvV\u00F9-\u00FC\u0443\u03BC\u028C]',
  'x': '[xX%*]',
  'z': '[zZ2\u0240]'
};

function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mod = await import('glin-profanity');
    filter = new mod.ProfanityFilter({
      detectLeetspeak: true,
      leetspeakLevel: 'moderate',
      normalizeUnicode: true,
      languages: ['english'],
      wordBoundaries: true,
      allowObfuscatedMatch: true,
      fuzzyToleranceLevel: 0.8
    });
    console.log('[Profanity] filter ready');
  })().catch((e) => {
    console.warn('[Profanity] init failed:', e.message);
    filter = null;
  });
  return initPromise;
}

function maskText(text, profaneWords) {
  let cleaned = text;
  profaneWords.filter((w) => w.length >= 3).forEach((word) => {
    const pattern = word.split('').map((c) => {
      const l = c.toLowerCase();
      return (LEET_MAP[l] || l) + '[\\s._\\-*|]*';
    }).join('');
    // Letter boundaries so "butt" never cuts into real words like "button"
    const regex = new RegExp('(?<![A-Za-z0-9])' + pattern + '(?![A-Za-z0-9])', 'gi');
    cleaned = cleaned.replace(regex, (m) => '#'.repeat(m.length));
  });
  return cleaned;
}

function filterMessage(text) {
  if (!filter || !text || typeof text !== 'string') return { caught: false, masked: text };
  try {
    // Strip separators and convert leet pipe to 'i' for detection
    const normalized = text.replace(/[._\-*]+/g, '').replace(/[|]/g, 'i');
    const result = filter.checkProfanity(normalized);
    if (!result.containsProfanity) return { caught: false, masked: text };

    const filteredWords = result.profaneWords.filter((w) => !SAFE_WORDS.has(w.toLowerCase()));
    if (filteredWords.length === 0) return { caught: false, masked: text };

    return { caught: true, masked: maskText(text, filteredWords) };
  } catch (e) {
    console.warn('[Profanity] check error:', e.message);
    return { caught: false, masked: text };
  }
}

module.exports = { init, filterMessage };
