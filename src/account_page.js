// Account / settings page.
//
// Ported from the Vortex reference unused\uirevamp\account.html + settings.js.
// The reference talks to a REST backend (/api/users/me, PATCH /api/users/me/email,
// the 2fa endpoints). BloxVerse has no such session API: identity lives in
// Firebase Auth and profile fields in the user document, so the same flows run
// against those instead.
//
//   account rows, verification, password, email -> Firebase Auth + users/{uid}
//   2FA setup / verify / recovery / disable   -> our own /api/2fa/* node
//   theme + UI style                          -> src/theme.js, localStorage
//   sessions                                  -> users/{uid}.sessionEpoch only
//
// Firestore field names are unchanged from the previous settings page, so every
// existing setting keeps working. The two things the reference drops -- the
// Customization tab and the privacy toggles -- are kept, because on BloxVerse
// they are the only UI for settings that are actually live.

import { onAuthStateChanged, signOut, updateEmail, updatePassword, sendEmailVerification, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth, db, getDoc, doc, setDoc, calculateAge, revokeOtherSessions, assignUserIdNum, trackPresence, banGuard } from './firebase.js';
import { fetchApi } from './api.js';
import {
  getThemeFamilies, getThemeFamily, buildTheme, getMode, getTheme, setTheme, THEME_CHANGE_EVENT,
} from './theme.js';
import { renderAccountCluster } from './shell.js';

const $ = (id) => document.getElementById(id);
const CHECK_SVG = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS_SVG = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>';

const TABS = ['account', 'security', 'sessions', 'customization'];
const MOBILE = '(max-width: 800px)';
const VOICE_MIN_AGE = 13;
// The only values the select can produce. Anything else stored on the profile
// (an older value, a hand-edited document) falls back rather than leaving the
// control blank.
const PRIVACY_VALUES = ['public', 'friends'];
const storedPrivacy = () => (PRIVACY_VALUES.includes(data.profilePrivacy) ? data.profilePrivacy : 'public');

let user = null;
let data = {};
let activeTab = 'account';
let backupCodes = [];
// Held only for the length of the enable flow so step 3 can mint recovery codes
// without asking for the password a second time. Never persisted.
let setupPassword = '';

// -- dialogs ---------------------------------------------------------------

// openDialog() defaults removeOnClose to true, which would detach the static
// dialogs in account.html after their first close. These are declared in the
// markup, so every open has to opt out.
const showDialog = (dialog, initialFocus) => window.openDialog(dialog, {
  removeOnClose: false,
  initialFocus: initialFocus || undefined,
});

const hideDialog = (dialog) => window.closeDialog(dialog);

document.addEventListener('click', (event) => {
  const closer = event.target.closest('[data-close-dialog]');
  if (!closer) return;
  const dialog = closer.closest('dialog');
  if (dialog) hideDialog(dialog);
});

const setError = (el, message) => {
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
};

const setSuccess = (el, message) => {
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
};

// Every "open" button just resets its dialog and shows it.
const openForm = (id, { error, success, form } = {}) => {
  const dialog = $(id);
  if (error) setError($(error), '');
  if (success) setSuccess($(success), '');
  if (form) $(form).reset();
  showDialog(dialog);
};

// Submits are disabled while in flight so a double click cannot fire twice.
async function withBusy(button, work) {
  const was = button.textContent;
  button.disabled = true;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.textContent = was;
  }
}

function submitButton(form) {
  return form.querySelector('button[type="submit"]');
}

// -- api -------------------------------------------------------------------

