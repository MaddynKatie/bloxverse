import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, doc, getDoc, followUser, unfollowUser, resolveProfileUser } from './firebase.js';
import {
  getFriends,
  getUserList,
  getFriendRequests,
  getSentRequests,
  hydrateUsers,
  onFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
} from './friends.js';
import { renderAccountCluster } from './shell.js';

/*
 * Friends page controller.
 *
 * Structure, markup, class names, strings and interaction order are ported
 * from the reference social page (unused\uirevamp\social-page.js + the userCard
 * factory in base.js:215-244). Only the data layer differs: the reference
 * reads a REST API, BloxVerse reads Firestore through src/friends.js.
 */

const PAGE_SIZE = 24;
const TABS = ['friends', 'followers', 'following', 'requests'];

const EMPTY_MSG = {
  friends: 'No friends yet.',
  followers: 'No followers yet.',
  following: 'Not following anyone.',
  incoming: 'No incoming requests.',
  sent: 'No sent requests.',
};

const DEFAULT_AVATAR = 'assets/icons/profile.svg';

const content = document.getElementById('tab-content');
const badge = document.getElementById('req-badge');

const state = {
  user: null,
  tab: 'friends',
  page: 0,
  signedIn: false,
  loading: true,
  friends: [],
  followers: [],
  following: [],
  incoming: [],
  sent: [],
  // ?user= view: when set we render another user's list instead of our own.
  targetUid: null,
  targetName: '',
  targetNotFound: false,
  isOwnPage: true,
};

const TAB_TITLES = {
  friends: 'Friends',
  followers: 'Followers',
  following: 'Following',
  requests: 'Requests',
};

function updatePageTitle() {
  const titleEl = document.getElementById('page-title');
  if (!titleEl) return;
  const label = TAB_TITLES[state.tab] || 'Social';
  titleEl.textContent = state.targetName ? `${state.targetName}'s ${label}` : 'Social';
}

function profileHref(user) {
  const id = user.userIdNum != null ? user.userIdNum : user.id;
  return `/bloxverse/profile?user=${encodeURIComponent(id)}`;
}

function button(label, className) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}

/**
 * Port of base.js avatarImage(). The loading state is what lets the
 * .avatar-frame background show through until the portrait decodes; a missing
 * or broken portrait falls back to the default icon with the padded
 * "fallback" treatment from primitives.css.
 */
function avatarImage(user, className = '') {
  const img = document.createElement('img');
  img.className = `avatar-image ${className}`.trim();
  img.alt = user.username || 'User';
  img.decoding = 'async';
  img.dataset.avatarState = 'loading';
  img.addEventListener('load', () => {
    img.dataset.avatarState = 'ready';
  });
  img.addEventListener('error', () => {
    if (img.dataset.avatarState === 'fallback') return;
    img.dataset.avatarState = 'fallback';
    img.src = DEFAULT_AVATAR;
  });

  const src = user.avatarPreviewHead || user.avatarPreview;
  if (src) {
    img.src = src;
  } else {
    img.dataset.avatarState = 'fallback';
    img.src = DEFAULT_AVATAR;
  }
  return img;
}

/** Port of base.js userCard() (base.js:215-244). */
function userCard(user, actions = []) {
  const card = document.createElement('div');
  card.className = 'ui-card ui-card-interactive user-card';
  card.id = `card-${user.id}`;

  const href = profileHref(user);

  // The portrait is decorative: the name beside it is the accessible link.
  const portrait = document.createElement('a');
  portrait.className = 'avatar-frame user-card-portrait';
  portrait.href = href;
  portrait.tabIndex = -1;
  portrait.setAttribute('aria-hidden', 'true');
  portrait.appendChild(avatarImage(user, 'user-card-avatar'));

  const name = document.createElement('a');
  name.className = 'user-card-name';
  name.href = href;
  name.textContent = user.username || 'Unknown';
  name.title = name.textContent;

  card.append(portrait, name);

  if (actions.length) {
    const wrap = document.createElement('div');
    wrap.className = 'user-card-actions';
    actions.forEach((action) => wrap.appendChild(action));
    card.appendChild(wrap);
  }

  return card;
}

