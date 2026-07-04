import { auth, db, banGuard, isUsernameTaken, getEmailByUsername, backfillUsernameEntry, assignUserIdNum } from './firebase.js';
import { sitePath } from './paths.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, setDoc, getDoc, runTransaction, collection } from 'firebase/firestore';
import { ProfanityFilter } from 'glin-profanity';

const _filter = new ProfanityFilter({ leetspeakLevel: 'aggressive', normalizeUnicode: true });

const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'protonmail.com', 'proton.me'];

function isAllowedEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

// Tab switching
window.switchTab = function(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('authSuccess').classList.remove('visible');

  if (tab === 'login') {
    document.querySelectorAll('.auth-tab')[0].classList.add('active');
    document.getElementById('loginForm').classList.add('active');
    document.getElementById('authSubtitle').textContent = 'Sign in to continue';
  } else {
    document.querySelectorAll('.auth-tab')[1].classList.add('active');
    document.getElementById('signupForm').classList.add('active');
    document.getElementById('authSubtitle').textContent = 'Create your account';
  }
};

window.showForgotPassword = function() {
  document.querySelectorAll('.auth-tabs').forEach(t => t.style.display = 'none');
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('authSuccess').classList.remove('visible');
  document.getElementById('forgotForm').classList.add('active');
  document.getElementById('authSubtitle').textContent = 'Reset your password';
  document.getElementById('forgotError').classList.remove('visible');
  document.getElementById('forgotSuccess').style.display = 'none';
  document.getElementById('forgotEmail').value = '';
  if (typeof hcaptcha !== 'undefined') hcaptcha.reset();
};

window.showLogin = function() {
  document.querySelectorAll('.auth-tabs').forEach(t => t.style.display = '');
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('loginForm').classList.add('active');
  document.getElementById('authSubtitle').textContent = 'Sign in to continue';
  document.getElementById('authSuccess').classList.remove('visible');
};

// Password strength checker
const signupPassword = document.getElementById('signupPassword');
const strengthBars = document.querySelectorAll('.strength-bar');
const strengthText = document.getElementById('strengthText');

signupPassword?.addEventListener('input', (e) => {
  const val = e.target.value;
  let score = 0;

  if (val.length >= 6) score++;
  if (val.length >= 10) score++;
  if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  const level = Math.min(score, 4);
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const classes = ['', 'weak', 'weak', 'medium', 'strong'];

  strengthBars.forEach((bar, i) => {
    bar.className = 'strength-bar';
    if (i < level) bar.classList.add(classes[level]);
  });
  strengthText.textContent = val.length > 0 ? labels[level] || 'Too short' : '';
});

// Live validation helpers
function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('visible', !!msg);
}

function validateUsernameLive(val) {
  if (!val) return '';
  if (val.length < 3 || val.length > 20) return 'Must be 3\u201320 characters';
  if (!/^[A-Za-z0-9_]+$/.test(val)) return 'Only letters, numbers, and underscore';
  if ((val.match(/_/g) || []).length > 1) return 'Only one underscore allowed';
  if (val.startsWith('_') || val.endsWith('_')) return 'Underscore cannot be first or last';
  const RESERVED = ['blox', 'admin', 'moderator', 'staff', 'system', 'roblox'];
  if (RESERVED.some(n => val.toLowerCase() === n)) return 'This username is reserved';
  if (_filter.checkProfanity(val).containsProfanity) return 'This username is not allowed';
  return '';
}

function validateEmailLive(val) {
  if (!val) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return 'Invalid email address';
  if (!isAllowedEmail(val)) return 'Only Gmail, Yahoo, Outlook/Hotmail, iCloud, or Proton Mail allowed';
  return '';
}

function validatePasswordLive(val) {
  if (!val) return '';
  return val.length >= 6 ? '' : 'At least 6 characters';
}

function validateConfirmLive(confirm) {
  const pw = document.getElementById('signupPassword')?.value || '';
  if (!confirm) return '';
  return confirm === pw ? '' : 'Passwords do not match';
}

function validateBirthdayLive(val) {
  if (!val) return '';
  return val ? '' : 'Please enter your birthday';
}

// Live validation event listeners
const su = document.getElementById('signupUsername');
const se = document.getElementById('signupEmail');
const sp = document.getElementById('signupPassword');
const sc = document.getElementById('signupConfirm');
const sb = document.getElementById('signupBirthday');

su?.addEventListener('input', () => showFieldError('usernameError', validateUsernameLive(su.value.trim())));
se?.addEventListener('input', () => showFieldError('emailError', validateEmailLive(se.value)));
sp?.addEventListener('input', () => {
  showFieldError('passwordError', validatePasswordLive(sp.value));
  if (sc?.value) showFieldError('confirmError', validateConfirmLive(sc.value));
});
sc?.addEventListener('input', () => showFieldError('confirmError', validateConfirmLive(sc.value)));
sb?.addEventListener('change', () => showFieldError('birthdayError', validateBirthdayLive(sb.value)));

// Login
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  errorEl.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const login = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    let email = login;
    if (!login.includes('@')) {
      const found = await getEmailByUsername(login);
      if (!found) {
        errorEl.textContent = 'Username not found';
        errorEl.classList.add('visible');
        btn.disabled = false;
        btn.textContent = 'Login';
        return;
      }
      email = found;
    }

    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (await banGuard(cred.user.uid)) return;
    await backfillUsernameEntry(cred.user.uid);
    window.location.href = sitePath('index.html');
  } catch (err) {
    errorEl.textContent = getAuthErrorMessage(err.code);
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
});

