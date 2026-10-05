import { onAuthStateChanged } from 'firebase/auth';
import { auth, banGuard } from './firebase.js';
import { fetchApi } from './api.js';

/**
 * Groups page controller.
 *
 * Ported from the reference groups page (unused\uirevamp\groups.js). The structure,
 * class names, strings and interaction order follow it closely, including the create
 * dialog markup. Three things differ, all because of the platform:
 *
 *   - Calls go through fetchApi (src/api.js) instead of a bare fetch to a relative
 *     path, because the API lives on a separate host with node failover, and writes
 *     carry a Firebase bearer token the way catalog trading does.
 *   - VortexMotion is BloxVerseMotion.
 *   - The reference interpolates group names into innerHTML with window.escapeHtml.
 *     Every string here is set with textContent instead, so a group called
 *     "<img onerror=...>" is displayed rather than executed. Same output, no escaping
 *     step to get wrong.
 */

const PAGE_SIZE = 30;
const CREATE_COST = 100;
// The reference falls back to /group-default.webp, which is not in this repo. Groups
// are shown with the BloxVerse mark instead, so the nav's groups.svg is not reused here.
const DEFAULT_ICON = 'assets/icons/bloxverseLogo.png';
// A player silhouette, matching src/social_page.js, used where a member has no avatar.
const DEFAULT_AVATAR = 'assets/icons/profile.svg';

const byId = id => document.getElementById(id);

const list = byId('group-list');
const status = byId('group-status');
const pagination = byId('group-pagination');
const searchInput = byId('group-search');
const sortSelect = byId('group-sort');
const createToggle = byId('create-toggle');
const retryButton = byId('group-retry');

let page = 0;
let activeRequest = null;
let query = '';
let currentUser = null;

/** Auth headers for a write. The listing is public and needs no token. */
async function authHeaders() {
  const user = auth.currentUser;
  if (!user) return {};
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

/**
 * `auth` is needed for routes that identify the caller; the listing itself is public.
 * It is also sent for the group page, whose response labels the caller's role.
 *
 * The server's message is preferred over a generic one so a group that was deleted
 * reads as "That group no longer exists." instead of a flat failure.
 */
async function apiGet(path, { auth = false } = {}) {
  const res = await fetchApi(path, auth ? { headers: await authHeaders() } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Failed to load groups.');
    error.code = data.error;
    error.status = res.status;
    throw error;
  }
  return data;
}

async function apiPost(path, body) {
  const res = await fetchApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'That did not work.');
    error.code = data.error;
    throw error;
  }
  return data;
}

/**
 * Validate a group name.
 *
 * Mirrors groupNameError() in server/groups.js. The server re-checks regardless: this
 * copy exists so the dialog can point at the field without a round trip, and so the
 * two stay worded the same way.
 */