// The node returns { error } on failure rather than the reference's { detail }.
async function postJson(path, body) {
  const res = await fetchApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const isRecoveryCode = (value) => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(value);

// Our 2FA endpoints accept either a live 6-digit code or an unused recovery code.
function codeFields(value) {
  const trimmed = value.trim();
  return isRecoveryCode(trimmed)
    ? { recoveryCode: trimmed.toUpperCase() }
    : { code: trimmed };
}

function authMessage(error) {
  switch (error?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'That password is not correct.';
    case 'auth/email-already-in-use':
      return 'Another account already uses that email address.';
    case 'auth/weak-password':
      return 'Passwords must be at least 6 characters.';
    case 'auth/requires-recent-login':
      return 'Please sign out and back in, then try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return error?.message || 'Something went wrong. Please try again.';
  }
}

const writeUser = (fields) => setDoc(doc(db, 'users', user.uid), fields, { merge: true });

// -- rendering -------------------------------------------------------------

function setStatusIcon(el, ok, okTitle, badTitle) {
  el.hidden = false;
  el.innerHTML = ok ? CHECK_SVG : CROSS_SVG;
  el.title = ok ? okTitle : badTitle;
  el.className = 'status-icon ' + (ok ? 'enabled' : 'disabled');
}

function formatDob(value) {
  if (!value) return 'Not set';
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y) return 'Not set';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

const recoveryCodesLeft = () => {
  const codes = Array.isArray(data.recoveryCodes) ? data.recoveryCodes : [];
  return Math.max(0, codes.length - (data.recoveryCodesUsed || 0));
};

function canUseVoice() {
  return calculateAge(data.birthday) >= VOICE_MIN_AGE;
}

function renderAccount() {
  const name = data.username || 'Player';
  $('sidebar-username').textContent = name;
  $('display-username').textContent = name;

  const wrap = $('profile-avatar-wrap');
  wrap.replaceChildren();
  if (data.avatarPreviewHead) {
    const img = document.createElement('img');
    img.src = data.avatarPreviewHead;
    img.alt = '';
    wrap.append(img);
  } else {
    const initial = document.createElement('span');
    initial.textContent = (name[0] || '?').toUpperCase();
    initial.setAttribute('aria-hidden', 'true');
    wrap.append(initial);
  }

  $('current-email').textContent = user.email || 'No email set';
  setStatusIcon($('email-status-icon'), !!user.emailVerified, 'Verified', 'Not verified');
  $('email-verify-open').hidden = !!user.emailVerified;
  $('current-dob').textContent = formatDob(data.birthday);

  const requested = !!data.accountDeletionRequested;
  const button = $('delete-account-open');
  button.disabled = requested;
  button.textContent = requested ? 'Requested' : 'Delete Account';
  $('account-deletion-desc').textContent = requested
    ? `Deletion requested${data.accountDeletionScheduledFor ? ` and scheduled for ${formatDob(String(data.accountDeletionScheduledFor).slice(0, 10))}` : ''}. Sign in again before then to cancel it.`
    : 'Permanently delete your BloxVerse account and all associated data.';
}

function renderSecurity() {
  $('password-state').textContent = data.passwordLength
    ? `Set (${data.passwordLength} characters)`
    : 'No password set';

  const enabled = !!data.totpEnabled;
  const codesLeft = recoveryCodesLeft();
  const codesButton = $('twofa-codes-open');
  const codesHint = $('twofa-codes-left');
  codesButton.hidden = !enabled;
  codesHint.hidden = !enabled;
  if (enabled) {
    codesHint.textContent = codesLeft === 1
      ? '1 unused recovery code left.'
      : `${codesLeft} unused recovery codes left.`;
  }
  setStatusIcon($('twofa-status-icon'), enabled, 'Enabled', 'Disabled');
  $('twofa-enable').hidden = enabled;
  $('twofa-disable-open').hidden = !enabled;

  $('profile-privacy').value = storedPrivacy();

  const voiceOk = canUseVoice();
  const voice = $('voice-chat');
  voice.disabled = !voiceOk;
  voice.checked = voiceOk && data.voiceEnabled === true;
  $('voice-chat-desc').textContent = voiceOk
    ? 'Allow voice chat in experiences that support it'
    : 'Voice chat is only available for 13+ accounts';

  $('ai-optout').checked = !!data.dataCollectionOptOut;
  $('rpc-toggle').checked = rpcEnabled();
}

function renderSessions() {
  const list = $('sessions-list');
  list.replaceChildren();

  const row = document.createElement('div');
  row.className = 'settings-row';

  const info = document.createElement('div');
  info.className = 'row-info';

  const label = document.createElement('div');
  label.className = 'label-icon';
  const name = document.createElement('span');
  name.className = 'row-label';
  name.textContent = `${formatDevice(navigator.userAgent)} (This device)`;
  label.append(name);

  const desc = document.createElement('p');
  desc.className = 'row-desc';
  desc.id = 'session-ip';
  desc.textContent = 'Looking up your IP address...';

  info.append(label, desc);
  row.append(info);
  list.append(row);

  // The IP lookup is cosmetic and rate-limited by a third party, so a failure
  // just leaves the row describing the device rather than blocking the tab.
  fetch('https://api.ipify.org?format=json')
    .then((res) => res.json())
    .then((body) => { desc.textContent = `${body.ip} - Signed in on this device`; })
    .catch(() => { desc.textContent = 'Signed in on this device'; });
}

function formatDevice(ua) {
  if (!ua) return 'Unknown device';
  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

  let os = '';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  if (browser === 'Unknown browser' && !os) return 'Unknown device';
  return os ? `${browser} on ${os}` : browser;
}

// -- tabs and the mobile disclosure ---------------------------------------

const tabs = [...document.querySelectorAll('.sidebar-tab')];
const menuToggle = $('settings-menu-toggle');
const menuPanel = $('settings-menu-panel');
const menuLabel = $('settings-menu-label');
const menuIcon = $('settings-menu-icon');
const mobile = window.matchMedia(MOBILE);

function setMenuExpanded(expanded) {
  // The panel is always open on desktop, so the trigger only means anything
  // below the breakpoint.
  const open = !mobile.matches || expanded;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} settings sections, ${menuLabel.textContent}`);
  menuPanel.inert = !open;
}

function setTab(tab, { pushUrl = true } = {}) {
  const target = tabs.find((el) => el.dataset.tab === tab);
  if (!target || target.classList.contains('disabled')) return false;

  for (const el of tabs) {
    el.classList.remove('active');
    el.removeAttribute('aria-current');
  }
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));

  target.classList.add('active');
  target.setAttribute('aria-current', 'page');
  $(`tab-${tab}`).classList.add('active');
  activeTab = tab;
  menuLabel.textContent = target.querySelector('span').textContent;
  menuIcon.className = target.querySelector('i').className;

  const restoreFocus = mobile.matches && menuPanel.contains(document.activeElement);
  setMenuExpanded(false);
  if (restoreFocus) menuToggle.focus({ preventScroll: true });

  // A query param rather than the reference's /settings/<tab> path, because
  // this is a static host where a deep path would 404 on reload.
  if (pushUrl) {
    const url = new URL(location.href);
    url.searchParams.set('tab', tab);
    history.replaceState(null, '', url);
  }

  if (tab === 'sessions') renderSessions();
  return true;
}

function initSettingsNavigation() {
  menuToggle.addEventListener('click', () => {
    setMenuExpanded(menuToggle.getAttribute('aria-expanded') !== 'true');
  });

  menuToggle.parentElement.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !mobile.matches || menuToggle.getAttribute('aria-expanded') !== 'true') return;
    event.preventDefault();
    event.stopPropagation();
    setMenuExpanded(false);
    menuToggle.focus({ preventScroll: true });
  });

  mobile.addEventListener('change', () => {
    const focusInPanel = menuPanel.contains(document.activeElement);
    const focusOnToggle = document.activeElement === menuToggle;
    setMenuExpanded(false);
    if (mobile.matches && focusInPanel) menuToggle.focus({ preventScroll: true });
    else if (!mobile.matches && focusOnToggle) tabs.find((t) => t.classList.contains('active'))?.focus({ preventScroll: true });
  });

  for (const tab of tabs) {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      setTab(tab.dataset.tab);
    });
  }

  window.addEventListener('popstate', () => {
    const requested = new URL(location.href).searchParams.get('tab');
    if (!setTab(requested || 'account', { pushUrl: false })) setTab('account', { pushUrl: false });
  });

  const requested = new URL(location.href).searchParams.get('tab');
  if (!setTab(requested || 'account', { pushUrl: false })) setTab('account', { pushUrl: false });
}

// -- theme -----------------------------------------------------------------

function renderTheme() {
  const current = getTheme();
  $('theme-mode').value = getMode(current);

  const active = getThemeFamily(current);
  $('theme-families').replaceChildren(...getThemeFamilies().map((family) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-card';
    card.dataset.family = family.key;

    const selected = family.key === active;
    card.classList.toggle('active', selected);
    card.setAttribute('aria-pressed', String(selected));

      // The family exposes swatchDark/swatchLight, not dark/light. Reading the
      // wrong names left every swatch with no background at all.
      const swatch = document.createElement('span');
      swatch.className = 'theme-card-swatch';
      // backgroundImage, not the background shorthand: the shorthand resets
      // background-clip, which left the stylesheet's padding-box clip dead and
      // the gradient painting under the border, bleeding through the rounded
      // corners.
      swatch.style.backgroundImage =
        `linear-gradient(135deg, ${family.swatchDark} 0%, ${family.swatchDark} 50%, ${family.swatchLight} 50%, ${family.swatchLight} 100%)`;

    const label = document.createElement('span');
    label.className = 'theme-card-label';
    label.textContent = family.label;

    card.append(swatch, label);

    if (selected) {
      const check = document.createElement('span');
      check.className = 'theme-card-check';
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML = CHECK_SVG;
      card.append(check);
    }
    return card;
  }));
}

function initThemeControls() {
  $('theme-mode').addEventListener('change', (event) => {
    setTheme(buildTheme(getThemeFamily(getTheme()), event.target.value));
    renderTheme();
  });

  $('theme-families').addEventListener('click', (event) => {
    const card = event.target.closest('[data-family]');
    if (!card) return;
    setTheme(buildTheme(card.dataset.family, getMode(getTheme())));
    renderTheme();
  });

  // The sun/moon button in the shell flips the mode too, so follow it rather
  // than leaving the dropdown showing the previous value.
  document.addEventListener(THEME_CHANGE_EVENT, renderTheme);

  renderTheme();
}

// -- account actions -------------------------------------------------------

$('email-change-open').addEventListener('click', () => openForm('email-modal', { error: 'email-err', form: 'email-form' }));

$('email-verify-open').addEventListener('click', () => {
  openForm('email-verify-modal', { error: 'email-verify-err', success: 'email-verify-success' });
});

$('send-verify').addEventListener('click', (event) => withBusy(event.currentTarget, async () => {
  setError($('email-verify-err'), '');
  setSuccess($('email-verify-success'), '');
  try {
    await sendEmailVerification(user);
    setSuccess($('email-verify-success'), "Verification email sent! If you don't see it, check your spam folder.");
  } catch (error) {
    setError($('email-verify-err'), authMessage(error));
  }
}));

$('email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const err = $('email-err');
  setError(err, '');

  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email) return setError(err, 'Enter a new email address.');

  await withBusy(submitButton(form), async () => {
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      await updateEmail(user, email);
      form.reset();
      renderAccount();
      setSuccess($('email-verify-success'), 'Email updated.');
      hideDialog($('email-modal'));
    } catch (error) {
      setError(err, authMessage(error));
    }
  });
});

$('password-change-open').addEventListener('click', () => openForm('password-modal', { error: 'password-err', success: 'password-success', form: 'password-form' }));

$('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const err = $('password-err');
  setError(err, '');
  setSuccess($('password-success'), '');

  const current = form.current_password.value;
  const next = form.new_password.value;
  if (next !== form.confirm_password.value) return setError(err, 'Passwords do not match.');
  if (next.length < 6) return setError(err, 'Password must be at least 6 characters.');

  await withBusy(submitButton(form), async () => {
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await updatePassword(user, next);
      // The previous page stored only the length; keep writing it so anything
      // reading the field keeps working.
      await writeUser({ passwordLength: next.length });
      data.passwordLength = next.length;
      form.reset();
      renderSecurity();
      setSuccess($('password-success'), 'Password updated.');
    } catch (error) {
      setError(err, authMessage(error));
    }
  });
});

$('dob-open').addEventListener('click', () => {
  openForm('dob-modal', { error: 'dob-err', form: 'dob-form' });
  const input = $('dob-input');
  const today = new Date();
  input.max = today.toISOString().slice(0, 10);
  input.min = '1926-01-01';
  if (data.birthday) input.value = String(data.birthday).slice(0, 10);
});

$('dob-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const err = $('dob-err');
  setError(err, '');

  const birthday = form.birthday.value;
  if (!birthday) return setError(err, 'Pick a date of birth.');

  await withBusy(submitButton(form), async () => {
    try {
      await writeUser({ birthday });
      data.birthday = birthday;
      // Under 13 loses voice chat immediately, the same rule the previous page
      // applied on save.
      if (!canUseVoice() && data.voiceEnabled === true) {
        await writeUser({ voiceEnabled: false });
        data.voiceEnabled = false;
        mirrorVoiceLocal(false);
      }
      renderAccount();
      renderSecurity();
      hideDialog($('dob-modal'));
    } catch (error) {
      setError(err, error.message || 'Could not save your date of birth.');
    }
  });
});

$('delete-account-open').addEventListener('click', () => openForm('delete-account-modal', { error: 'delete-account-err' }));

$('delete-account-confirm').addEventListener('click', (event) => withBusy(event.currentTarget, async () => {
  setError($('delete-account-err'), '');
  try {
    const now = new Date();
    const scheduled = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await writeUser({
      accountDeletionRequested: true,
      accountDeletionRequestedAt: now.toISOString(),
      accountDeletionScheduledFor: scheduled.toISOString(),
      accountDeletionStatus: 'pending',
    });
    data.accountDeletionRequested = true;
    data.accountDeletionScheduledFor = scheduled.toISOString();
    renderAccount();
    hideDialog($('delete-account-modal'));
    setSuccess($('email-verify-success'), '');
  } catch (error) {
    setError($('delete-account-err'), error.message || 'Failed to request account deletion.');
  }
}));

// -- security actions ------------------------------------------------------

function showTwofaStep(step) {
  for (const name of ['password', 'qr', 'codes']) {
    $(`twofa-step-${name}`).hidden = name !== step;
  }
}

function openTwofaSetup() {
  setupPassword = '';
  setError($('twofa-err'), '');
  $('twofa-modal-title').textContent = 'Enable Two-Factor Authentication';
  $('twofa-setup-form').reset();
  $('twofa-confirm-form').reset();
  showTwofaStep('password');
  showDialog($('twofa-modal'), $('twofa-setup-password'));
}

$('twofa-enable').addEventListener('click', openTwofaSetup);

$('twofa-setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const err = $('twofa-err');
  setError(err, '');

  await withBusy(submitButton(form), async () => {
    try {
      const password = form.current_password.value;
      const res = await postJson('/api/2fa/setup', { email: user.email, password, username: data.username || '' });
      setupPassword = password;
      $('twofa-qr').src = res.qr_code || '';
      $('twofa-secret').textContent = res.secret || '';
      showTwofaStep('qr');
      $('twofa-confirm-code').focus();
    } catch (error) {
      setError(err, error.message);
    }
  });
});

$('twofa-confirm-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const err = $('twofa-err');
  setError(err, '');

  await withBusy(submitButton(form), async () => {
    try {
      const secret = $('twofa-secret').textContent.trim();
      await postJson('/api/2fa/verify', { email: user.email, code: form.code.value.trim(), secret });
      await writeUser({ totpSecret: secret, totpEnabled: true });
      data.totpSecret = secret;
      data.totpEnabled = true;

      // Mint the recovery codes straight away, reusing the password the user
      // typed in step 1, so the codes appear exactly once like the reference.
      const generated = await postJson('/api/2fa/generate-recovery', {
        email: user.email,
        password: setupPassword,
        secret,
        code: form.code.value.trim(),
      });
      setupPassword = '';
      await writeUser({ recoveryCodes: generated.hashedCodes || [], recoveryCodesUsed: 0 });
      data.recoveryCodes = generated.hashedCodes || [];
      data.recoveryCodesUsed = 0;
      renderSecurity();
      showRecoveryCodes('Save Your Recovery Codes', generated.codes || []);
    } catch (error) {
      setError(err, error.message);
    }
  });
});

function showRecoveryCodes(title, codes) {
  backupCodes = codes;
  $('twofa-codes-list').replaceChildren(...codes.map((code) => {
    const li = document.createElement('li');
    li.textContent = code;
    return li;
  }));
  $('twofa-modal-title').textContent = title;
  $('twofa-codes-copy').textContent = 'Copy Codes';
  setError($('twofa-err'), '');
  showTwofaStep('codes');
  showDialog($('twofa-modal'), $('twofa-codes-done'));
}

$('twofa-codes-copy').addEventListener('click', async (event) => {
  try {
    await navigator.clipboard.writeText(backupCodes.join('\n'));
    event.currentTarget.textContent = 'Copied!';
  } catch {
    event.currentTarget.textContent = 'Copy failed - select them manually';
  }
});

$('twofa-codes-done').addEventListener('click', () => {
  backupCodes = [];
  hideDialog($('twofa-modal'));
});

$('twofa-codes-open').addEventListener('click', () => openForm('twofa-regen-modal', { error: 'twofa-regen-err', form: 'twofa-regen-form' }));

$('twofa-regen-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const err = $('twofa-regen-err');
  setError(err, '');

  await withBusy(submitButton(form), async () => {
    try {
      const generated = await postJson('/api/2fa/generate-recovery', {
        email: user.email,
        password: form.current_password.value,
        secret: data.totpSecret,
        ...codeFields(form.code.value),
        ...(isRecoveryCode(form.code.value.trim()) ? { recoveryCodes: data.recoveryCodes || [] } : {}),
      });
      await writeUser({ recoveryCodes: generated.hashedCodes || [], recoveryCodesUsed: 0 });
      data.recoveryCodes = generated.hashedCodes || [];
      data.recoveryCodesUsed = 0;
      renderSecurity();
      hideDialog($('twofa-regen-modal'));
      showRecoveryCodes('Your New Recovery Codes', generated.codes || []);
    } catch (error) {
      setError(err, error.message);
    }
  });
});

$('twofa-disable-open').addEventListener('click', () => openForm('twofa-disable-modal', { error: 'twofa-disable-err', form: 'twofa-disable-form' }));

$('twofa-disable-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const err = $('twofa-disable-err');
  setError(err, '');

  await withBusy(submitButton(form), async () => {
    try {
      await postJson('/api/2fa/disable', {
        email: user.email,
        password: form.current_password.value,
        secret: data.totpSecret,
        ...codeFields(form.code.value),
        ...(isRecoveryCode(form.code.value.trim()) ? { recoveryCodes: data.recoveryCodes || [] } : {}),
      });
      await writeUser({ totpSecret: null, totpEnabled: false, recoveryCodes: [], recoveryCodesUsed: 0 });
      data.totpSecret = null;
      data.totpEnabled = false;
      data.recoveryCodes = [];
      data.recoveryCodesUsed = 0;
      renderSecurity();
      hideDialog($('twofa-disable-modal'));
    } catch (error) {
      setError(err, error.message);
    }
  });
});

// -- privacy settings ------------------------------------------------------

// Read-modify-write of the whole blob: other keys live in there.
function mirrorVoiceLocal(enabled) {
  try {
    const saved = JSON.parse(localStorage.getItem('bloxverse_settings') || '{}');
    saved.voiceEnabled = enabled;
    localStorage.setItem('bloxverse_settings', JSON.stringify(saved));
  } catch { /* storage blocked; the Firestore value is still authoritative */ }
}

const RPC_KEY = 'bloxverse_rpc_enabled';
const rpcEnabled = () => {
  try { return localStorage.getItem(RPC_KEY) !== 'false'; } catch { return true; }
};

$('profile-privacy').addEventListener('change', async (event) => {
  const next = event.target.value;
  try {
    await writeUser({ profilePrivacy: next });
    data.profilePrivacy = next;
  } catch (error) {
    console.warn('[account] privacy save failed:', error);
    event.target.value = storedPrivacy();
  }
});

$('voice-chat').addEventListener('change', async (event) => {
  if (!canUseVoice()) {
    event.target.checked = false;
    return;
  }
  const enabled = event.target.checked;
  try {
    await writeUser({ voiceEnabled: enabled });
    data.voiceEnabled = enabled;
    mirrorVoiceLocal(enabled);
  } catch (error) {
    console.warn('[account] voice chat save failed:', error);
    event.target.checked = !enabled;
  }
});

$('ai-optout').addEventListener('change', async (event) => {
  const optOut = event.target.checked;
  event.target.disabled = true;
  try {
    // Same field the old "Chat Data Collection" toggle wrote, so the choice
    // already made by existing users carries over.
    await writeUser({ dataCollectionOptOut: optOut });
    data.dataCollectionOptOut = optOut;
  } catch (error) {
    console.warn('[account] opt-out save failed:', error);
    event.target.checked = !optOut;
  } finally {
    event.target.disabled = false;
  }
});

$('rpc-toggle').addEventListener('change', (event) => {
  try {
    localStorage.setItem(RPC_KEY, String(event.target.checked));
  } catch { /* storage blocked */ }
});

// -- sessions --------------------------------------------------------------

$('sessions-revoke-all').addEventListener('click', (event) => withBusy(event.currentTarget, async () => {
  const label = event.currentTarget.textContent;
  try {
    await revokeOtherSessions(user.uid);
    event.currentTarget.textContent = 'Signed out';
    renderSessions();
  } catch (error) {
    console.warn('[account] session revoke failed:', error);
  } finally {
    setTimeout(() => { event.currentTarget.textContent = label; }, 3000);
  }
}));

$('sidebar-logout').addEventListener('click', async () => {
  await signOut(auth);
  location.replace('/bloxverse/auth');
});

// -- boot ------------------------------------------------------------------

async function load() {
  const snap = await getDoc(doc(db, 'users', user.uid));
  data = snap.exists() ? snap.data() : {};
  renderAccount();
  renderSecurity();
  if (activeTab === 'sessions') renderSessions();

  // The top-right cluster is shared shell state, so it comes from the same
  // profile document rather than being rebuilt per page.
  renderAccountCluster(user, {
    username: data.username || user.displayName,
    bux: data.bux || 0,
    userNum: data.userIdNum,
    preview: data.avatarPreviewHead || data.avatarPreview || null,
    sitePath: (p) => `/bloxverse${p}`,
    onLogout: () => { location.replace('/bloxverse/auth'); },
  });
}

function start() {
  initSettingsNavigation();
  initThemeControls();

  onAuthStateChanged(auth, async (nextUser) => {
    if (!nextUser) {
      location.replace('/bloxverse/auth');
      return;
    }
    if (await banGuard(nextUser.uid)) return;
    user = nextUser;
    assignUserIdNum(user.uid).catch(() => {});
    trackPresence(user.uid, null, 'account');
    try {
      await load();
    } catch (error) {
      console.error('[account] load failed:', error);
    }
  });
}

start();