// Forgot Password
document.getElementById('forgotForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('forgotError');
  const btn = document.getElementById('forgotBtn');
  const successEl = document.getElementById('forgotSuccess');

  errorEl.classList.remove('visible');
  successEl.style.display = 'none';

  const email = document.getElementById('forgotEmail').value.trim();

  if (!email) {
    errorEl.textContent = 'Please enter your email';
    errorEl.classList.add('visible');
    return;
  }

  const captchaToken = typeof hcaptcha !== 'undefined' ? hcaptcha.getResponse() : '';
  if (!captchaToken) {
    errorEl.textContent = 'Please complete the captcha';
    errorEl.classList.add('visible');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await sendPasswordResetEmail(auth, email);
    successEl.style.display = 'block';
    successEl.textContent = 'Reset link sent! Check your email.';
    successEl.classList.add('visible');
    btn.textContent = 'Sent';
  } catch (err) {
    const msg = err.code === 'auth/user-not-found'
      ? 'No account found with this email'
      : err.code === 'auth/invalid-email'
      ? 'Invalid email address'
      : err.code === 'auth/too-many-requests'
      ? 'Too many requests. Try again later.'
      : 'Failed to send reset link. Try again later.';
    errorEl.textContent = msg;
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    if (btn.textContent === 'Sending...') btn.textContent = 'Send Reset Link';
  }
});

// Signup
document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('signupError');
  const btn = document.getElementById('signupBtn');

  errorEl.classList.remove('visible');

  const username = document.getElementById('signupUsername').value.trim();
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;
  const birthday = document.getElementById('signupBirthday').value;

  if (password !== confirm) {
    errorEl.textContent = 'Passwords do not match';
    errorEl.classList.add('visible');
    return;
  }

  if (!birthday) {
    errorEl.textContent = 'Please enter your birthday';
    errorEl.classList.add('visible');
    return;
  }

  if (!document.getElementById('signupTerms')?.checked) {
    errorEl.textContent = 'You must agree to the Terms of Service and Privacy Policy';
    errorEl.classList.add('visible');
    return;
  }

  if (!isAllowedEmail(email)) {
    errorEl.textContent = 'Only Gmail, Yahoo, Outlook/Hotmail, iCloud, or Proton Mail allowed';
    errorEl.classList.add('visible');
    return;
  }

  // Username validation rules
  if (username.length < 3 || username.length > 20) {
    errorEl.textContent = 'Username must be 3 to 20 characters';
    errorEl.classList.add('visible');
    return;
  }

  const underscoreCount = (username.match(/_/g) || []).length;
  if (underscoreCount > 1) {
    errorEl.textContent = 'Username may only contain one underscore';
    errorEl.classList.add('visible');
    return;
  }

  if (username.startsWith('_') || username.endsWith('_')) {
    errorEl.textContent = 'Underscore cannot be the first or last character';
    errorEl.classList.add('visible');
    return;
  }

  if (!/^[A-Za-z0-9_]+$/.test(username)) {
    errorEl.textContent = 'Username may only contain letters, numbers, and one underscore';
    errorEl.classList.add('visible');
    return;
  }

  if (_filter.checkProfanity(username).containsProfanity) {
    errorEl.textContent = 'This username is not allowed';
    errorEl.classList.add('visible');
    return;
  }

  const RESERVED_NAMES = ['blox', 'admin', 'moderator', 'staff', 'system', 'roblox'];
  if (RESERVED_NAMES.some(n => username.toLowerCase() === n)) {
    errorEl.textContent = 'This username contains a restricted term';
    errorEl.classList.add('visible');
    return;
  }

  // Check if username is already taken
  if (await isUsernameTaken(username)) {
    errorEl.textContent = 'Username already taken';
    errorEl.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Sign Up';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating account...';

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;
      const lower = username.toLowerCase();
            await setDoc(doc(db, 'users', uid), {
        username,
        username_lower: lower,
        email,
        birthday,
        bux: 0,
        friends: [],
        trustedFriends: [],
        profanityFilter: true,
        lastDailyClaim: '',
        passwordLength: password.length,
        createdAt: new Date().toISOString(),
      });
      // Register in public username lookup
      await setDoc(doc(db, 'usernames', lower), { uid, email });
      // Assign sequential userIdNum
      await assignUserIdNum(uid);

    const successEl = document.getElementById('authSuccess');
    successEl.textContent = 'Account created! Redirecting...';
    successEl.classList.add('visible');

    setTimeout(() => {
      window.location.href = sitePath('index.html');
    }, 1000);
  } catch (err) {
    errorEl.textContent = getAuthErrorMessage(err.code);
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign Up';
  }
});

function getAuthErrorMessage(code) {
  const messages = {
    'auth/email-already-in-use': 'This email is already registered',
    'auth/invalid-email': 'Invalid email address',
    'auth/weak-password': 'Password must be at least 6 characters',
    'auth/user-not-found': 'No account found',
    'auth/wrong-password': 'Incorrect password',
    'auth/too-many-requests': 'Too many attempts. Try again later',
    'auth/invalid-credential': 'Invalid email or password',
    'auth/network-request-failed': 'Network error. Check your connection',
  };
  return messages[code] || 'An error occurred. Please try again.';
}

// Redirect if already logged in
onAuthStateChanged(auth, async (user) => {
  if (user && window.location.pathname.includes('auth.html')) {
    await backfillUsernameEntry(user.uid);
    window.location.href = sitePath('index.html');
  }
});