function groupNameError(name) {
  if (!name) return 'Enter a group name.';
  if (name.length > 50) return 'Group names can be at most 50 characters.';
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'Group names cannot contain control characters.';
  return null;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * One group card.
 *
 * `role` is passed only for "My groups", where the card shows an Owner/Member tag
 * instead of a Join button. Cards link to the group page in the same document as a
 * query string rather than the reference's /groups/<id> path: the site is served as
 * static files, so /bloxverse/groups/<id> matches no file and 404s (and 404.html
 * redirects such a path back to itself). This is the same shape catalog.html?item=
 * and profile.html?user= already use.
 */
function groupCard(group, { role } = {}) {
  const card = element('div', 'ui-card ui-card-interactive grp-card');

  const link = element('a', 'grp-card-link');
  link.href = `/bloxverse/groups?group=${encodeURIComponent(group.id)}`;

  const icon = element('img', 'grp-card-icon');
  icon.src = DEFAULT_ICON;
  icon.alt = '';
  icon.width = 64;
  icon.height = 64;
  icon.loading = 'lazy';
  link.appendChild(icon);

  const text = element('span', 'grp-card-text');
  text.appendChild(element('span', 'grp-card-name', group.name));

  const members = element('span', 'grp-card-members');
  const count = String(Number(group.member_count) || 0).toLocaleString();
  const strong = element('strong', '', count);
  members.append(strong, document.createTextNode(count === '1' ? ' member' : ' members'));
  text.appendChild(members);
  link.appendChild(text);
  card.appendChild(link);

  if (group.description !== undefined) {
    const description = element('p', 'grp-card-desc', group.description || 'No description yet.');
    if (!group.description) description.classList.add('is-empty');
    card.appendChild(description);
  }

  const bottom = element('div', 'grp-card-bottom');
  if (group.owner_username) bottom.appendChild(element('span', 'grp-card-owner', `By ${group.owner_username}`));

  if (!role) {
    const btn = element('button', 'btn-primary btn-sm grp-card-join', 'Join');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Join ${group.name}`);
    btn.addEventListener('click', () => joinGroup(group.id, btn));
    bottom.appendChild(btn);
  } else {
    const tag = element('span', 'grp-card-role');
    const glyph = element('i', `fa-solid ${role === 'Owner' ? 'fa-crown' : 'fa-check'}`);
    glyph.setAttribute('aria-hidden', 'true');
    tag.appendChild(glyph, document.createTextNode(` ${role}`));
    bottom.appendChild(tag);
  }

  card.appendChild(bottom);
  return card;
}

function setCount(el, total) {
  el.textContent = Number(total || 0).toLocaleString();
  el.hidden = false;
}

/** Port of base.js renderPagination(), the same one src/social_page.js uses. */
function renderPagination(container, currentPage, totalPages, onPage) {
  container.replaceChildren();
  if (totalPages <= 1) return;

  const prev = element('button', 'btn-secondary', 'Previous');
  prev.type = 'button';
  prev.disabled = currentPage === 0;
  prev.addEventListener('click', () => onPage(currentPage - 1));

  const next = element('button', 'btn-secondary', 'Next');
  next.type = 'button';
  next.disabled = currentPage === totalPages - 1;
  next.addEventListener('click', () => onPage(currentPage + 1));

  container.append(prev, element('span', 'pagination-info', `Page ${currentPage + 1} of ${totalPages}`), next);
}

async function joinGroup(id, btn) {
  if (!auth.currentUser) {
    status.hidden = false;
    status.textContent = 'Sign in to join a group.';
    return;
  }
  if (await banGuard(auth.currentUser.uid)) return;

  btn.disabled = true;
  window.BloxVerseMotion.setPending(btn, true, 'Joining');
  try {
    await apiPost(`/api/groups/${encodeURIComponent(id)}/join`);

    // Opens the group, as the reference does (groups.js: location.href = '/groups/' + id).
    // Staying on the listing would also be wrong now that Explore omits the viewer's
    // own groups: the card they just joined vanishes from under them.
    window.location.assign(`/bloxverse/groups?group=${encodeURIComponent(id)}`);
  } catch (e) {
    btn.disabled = false;
    window.BloxVerseMotion.setPending(btn, false);
    status.hidden = false;
    status.textContent = e.message;
  }
}

async function loadGroups(p) {
  // One request in flight at a time. Typing in the search box fires a new load per
  // debounce tick, and without this an older, slower response can land last and
  // overwrite the newer results.
  if (activeRequest) activeRequest.abort();
  const controller = new AbortController();
  activeRequest = controller;
  page = Math.max(0, p || 0);

  list.setAttribute('aria-busy', 'true');
  retryButton.hidden = true;
  for (const b of pagination.querySelectorAll('button')) b.disabled = true;

  try {
    const params = new URLSearchParams({ q: query, sort: sortSelect.value, page: String(page) });
    // The token is optional here, but sending it is what lets the server leave the
    // viewer's own groups out of Explore: they belong under "My groups" only, so a
    // group never appears in both sections with a Join button the viewer cannot use.
    const res = await fetchApi(`/api/groups?${params}`, {
      signal: controller.signal,
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error('Failed to load groups.');
    const data = await res.json();
    if (controller !== activeRequest) return;

    list.replaceChildren(...data.items.map(group => groupCard(group)));
    window.BloxVerseMotion.reveal(list);
    setCount(byId('explore-count'), data.total || 0);
    status.hidden = data.items.length > 0;
    if (!data.items.length) status.textContent = query ? 'No groups match your search.' : 'No groups yet.';
    renderPagination(pagination, page, Math.ceil((data.total || 0) / PAGE_SIZE), loadGroups);
  } catch (e) {
    if (controller !== activeRequest) return;
    if (e.name === 'AbortError') return;
    status.hidden = false;
    status.textContent = 'Failed to load groups.';
    retryButton.hidden = false;
    for (const b of pagination.querySelectorAll('button')) b.disabled = false;
  } finally {
    if (controller === activeRequest) list.setAttribute('aria-busy', 'false');
  }
}

async function loadMine() {
  // Called from several places, some of them reachable while signed out, so the
  // guard lives here rather than at each call site.
  if (!auth.currentUser) return;
  try {
    const rows = await apiGet('/api/groups/mine', { auth: true });
    if (!rows.length) return;

    const mineList = byId('mine-list');
    mineList.replaceChildren(...rows.map(r => groupCard(r, { role: r.is_owner ? 'Owner' : 'Member' })));
    window.BloxVerseMotion.reveal(mineList);
    setCount(byId('mine-count'), rows.length);
    byId('mine-section').hidden = false;
  } catch (e) {
    // The listing above is still useful signed out, so a failed "My groups" is silent.
  }
}

/**
 * The create dialog.
 *
 * Markup matches the reference dialog, including the "costs 100 Bux" line. The
 * reference offers a "Get more Bux" link there; BloxVerse has no Bux purchase flow
 * at all yet (an admin grants Bux), so that link would point nowhere and is omitted
 * rather than shipped broken.
 */
function openCreateDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'group-create-dialog';
  dialog.setAttribute('aria-labelledby', 'create-dialog-title');
  dialog.setAttribute('aria-describedby', 'create-dialog-description');

  const header = element('div', 'ui-dialog-header');
  header.appendChild(element('h2', '', 'Create a group'));
  const close = element('button', 'btn-ghost btn-icon');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.appendChild(element('i', 'fa-solid fa-xmark'));
  close.firstChild.setAttribute('aria-hidden', 'true');
  header.appendChild(close);

  const form = document.createElement('form');
  const body = element('div', 'ui-dialog-body');

  const nameLabel = element('label', 'ui-field');
  nameLabel.appendChild(document.createTextNode('Name'));
  const nameField = document.createElement('input');
  nameField.type = 'text';
  nameField.className = 'ui-input';
  nameField.name = 'name';
  nameField.maxLength = 50;
  nameField.autocomplete = 'off';
  nameField.placeholder = 'Group name';
  nameLabel.appendChild(nameField);

  const descLabel = element('label', 'ui-field');
  descLabel.appendChild(document.createTextNode('Description (optional)'));
  const descField = document.createElement('textarea');
  descField.className = 'ui-input';
  descField.name = 'description';
  descField.maxLength = 1000;
  descField.placeholder = 'Describe your group';
  descLabel.appendChild(descField);

  body.append(nameLabel, descLabel);

  const error = element('p', 'ui-dialog-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const actions = element('div', 'ui-dialog-actions');
  const cancel = element('button', 'btn-secondary', 'Cancel');
  cancel.type = 'button';
  const submit = element('button', 'btn-primary', 'Create group');
  submit.type = 'submit';
  actions.append(cancel, submit);

  form.append(body, error, actions);

  const description = element('p', 'ui-dialog-description', `Creating a group costs ${CREATE_COST} Bux.`);
  description.id = 'create-dialog-description';

  dialog.append(header, description, form);

  let pending = false;

  close.onclick = cancel.onclick = () => { if (!pending) window.closeDialog(dialog); };

  form.onsubmit = async event => {
    event.preventDefault();
    if (pending) return;
    error.hidden = true;

    const name = nameField.value.trim();
    const nameErr = groupNameError(name);
    if (nameErr) {
      error.textContent = nameErr;
      error.hidden = false;
      nameField.focus();
      return;
    }

    if (auth.currentUser && await banGuard(auth.currentUser.uid)) return;

    pending = true;
    dialog.setAttribute('aria-busy', 'true');
    for (const field of [close, cancel, submit, nameField, descField]) field.disabled = true;
    window.BloxVerseMotion.setPending(submit, true, 'Creating group');

    try {
      const created = await apiPost('/api/groups', { name, description: descField.value.trim() });
      // Lands on the new group rather than staying on the listing. The server returns
      // the new id, so this needs no second lookup. The dialog is closed first because
      // the finally below still runs once assign() is called.
      window.closeDialog(dialog);
      window.location.assign(`/bloxverse/groups?group=${encodeURIComponent(created.id)}`);
    } catch (e) {
      error.textContent = e.code === 'insufficient_bux'
        ? `Creating a group costs ${CREATE_COST} Bux.`
        : e.message;
      error.hidden = false;
    } finally {
      pending = false;
      dialog.removeAttribute('aria-busy');
      for (const field of [close, cancel, submit, nameField, descField]) field.disabled = false;
      window.BloxVerseMotion.setPending(submit, false);
    }
  };

  window.openDialog(dialog, { initialFocus: nameField, isBusy: () => pending });
}

// --- Single group -----------------------------------------------------------
// Ported from the reference group detail page (unused\uirevamp\group.js). The markup it
// fills is groupdetail.html verbatim; the strings, class names and interaction order
// follow the reference. Four things differ, all because of the platform:
//
//   - The group is opened as /bloxverse/groups?group=<id> rather than the reference's
//     /groups/<id> path, because the site is served as static files and that path
//     matches no file.
//   - Calls go through fetchApi with a Firebase bearer token instead of
//     credentials:'include', and a 401 redirects to the auth page rather than dropping
//     a vrtx_me cookie.
//   - VortexMotion is BloxVerseMotion; window.personCard and base.js button() are
//     ported below, because BloxVerse has no base.js.
//   - Strings are set with textContent instead of interpolating window.escapeHtml into
//     innerHTML. Same visible output, and a group called "<img onerror=...>" is shown
//     rather than executed.

const indexView = byId('groups-index');
const detailView = byId('group-detail');
const header = byId('group-header');
const tabs = byId('group-tabs');
const body = byId('group-body');

let detailId = null;
let group = null;
let me = null;
let tab = 'members';
let memberPage = 0;
let membersLoading = false;
// The page size the member endpoint uses (server/groups.js MEMBER_PAGE_SIZE, which
// matches the reference's hardcoded 50). It has to agree, or the page count here and
// the rows the server returns disagree and the last page reads as empty.
const MEMBER_PAGE_SIZE = 50;

function goLogin() {
  window.location.assign(`/bloxverse/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

/**
 * The reference's request(): send a write and turn any failure into an Error.
 *
 * The server's own message is preferred over the generic one so a group that was
 * deleted reads as "That group no longer exists." instead of a flat failure. A 401
 * redirects to sign-in and never resolves, matching the reference.
 */
async function request(path, method, fields, failMessage) {
  const res = await fetchApi(path, {
    method,
    headers: { ...(fields !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
    ...(fields !== undefined ? { body: JSON.stringify(fields) } : {}),
  });
  if (res.status === 401) {
    goLogin();
    return new Promise(() => {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || failMessage);
}

/** base.js button(), ported because BloxVerse has no base.js. */
function button(text, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  return b;
}

function infoMsg(text, role) {
  const p = element('p', 'info-msg', text);
  p.setAttribute('role', role);
  return p;
}

function load() {
  apiGet(`/api/groups/${encodeURIComponent(detailId)}`, { auth: true }).then(g => {
    group = g;
    me = currentUser && currentUser.uid ? currentUser : null;
    document.title = `${g.name} - BloxVerse`;
    render();
  }).catch(error => {
    // Only a failed *load* is reported as a missing group. render() is called after the
    // catch, deliberately: a bug while building the page would otherwise be shown to
    // the reader as "This group does not exist.", which is both wrong and unfixable by
    // retrying.
    header.replaceChildren();
    tabs.hidden = true;
    body.replaceChildren(infoMsg(
      error.status === 404 ? 'This group does not exist.' : 'Failed to load this group.',
      'alert'));
  });
}

function reload() {
  apiGet(`/api/groups/${encodeURIComponent(detailId)}`, { auth: true }).then(g => {
    group = g;
    render();
  }).catch(() => load());
}

function render() {
  renderHeader();
  renderTabs();
  renderTab();
}

function msg(text, isError) {
  const el = byId('group-msg');
  if (!el) return;
  el.textContent = text;
  el.className = 'group-msg' + (isError ? ' error' : '');
  el.hidden = false;
}

/**
 * The reference's metaChip(): an icon and a label in one pill.
 *
 * Takes nodes rather than a string because the owner chip contains a profile link, so
 * the label is not always plain text.
 */
function metaChip(icon, ...nodes) {
  const chip = element('span', 'ui-meta-chip');
  const glyph = element('i', `fa-solid ${icon}`);
  glyph.setAttribute('aria-hidden', 'true');
  const label = element('span');
  label.append(...nodes);
  chip.append(glyph, label);
  return chip;
}

function profileLink(uid, username) {
  const link = element('a', '', username);
  link.href = `/bloxverse/profile?user=${encodeURIComponent(uid)}`;
  return link;
}

function renderHeader() {
  const g = group;
  const action = element('div', 'group-head-action');

  if (!me) {
    const signinJoin = element('button', 'btn-primary', 'Join group');
    signinJoin.type = 'button';
    signinJoin.addEventListener('click', goLogin);
    action.append(signinJoin);
  } else if (g.is_member && !g.is_owner) {
    const leave = element('button', 'btn-secondary', 'Leave group');
    leave.type = 'button';
    leave.addEventListener('click', async () => {
      if (await banGuard(me.uid)) return;
      const done = await window.confirmAction({
        title: `Leave ${g.name}?`,
        description: 'You will lose access to this group and can rejoin later if it stays open.',
        confirmLabel: 'Leave group',
        pendingLabel: 'Leaving group',
        intent: 'danger',
        onConfirm: () => request(`/api/groups/${encodeURIComponent(detailId)}/leave`, 'POST', undefined, 'Could not leave this group.'),
      });
      if (done) load();
    });
    action.append(leave);
  } else if (!g.is_owner) {
    const join = element('button', 'btn-primary', 'Join group');
    join.type = 'button';
    join.addEventListener('click', async () => {
      if (await banGuard(me.uid)) return;
      join.disabled = true;
      window.BloxVerseMotion.setPending(join, true, 'Joining group');
      try {
        await request(`/api/groups/${encodeURIComponent(detailId)}/join`, 'POST', undefined, 'Could not join this group.');
        load();
      } catch (error) {
        msg(error.message, true);
        join.disabled = false;
        window.BloxVerseMotion.setPending(join, false);
      }
    });
    action.append(join);
  }

  const head = element('header', 'group-head');
  const emblem = element('img', 'group-head-emblem');
  emblem.src = DEFAULT_ICON;
  emblem.alt = '';
  emblem.width = 96;
  emblem.height = 96;

  const main = element('div', 'group-head-main');
  const title = element('h1', 'page-title', g.name);
  title.id = 'group-name';

  const meta = element('div', 'group-head-meta');
  const count = Number(g.member_count) || 0;
  meta.appendChild(metaChip('fa-user-group', element('strong', '', count.toLocaleString()),
    document.createTextNode(` member${count === 1 ? '' : 's'}`)));

  const ownerName = g.owner_username || 'Unknown';
  meta.appendChild(metaChip('fa-crown',
    document.createTextNode('Owned by '),
    ...(g.owner_id ? [profileLink(g.owner_id, ownerName)] : [document.createTextNode(ownerName)])));

  if (g.created_at) {
    const when = new Date(g.created_at);
    if (!Number.isNaN(when.getTime())) {
      meta.appendChild(metaChip('fa-calendar', document.createTextNode(
        `Created ${when.toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`)));
    }
  }

  main.append(title, meta);
  head.append(emblem, main, action);

  const desc = element('p', g.description ? 'group-desc' : 'group-desc muted',
    g.description || 'No description yet.');

  const message = element('p', 'group-msg');
  message.id = 'group-msg';
  message.setAttribute('role', 'alert');
  message.hidden = true;

  header.replaceChildren(head, desc, message);
}

function renderTabs() {
  tabs.hidden = false;
  tabs.querySelector('[data-tab="settings"]').hidden = !group.is_owner;
  if (tab === 'settings' && !group.is_owner) tab = 'members';
  tabs.querySelectorAll('.tab-btn').forEach(b => {
    const selected = b.dataset.tab === tab;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', String(selected));
    b.onclick = () => {
      if (tab === b.dataset.tab) return;
      tab = b.dataset.tab;
      renderTabs();
      renderTab();
    };
  });
}

function renderTab() {
  if (tab === 'settings' && group.is_owner) return renderSettings();
  return renderMembers(true);
}

/** The public member page, fetched separately from the group itself. */
async function fetchMembers(page) {
  const res = await fetchApi(`/api/groups/${encodeURIComponent(detailId)}/members?page=${page}`);
  if (!res.ok) throw new Error('Failed to load members.');
  return res.json();
}

function renderMembers(reset) {
  if (membersLoading) return;
  if (reset) {
    memberPage = 0;
    const list = element('div', 'member-list');
    list.id = 'member-list';
    list.setAttribute('aria-busy', 'true');
    const status = element('p', 'info-msg');
    status.id = 'member-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    const pages = element('div', 'pagination');
    pages.id = 'member-pagination';
    body.replaceChildren(list, status, pages);
  }

  const status = byId('member-status');
  const list = byId('member-list');
  const pagination = byId('member-pagination');
  pagination.querySelectorAll('button').forEach(b => { b.disabled = true; });
  list.setAttribute('aria-busy', 'true');
  membersLoading = true;

  fetchMembers(memberPage).then(d => {
    list.replaceChildren(...d.items.map(memberCard));
    window.BloxVerseMotion.reveal(list);
    status.hidden = d.items.length > 0;
    if (!d.items.length) status.textContent = 'This group has no members yet.';
    renderPagination(pagination, memberPage, Math.ceil((d.total || 0) / MEMBER_PAGE_SIZE), p => {
      memberPage = p;
      renderMembers(false);
    });
  }).catch(() => {
    status.hidden = false;
    status.textContent = 'Failed to load members.';
    pagination.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }).finally(() => {
    membersLoading = false;
    list.setAttribute('aria-busy', 'false');
  });
}

function memberAction(icon, text, label, className) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = className;
  control.setAttribute('role', 'menuitem');
  control.setAttribute('aria-label', label);
  const glyph = element('i', `fa-solid ${icon}`);
  glyph.setAttribute('aria-hidden', 'true');
  control.append(glyph, element('span', '', text));
  return control;
}

function memberActions(m) {
  const menu = document.createElement('div');
  menu.className = 'member-actions-menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'btn-ghost btn-icon btn-sm';
  trigger.setAttribute('aria-label', `Actions for ${m.username}`);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const glyph = element('i', 'fa-solid fa-ellipsis');
  glyph.setAttribute('aria-hidden', 'true');
  trigger.appendChild(glyph);

  const panel = document.createElement('div');
  panel.id = `member-actions-${m.user_id}`;
  panel.className = 'member-actions-popover';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', `Actions for ${m.username}`);
  panel.setAttribute('popover', 'auto');
  trigger.setAttribute('popovertarget', panel.id);
  trigger.setAttribute('aria-controls', panel.id);

  const promote = memberAction('fa-crown', 'Transfer ownership', `Make ${m.username} the owner`, 'member-action');
  promote.addEventListener('click', async () => {
    panel.hidePopover();
    const done = await window.confirmAction({
      title: `Make ${m.username} the owner?`,
      description: `${m.username} will take full control of ${group.name}. You will stay a member but lose owner access.`,
      confirmLabel: 'Transfer ownership',
      pendingLabel: 'Transferring ownership',
      intent: 'danger',
      onConfirm: () => request(`/api/groups/${encodeURIComponent(detailId)}/transfer`, 'POST', { user_id: m.user_id }, 'Could not transfer ownership.'),
    });
    if (done) load();
  });

  const kick = memberAction('fa-user-minus', 'Remove member', `Remove ${m.username} from this group`, 'member-action member-action-danger');
  kick.addEventListener('click', async () => {
    panel.hidePopover();
    if (me && await banGuard(me.uid)) return;
    const done = await window.confirmAction({
      title: `Remove ${m.username}?`,
      description: `${m.username} will be removed from ${group.name} and can rejoin later.`,
      confirmLabel: 'Remove member',
      pendingLabel: 'Removing member',
      intent: 'danger',
      onConfirm: () => request(`/api/groups/${encodeURIComponent(detailId)}/members/${encodeURIComponent(m.user_id)}`, 'DELETE', undefined, 'Could not remove this member.'),
    });
    if (done) renderMembers(false);
  });

  panel.append(promote, kick);
  menu.append(trigger, panel);

  // The popover is anchored to the trigger on open, flipping above it when there is no
  // room below. Kept as the reference has it.
  panel.addEventListener('toggle', event => {
    const open = event.newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) return;
    requestAnimationFrame(() => {
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const left = Math.min(window.innerWidth - panelRect.width - 8, Math.max(8, triggerRect.right - panelRect.width));
      let top = triggerRect.bottom + 8;
      if (top + panelRect.height > window.innerHeight - 8 && triggerRect.top > panelRect.height + 8) {
        top = triggerRect.top - panelRect.height - 8;
      }
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });
  });

  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (!panel.matches(':popover-open')) panel.showPopover();
    const items = [...panel.querySelectorAll('[role="menuitem"]')];
    requestAnimationFrame(() => (event.key === 'ArrowDown' ? items[0] : items.at(-1))?.focus());
  });

  panel.addEventListener('keydown', event => {
    const items = [...panel.querySelectorAll('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = items[(current + 1) % items.length];
    if (event.key === 'ArrowUp') next = items[(current - 1 + items.length) % items.length];
    if (event.key === 'Home') next = items[0];
    if (event.key === 'End') next = items.at(-1);
    if (!next) return;
    event.preventDefault();
    next.focus();
  });

  return menu;
}

/**
 * base.js personCard(), ported.
 *
 * The reference resolves the avatar by asking the server for a layered rig on demand.
 * BloxVerse has no such endpoint, so the member row carries an already-resolved
 * `avatar` URL (the head crop where the profile has one) and this only adds the
 * fallback: a stored Cloudinary URL can 404 after a re-upload, so a broken one falls
 * back to the generic silhouette rather than leaving a torn-image glyph in the row.
 */
function avatarImage(url, username, className) {
  const img = document.createElement('img');
  img.className = className;
  img.alt = username;
  img.decoding = 'async';
  img.dataset.avatarState = 'loading';
  img.src = url || DEFAULT_AVATAR;
  img.addEventListener('load', () => {
    if (!img.src.endsWith('/icons/profile.svg')) img.dataset.avatarState = 'ready';
  });
  img.addEventListener('error', () => {
    if (img.dataset.avatarState === 'fallback') return;
    img.dataset.avatarState = 'fallback';
    img.src = DEFAULT_AVATAR;
  });
  return img;
}

function personCard({ id, username, avatar = '', meta = null, actions = [], cardClass = '', nameClass = '' }) {
  const href = `/bloxverse/profile?user=${encodeURIComponent(id)}`;

  const card = element('div', `ui-card ui-card-interactive person-card person-card-row ${cardClass}`.trim());
  card.id = `card-${id}`;

  const portrait = element('a', 'avatar-frame person-card-portrait');
  portrait.href = href;
  portrait.tabIndex = -1;
  portrait.setAttribute('aria-hidden', 'true');
  portrait.appendChild(avatarImage(avatar, username, 'avatar-image avatar-image-contain person-card-avatar'));

  const cardBody = element('div', 'person-card-body');
  const name = element('a', `person-card-name ${nameClass}`.trim());
  name.href = href;
  name.textContent = username;
  name.title = username;
  cardBody.appendChild(name);

  if (meta) {
    const metaNode = meta instanceof Node ? meta : element('span', '', String(meta));
    metaNode.className = `person-card-meta ${metaNode.className || ''}`.trim();
    cardBody.appendChild(metaNode);
  }

  card.append(portrait, cardBody);

  if (actions.length) {
    const wrap = element('div', 'person-card-actions');
    actions.forEach(action => wrap.appendChild(action));
    card.appendChild(wrap);
  }
  return card;
}

function memberCard(m) {
  const role = element('span', 'member-role-tag');
  role.textContent = m.is_owner
    ? 'Owner'
    : (m.joined_at
      ? `Joined ${new Date(m.joined_at).toLocaleString(undefined, { month: 'short', year: 'numeric' })}`
      : 'Member');
  if (m.is_owner) role.classList.add('is-owner');

  return personCard({
    id: m.user_id,
    username: m.username,
    avatar: m.avatar || '',
    meta: role,
    actions: group.is_owner && !m.is_owner ? [memberActions(m)] : [],
    cardClass: 'member-card',
    nameClass: 'member-name',
  });
}

/**
 * One editable group field, from the reference's editableField().
 *
 * The value is kept on the read view's dataset so cancelling restores it, and the save
 * button stays disabled until the text actually differs from what was loaded.
 */
function editableField({ label, value, placeholder, maxlen, key, multiline }) {
  const box = element('section', 'ui-card bio-box');

  const head = element('div', 'bio-label');
  head.appendChild(element('h2', '', label));

  const text = element('p', 'bio-text');
  text.dataset.val = value || '';
  if (value) {
    text.textContent = value;
  } else {
    text.classList.add('empty');
    text.textContent = placeholder;
  }

  const edit = element('button', 'btn-ghost row-edit');
  edit.type = 'button';
  const pencil = element('i', 'fa-solid fa-pen');
  pencil.setAttribute('aria-hidden', 'true');
  edit.append(pencil, document.createTextNode(' Edit'));
  edit.setAttribute('aria-label', `Edit ${label.toLowerCase()}`);
  edit.setAttribute('aria-expanded', 'false');
  head.appendChild(edit);

  edit.onclick = () => {
    if (box.querySelector('.bio-editor')) return;
    text.hidden = true;
    edit.disabled = true;
    edit.setAttribute('aria-expanded', 'true');

    const editor = element('div', 'bio-editor');

    const field = document.createElement(multiline ? 'textarea' : 'input');
    field.className = 'ui-input';
    if (!multiline) field.type = 'text';
    field.maxLength = maxlen;
    field.value = text.dataset.val || '';
    field.placeholder = placeholder;
    field.setAttribute('aria-label', label);
    editor.appendChild(field);

    const error = element('p', 'bio-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    editor.appendChild(error);

    const footer = element('div', 'bio-editor-footer');
    const counter = element('span', 'bio-counter');
    const cancel = button('Cancel', 'btn-secondary');
    const save = button('Save', 'btn-primary');

    const orig = text.dataset.val || '';
    const sync = () => {
      counter.textContent = `${field.value.length} / ${maxlen}`;
      save.disabled = field.value.trim() === orig;
    };
    field.addEventListener('input', sync);
    sync();

    const close = () => {
      editor.remove();
      text.hidden = false;
      edit.disabled = false;
      edit.setAttribute('aria-expanded', 'false');
      edit.focus({ preventScroll: true });
    };
    cancel.onclick = close;
    save.onclick = async () => {
      if (save.disabled) return;
      const val = field.value.trim();
      error.hidden = true;
      if (key === 'name') {
        const nameErr = groupNameError(val);
        if (nameErr) { error.textContent = nameErr; error.hidden = false; field.focus(); return; }
      }
      if (me && await banGuard(me.uid)) { sync(); return; }
      save.disabled = true;
      cancel.disabled = true;
      window.BloxVerseMotion.setPending(save, true, 'Saving');
      try {
        await request(`/api/groups/${encodeURIComponent(detailId)}`, 'PATCH', { [key]: val }, 'Could not save this change.');
        reload();
      } catch (failure) {
        error.textContent = failure.message;
        error.hidden = false;
        cancel.disabled = false;
        window.BloxVerseMotion.setPending(save, false);
        sync();
      }
    };

    footer.append(counter, cancel, save);
    editor.appendChild(footer);
    box.appendChild(editor);
    field.focus();
  };

  box.append(head, text);
  return box;
}

function renderSettings() {
  const fields = element('div');
  fields.id = 'group-fields';

  const actions = element('div', 'owner-actions');

  const transferRow = element('div', 'settings-row danger-row');
  const transferInfo = element('div', 'row-info');
  transferInfo.appendChild(element('span', 'row-label', 'Transfer ownership'));
  transferInfo.appendChild(element('p', 'row-desc',
    'Open the Members tab and choose Transfer ownership from that member\'s actions menu.'));
  const goMembers = element('button', 'btn-secondary', 'View members');
  goMembers.type = 'button';
  goMembers.addEventListener('click', () => {
    tab = 'members';
    renderTabs();
    renderTab();
  });
  transferRow.append(transferInfo, goMembers);

  const deleteRow = element('div', 'settings-row danger-row');
  const deleteInfo = element('div', 'row-info');
  deleteInfo.appendChild(element('span', 'row-label', 'Delete this group'));
  deleteInfo.appendChild(element('p', 'row-desc',
    'Permanently delete this group and remove all members. This cannot be undone.'));
  const deleteGroup = element('button', 'btn-danger', 'Delete group');
  deleteGroup.type = 'button';
  deleteGroup.addEventListener('click', async () => {
    if (me && await banGuard(me.uid)) return;
    const done = await window.confirmAction({
      title: `Delete ${group.name}?`,
      description: 'This permanently deletes the group and removes every member. This cannot be undone.',
      confirmLabel: 'Delete group',
      pendingLabel: 'Deleting group',
      intent: 'danger',
      onConfirm: () => request(`/api/groups/${encodeURIComponent(detailId)}`, 'DELETE', undefined, 'Could not delete this group.'),
    });
    if (done) window.location.assign('/bloxverse/groups');
  });
  deleteRow.append(deleteInfo, deleteGroup);

  actions.append(transferRow, deleteRow);
  body.replaceChildren(fields, actions);

  fields.appendChild(editableField({
    label: 'Name', value: group.name, placeholder: 'Group name',
    maxlen: 50, key: 'name', multiline: false,
  }));
  fields.appendChild(editableField({
    label: 'Description', value: group.description || '', placeholder: 'Describe your group',
    maxlen: 1000, key: 'description', multiline: true,
  }));
}
// Search is debounced so a five-letter query is one request, not five.
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = searchInput.value.trim();
    loadGroups(0);
  }, 250);
});

sortSelect.addEventListener('change', () => loadGroups(0));
retryButton.addEventListener('click', () => loadGroups(page));

createToggle.addEventListener('click', async () => {
  // banGuard is async, so this must be awaited: an unawaited Promise is always truthy
  // and would return early on every click.
  if (currentUser && await banGuard(currentUser.uid)) return;
  openCreateDialog();
});

// One document serves both views: ?group=<id> opens the group, no parameter opens the
// listing. This mirrors catalog.html?item= and profile.html?user= and keeps a group
// linkable, which the reference's /groups/<id> path could not be on a static host.
//
// Swapping the two views and putting group-page on <body> is what groupdetail.html does
// by being a separate document; the class is in its <body> there, so it has to be added
// here or the detail page is styled as the listing.
detailId = new URLSearchParams(window.location.search).get('group');
if (detailId) {
  detailView.hidden = false;
  indexView.hidden = true;
  document.body.classList.add('group-page');
  load();
} else loadGroups(0);

// The listing is public, so it loads signed out. Create and "My groups" appear once
// Firebase resolves an identity, matching the reference's window.getMe() gate.
//
// The listing is re-fetched only when the signed-in state actually flips. It was first
// requested with no token, so without this the viewer would keep seeing their own
// groups under Explore until they searched or changed page.
let wasSignedIn = false;
onAuthStateChanged(auth, user => {
  currentUser = user;
  const signedIn = !!user;
  createToggle.hidden = !user;

  if (detailId) {
    // Re-read once an identity arrives (or is cleared on sign out): the response
    // carries is_member/is_owner, which decide between Join, Leave and the owner
    // Settings tab.
    load();
    if (user) loadMine();
  } else {
    if (user) loadMine();
    if (signedIn !== wasSignedIn) loadGroups(page);
  }

  wasSignedIn = signedIn;
});
