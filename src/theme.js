const THEME_KEY = 'bloxverse_theme';
const UI_STYLE_KEY = 'bloxverse_ui_style';
const UI_STYLES = ['default', 'compact'];

// Each family has a dark, light, and system-pair variants. The default family
// uses the bare names (dark/light/system); every other family suffixes its key
// (e.g. valley => valley / valley-light / valley-system).
const FAMILIES = [
  { key: 'default',   label: 'Default',  swatchDark: '#232527', swatchLight: '#f2f2f2' },
  { key: 'twilight',  label: 'Twilight', swatchDark: '#7c3aed', swatchLight: '#a78bfa' },
  { key: 'valley',    label: 'Valley',   swatchDark: '#15803d', swatchLight: '#86c9a0' },
  { key: 'sky',       label: 'Sky',      swatchDark: '#0f2a42', swatchLight: '#7cc4e8' },
  { key: 'lava',      label: 'Lava',     swatchDark: '#b91c1c', swatchLight: '#e59a8a' },
  { key: 'solar',     label: 'Solar',    swatchDark: '#b45309', swatchLight: '#eac55d' },
];

function themeName(family, mode) {
  if (family === 'default') return mode;
  return mode === 'dark' ? family : `${family}-${mode}`;
}

// All selectable theme names, ordered for a sensible toggle cycle.
const THEMES = ['dark', 'light', 'system',
  'twilight', 'twilight-light', 'twilight-system',
  'valley', 'valley-light', 'valley-system',
  'sky', 'sky-light', 'sky-system',
  'lava', 'lava-light', 'lava-system',
  'solar', 'solar-light', 'solar-system'];

export function getThemeFamilies() {
  return FAMILIES.map(f => ({ ...f }));
}

// Return the family key for a stored theme name (e.g. 'valley-light' => 'valley').
export function getThemeFamily(theme) {
  const clean = THEMES.includes(theme) ? theme : 'dark';
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
  const clean = THEMES.includes(theme) ? theme : 'dark';
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
  return THEMES.includes(theme) ? theme : 'dark';
}

export function resolveTheme(theme) {
  const clean = THEMES.includes(theme) ? theme : 'dark';
  if (getMode(clean) === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? buildTheme(getThemeFamily(clean), 'dark')
      : buildTheme(getThemeFamily(clean), 'light');
  }
  return clean;
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'dark';
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

export function toggleTheme() {
  const current = getTheme();
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  setTheme(next);
  return next;
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