/** Port of base.js renderPagination() (base.js:286-301). */
function renderPagination(container, currentPage, totalPages, onPage) {
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const prev = button('Previous', 'btn-secondary');
  prev.disabled = currentPage === 0;
  prev.addEventListener('click', () => onPage(currentPage - 1));

  const info = document.createElement('span');
  info.className = 'pagination-info';
  info.textContent = `Page ${currentPage + 1} of ${totalPages}`;

  const next = button('Next', 'btn-secondary');
  next.disabled = currentPage === totalPages - 1;
  next.addEventListener('click', () => onPage(currentPage + 1));

  container.append(prev, info, next);
}

/** Port of base.js paginatedGrid() (base.js:303+). */
function paginatedGrid(container, items, renderCard, emptyMsg) {
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'info-msg';
    empty.textContent = emptyMsg;
    container.appendChild(empty);
    return;
  }

  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const page = Math.min(state.page, totalPages - 1);
  const slice = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const grid = document.createElement('div');
  grid.className = 'user-grid';
  for (const item of slice) {
    grid.appendChild(renderCard(item));
  }

  const pagination = document.createElement('div');
  pagination.className = 'pagination';
  renderPagination(pagination, page, totalPages, (next) => {
    state.page = next;
    renderActiveTab();
  });

  container.append(grid, pagination);
}

function confirmFriendRemoval(user) {
  return window.confirmAction({
    title: 'Remove friend?',
    description: `${user.username} will be removed from your friends list. You will need to send a new friend request to reconnect.`,
    confirmLabel: 'Remove Friend',
    pendingLabel: 'Removing',
    intent: 'danger',
    onConfirm: async () => {
      await removeFriend(state.user.uid, user.id);
      state.friends = state.friends.filter((f) => f.id !== user.id);
      renderActiveTab();
    },
  });
}

/* Tab renderers ---------------------------------------------------- */

function renderFriendList() {
  paginatedGrid(
    content,
    state.friends,
    (user) =>
      userCard(user,
        state.isOwnPage
          ? [buttonWithHandler('Remove Friend', 'btn-danger-quiet btn-sm', async () => {
              if (!(await confirmFriendRemoval(user))) return;
              state.friends = state.friends.filter((f) => f.id !== user.id);
              renderActiveTab();
            })]
          : []),
    EMPTY_MSG.friends
  );
}

function renderFollowList(tab) {
  const items = tab === 'following' ? state.following : state.followers;

  paginatedGrid(
    content,
    items,
    (user) => {
      const actions = [];

      if (state.isOwnPage && tab === 'following') {
        const unfollow = button('Unfollow', 'btn-secondary');
        unfollow.addEventListener('click', async () => {
          unfollow.disabled = true;
          await unfollowUser(state.user.uid, user.id);
          state.following = state.following.filter((u) => u.id !== user.id);
          renderActiveTab();
        });
        actions.push(unfollow);
      } else if (!state.following.some((u) => u.id === user.id)) {
        // Follow Back: only offered when the viewer does not already follow.
        // The button then toggles between Following and Follow Back in place,
        // the way the reference swaps the label and intent after the POST.
        const toggle = button('Follow Back', 'btn-primary');
        let following = false;

        toggle.addEventListener('click', async () => {
          toggle.disabled = true;
          try {
            if (following) {
              await unfollowUser(state.user.uid, user.id);
              state.following = state.following.filter((u) => u.id !== user.id);
            } else {
              await followUser(state.user.uid, user.id);
              state.following.push(user);
            }
            following = !following;
            toggle.textContent = following ? 'Following' : 'Follow Back';
            toggle.className = following ? 'btn-secondary' : 'btn-primary';
          } catch (error) {
            console.error('Follow toggle failed:', error);
          } finally {
            toggle.disabled = false;
          }
        });
        actions.push(toggle);
      }

      return userCard(user, actions);
    },
    tab === 'following' ? EMPTY_MSG.following : EMPTY_MSG.followers
  );
}

