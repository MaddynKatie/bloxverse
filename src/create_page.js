import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { fetchApi } from './api.js';

/**
 * Create page controller: lists the signed-in user's Studio games. Creating a game
 * happens in BloxVerse Studio, so the Create button opens Studio through
 * [data-open-studio] (wired by src/studio.js).
 */

const byId = id => document.getElementById(id);
const content = byId('content');
const createButton = byId('create-game');
const account = byId('account');

const DEFAULT_THUMB = 'assets/icons/group-default.webp';

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showPanel(title, description, action) {
  const panel = el('div', 'panel');
  panel.append(el('h2', '', title));
  if (description) panel.append(el('p', '', description));
  if (action) panel.append(action);
  content.replaceChildren(panel);
}

function signInLink() {
  const link = el('a', 'btn btn-primary', 'Sign in');
  link.href = 'auth.html';
  return link;
}

function renderAccount(name) {
  account.replaceChildren();
  if (!name) return;
  account.append(el('span', '', name));
}

function renderGames(projects) {
  const grid = el('div', 'grid');
  for (const project of projects) {
    const card = el('a', 'card');
    card.href = 'game.html?id=' + encodeURIComponent(project.id);

    const thumb = el('img', 'thumb');
    thumb.src = DEFAULT_THUMB;
    thumb.alt = '';
    thumb.loading = 'lazy';

    card.append(thumb, el('h3', 'card-title', project.name || 'Untitled'));
    grid.append(card);
  }
  content.replaceChildren(grid);
}

async function loadAccountName(user) {
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    renderAccount(snap.exists() ? snap.data().username : '');
  } catch {
    renderAccount('');
  }
}

async function loadGames(user) {
  content.replaceChildren(el('div', 'grid'));
  content.firstChild.append(el('div', 'skeleton'), el('div', 'skeleton'));
  try {
    const token = await user.getIdToken();
    const res = await fetchApi('/api/studio/projects', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load your games.');
    const projects = data.projects || [];
    createButton.hidden = false;
    if (projects.length) {
      renderGames(projects);
    } else {
      const create = el('a', 'btn btn-primary', 'Create your first game');
      create.href = 'game.html';
      showPanel('No games yet', 'Create a game to give it a name and description.', create);
    }
  } catch (err) {
    showPanel('Something went wrong', err.message || 'Could not load. Please try again.');
  }
}

onAuthStateChanged(auth, (user) => {
  createButton.hidden = true;
  if (!user) {
    account.replaceChildren(signInLink());
    showPanel('Sign in to continue', '', signInLink());
    return;
  }
  loadAccountName(user);
  loadGames(user);
});
