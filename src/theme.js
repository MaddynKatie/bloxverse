const THEME_KEY = 'bloxverse_theme';
const UI_STYLE_KEY = 'bloxverse_ui_style';
const UI_STYLES = ['default', 'compact'];

// Each family has a dark, light, and system-pair variants. The default family
// uses the bare names (dark/light/system); every other family suffixes its key
// (e.g. valley => valley / valley-light / valley-system).
// 'twilight' used to be a separate family but it duplicated the default dark
// ramp exactly, so it was merged into default: default dark keeps that ramp and
// default light now uses the old twilight-light ramp.
const FAMILIES = [
  // Every family previews its accent, so the cards read as a set. Default was
  // using the canvas colours instead (#171020 / #f4f2fa), which is why its
  // card read as plain black-and-white next to the four tinted ones.
  { key: 'default',   label: 'Default',  swatchDark: '#7c3aed', swatchLight: '#a855f7' },
  { key: 'valley',    label: 'Valley',   swatchDark: '#15803d', swatchLight: '#86c9a0' },
  { key: 'sky',       label: 'Sky',      swatchDark: '#0f2a42', swatchLight: '#7cc4e8' },
  { key: 'lava',      label: 'Lava',     swatchDark: '#b91c1c', swatchLight: '#e59a8a' },
  { key: 'solar',     label: 'Solar',    swatchDark: '#b45309', swatchLight: '#eac55d' },
];

// Stored themes that no longer exist, mapped to their replacement.
const THEME_ALIASES = {
  twilight: 'dark',
  'twilight-light': 'light',
  'twilight-system': 'system',
};

function themeName(family, mode) {
  if (family === 'default') return mode;
  return mode === 'dark' ? family : `${family}-${mode}`;
}

// All selectable theme names, ordered for a sensible toggle cycle.
const THEMES = ['dark', 'light', 'system',
  'valley', 'valley-light', 'valley-system',
  'sky', 'sky-light', 'sky-system',
  'lava', 'lava-light', 'lava-system',
  'solar', 'solar-light', 'solar-system'];

// Drop retired theme names (e.g. a stored 'twilight-light') in favour of the
// family that absorbed them, so existing users keep a working theme.
function normalizeTheme(theme) {
  if (THEMES.includes(theme)) return theme;
  return THEME_ALIASES[theme] || 'dark';
}

export function getThemeFamilies() {
  return FAMILIES.map(f => ({ ...f }));
}

// Return the family key for a stored theme name (e.g. 'valley-light' => 'valley').
export function getThemeFamily(theme) {
  const clean = normalizeTheme(theme);
  for (const f of FAMILIES) {
    if (clean === f.key || clean.startsWith(`${f.key}-`)) return f.key;
  }
  return 'default';
}

// Build a theme name from a family key + mode ('dark' | 'light' | 'system').
export function buildTheme(family, mode) {
  return THEMES.includes(themeName(family, mode)) ? themeName(family, mode) : mode;
}

// Extract the mode part of a theme name ('dark' | 'light' | 'system').
// Bare family keys (e.g. 'valley') are their dark variant; 'light'/'system'
// and any '-light'/'-system' suffix are handled explicitly.
export function getMode(theme) {
  const clean = normalizeTheme(theme);
  if (clean === 'light' || clean.endsWith('-light')) return 'light';
  if (clean === 'system' || clean.endsWith('-system')) return 'system';
  return 'dark';
}

export function isLightTheme(theme) {
  return getMode(theme) === 'light';
}

export function isSystemTheme(theme) {
  return getMode(theme) === 'system';
}

export function getTheme() {
  const theme = localStorage.getItem(THEME_KEY);
  return normalizeTheme(theme);
}

export function resolveTheme(theme) {
  const clean = normalizeTheme(theme);
  if (getMode(clean) === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? buildTheme(getThemeFamily(clean), 'dark')
      : buildTheme(getThemeFamily(clean), 'light');
  }
  return clean;
}

// Announce every applied theme so anything showing theme state (the shell's
// sun/moon button, the settings controls) can resync no matter which of them
// actually changed it.
export const THEME_CHANGE_EVENT = 'bloxverse:themechange';

function announceTheme() {
  document.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, {
    detail: { theme: getTheme(), resolved: resolveTheme(getTheme()) },
  }));
}

export function setTheme(theme) {
  theme = normalizeTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
  announceTheme();
}

export function toggleTheme() {
  const current = getTheme();
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  setTheme(next);
  return next;
}

// The corner sun/moon button flips light <-> dark for whichever family the user
// picked in Settings, instead of walking the whole family list. 'system' resolves
// against the OS preference first so the button always does something visible.
export function toggleThemeMode() {
  const current = getTheme();
  const resolved = resolveTheme(current);
  const family = getThemeFamily(current);
  const wasLight = isLightTheme(resolved);
  const next = buildTheme(family, wasLight ? 'dark' : 'light');
  setTheme(next);
  return next;
}

// True when the toggle should render a sun (i.e. we are in dark mode now).
export function isDarkActive() {
  return !isLightTheme(resolveTheme(getTheme()));
}

export function getUiStyle() {
  const style = localStorage.getItem(UI_STYLE_KEY);
  return UI_STYLES.includes(style) ? style : 'default';
}

export function setUiStyle(style) {
  if (!UI_STYLES.includes(style)) style = 'default';
  localStorage.setItem(UI_STYLE_KEY, style);
  document.documentElement.setAttribute('data-ui', style);
}

function watchSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    if (isSystemTheme(getTheme())) {
      document.documentElement.setAttribute('data-theme', resolveTheme(getTheme()));
      announceTheme();
    }
  };
  mq.addEventListener('change', apply);
}

export function initTheme() {
  const theme = getTheme();
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
  const ui = getUiStyle();
  document.documentElement.setAttribute('data-ui', ui);
  watchSystemTheme();
}

initTheme();