function buttonWithHandler(label, className, onClick) {
  const el = button(label, className);
  el.addEventListener('click', async () => {
    el.disabled = true;
    try {
      await onClick();
    } finally {
      el.disabled = false;
    }
  });
  return el;
}

function renderRequests() {
  renderSection('Incoming', state.incoming, (req) => {
    const accept = button('Accept', 'btn-primary');
    const decline = button('Decline', 'btn-danger');
    accept.addEventListener('click', async () => {
      accept.disabled = true;
      decline.disabled = true;
      try {
        await acceptFriendRequest(req.id, req.from, req.to);
        state.incoming = state.incoming.filter((r) => r.id !== req.id);
        renderActiveTab();
      } catch (error) {
        console.error('Accept failed:', error);
        accept.disabled = false;
        decline.disabled = false;
      }
    });
    decline.addEventListener('click', async () => {
      accept.disabled = true;
      decline.disabled = true;
      try {
        await declineFriendRequest(req.id);
        state.incoming = state.incoming.filter((r) => r.id !== req.id);
        renderActiveTab();
      } catch (error) {
        console.error('Decline failed:', error);
        accept.disabled = false;
        decline.disabled = false;
      }
    });
    return userCard(req.user || { id: req.from, username: 'Unknown' }, [accept, decline]);
  });

  const sep = document.createElement('hr');
  sep.className = 'section-sep';
  content.appendChild(sep);

  renderSection('Sent', state.sent, (req) => {
    const cancel = button('Cancel', 'btn-secondary');
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      await declineFriendRequest(req.id);
      state.sent = state.sent.filter((r) => r.id !== req.id);
      renderActiveTab();
    });
    return userCard(req.user || { id: req.to, username: 'Unknown' }, [cancel]);
  });
}

function renderSection(title, items, renderCard) {
  const emptyMsg = title === 'Incoming' ? EMPTY_MSG.incoming : EMPTY_MSG.sent;

  const header = document.createElement('p');
  header.className = 'section-grid-header';
  header.textContent = title;
  content.appendChild(header);

  const section = document.createElement('div');
  content.appendChild(section);

  paginatedGrid(section, items, renderCard, emptyMsg);
}

/* Tab routing ------------------------------------------------------ */

function renderActiveTab() {
  content.innerHTML = '';

  if (state.targetNotFound) {
    const msg = document.createElement('p');
    msg.className = 'info-msg';
    msg.textContent = 'User not found.';
    content.appendChild(msg);
    return;
  }

  if (!state.signedIn && state.isOwnPage) {
    const msg = document.createElement('p');
    msg.className = 'info-msg';
    msg.textContent = 'Sign in to see your friends and requests.';
    content.appendChild(msg);
    return;
  }

  if (state.loading) {
    const msg = document.createElement('p');
    msg.className = 'info-msg';
    msg.textContent = 'Loading...';
    content.appendChild(msg);
    return;
  }

  switch (state.tab) {
    case 'followers':
    case 'following':
      renderFollowList(state.tab);
      break;
    case 'requests':
      renderRequests();
      break;
    default:
      renderFriendList();
  }
}

function setTab(tab) {
  if (!TABS.includes(tab)) return;
  if (tab === 'requests' && !state.isOwnPage) tab = 'friends';
  state.tab = tab;
  state.page = 0;

  document.querySelectorAll('.tab-btn').forEach((el) => {
    const active = el.dataset.tab === tab;
    el.classList.toggle('active', active);
    if (active) {
      el.setAttribute('aria-current', 'page');
    } else {
      el.removeAttribute('aria-current');
    }
  });

  const url = new URL(location.href);
  url.searchParams.set('tab', tab);
  history.replaceState(null, '', url);

  renderActiveTab();
  updatePageTitle();
}

