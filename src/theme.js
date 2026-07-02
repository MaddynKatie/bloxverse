const THEME_KEY = 'bloxverse_theme';

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

export function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initTheme() {
  const theme = getTheme();
  document.documentElement.setAttribute('data-theme', theme);
}

initTheme();
