import './darcula.css';
import './islands-darcula.css';

const THEMES = ['darcula', 'islands-darcula'];
const STORAGE_KEY = 'ui-theme';

export function getThemes() { return THEMES; }

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'darcula';
}

export function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'darcula';
  document.documentElement.setAttribute('data-theme', name);
  localStorage.setItem(STORAGE_KEY, name);
}

// Apply saved theme on import
applyTheme(getTheme());