async function loadData() {
  const owner = state.targetUid || state.user.uid;

  const [friends, following, followers] = await Promise.all([
    getFriends(owner).catch(() => []),
    getUserList(owner, 'following').catch(() => []),
    getUserList(owner, 'followers').catch(() => []),
  ]);

  state.friends = friends;
  state.following = following;
  state.followers = followers;

  if (state.isOwnPage) {
    const [incoming, sent] = await Promise.all([
      getFriendRequests(owner).catch(() => []),
      getSentRequests(owner).catch(() => []),
    ]);
    const senders = await hydrateUsers(incoming.map((r) => r.from));
    state.incoming = incoming.map((req) => ({ ...req, user: senders.get(req.from) || null }));
    state.sent = sent;
  } else {
    state.incoming = [];
    state.sent = [];
  }

  state.loading = false;

  renderActiveTab();
}

function syncBadge(count) {
  if (badge) badge.textContent = count > 0 ? String(count) : '';
}

async function resolveTarget() {
  const rawTarget = new URLSearchParams(location.search).get('user');
  if (!rawTarget) return;

  const targetUid = await resolveProfileUser(rawTarget);
  if (!targetUid) {
    state.targetNotFound = true;
    renderActiveTab();
    return;
  }

  // Own page via ?user=me: keep the self view (requests tab, badges, actions).
  if (state.user && targetUid === state.user.uid) return;

  const snap = await getDoc(doc(db, 'users', targetUid)).catch(() => null);
  if (!snap || !snap.exists() || snap.data().is_deleted) {
    state.targetNotFound = true;
    renderActiveTab();
    return;
  }

  state.targetUid = targetUid;
  state.targetName = snap.data().username || 'Unknown';
  state.isOwnPage = false;

  const back = document.getElementById('social-profile-back');
  if (back) {
    back.href = `/bloxverse/profile?user=${encodeURIComponent(rawTarget)}`;
    back.setAttribute('aria-label', `Back to ${state.targetName}'s profile`);
    back.hidden = false;
  }

  const requestsTab = document.getElementById('requests-tab');
  if (requestsTab) requestsTab.style.display = 'none';
  if (badge) badge.hidden = true;

  state.loading = true;
  renderActiveTab();
  await loadData();
}

function init() {
  document.querySelectorAll('.tab-btn').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      setTab(el.dataset.tab);
    });
  });

  const requested = new URLSearchParams(location.search).get('tab');
  setTab(TABS.includes(requested) ? requested : 'friends');

  onAuthStateChanged(auth, async (user) => {
    state.signedIn = !!user;
    state.user = user || null;

    if (!user) {
      await resolveTarget();
      if (state.targetUid || state.targetNotFound) {
        renderAccountCluster(null, { sitePath: (p) => `/bloxverse${p}` });
        syncBadge(0);
        return; // resolveTarget already rendered the guest's target view.
      }
      state.loading = false;
      syncBadge(0);
      renderActiveTab();
      renderAccountCluster(null, { sitePath: (p) => `/bloxverse${p}` });
      return;
    }

    state.signedIn = true;
    state.user = user;

    // Shell state, so it renders off the profile document independently of the
    // friends data below. A friend-list failure must not empty the top-right.
    let profile = {};
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      profile = snap.exists() ? snap.data() : {};
      renderAccountCluster(user, {
        username: profile.username || user.displayName,
        bux: profile.bux || 0,
        userNum: profile.userIdNum,
        preview: profile.avatarPreviewHead || profile.avatarPreview || null,
        sitePath: (p) => `/bloxverse${p}`,
        onLogout: () => { location.replace('/bloxverse/auth'); },
      });
    } catch (error) {
      console.warn('[friends] account cluster failed:', error);
    }

    await resolveTarget();
    if (state.targetNotFound || !state.isOwnPage) {
      syncBadge(0);
      return; // resolveTarget rendered the other user's list.
    }

    renderActiveTab();

    // Live badge count, independent of which tab is open.
    onFriendRequests(user.uid, (requests) => syncBadge(requests.length));

    await loadData();
  });
}

init();
