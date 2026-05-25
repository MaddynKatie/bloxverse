import { auth, db, banGuard } from './firebase.js';
import { sitePath } from './paths.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { ProfanityFilter } from 'glin-profanity';

const _filter = new ProfanityFilter({ leetspeakLevel: 'aggressive', normalizeUnicode: true });

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

// Login
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  errorEl.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (await banGuard(cred.user.uid)) return;
    window.location.href = sitePath('index.html');
  } catch (err) {
    errorEl.textContent = getAuthErrorMessage(err.code);
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
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

  if (_filter.checkProfanity(username).containsProfanity) {
    errorEl.textContent = 'This username is not allowed';
    errorEl.classList.add('visible');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating account...';

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: username });
      await setDoc(doc(db, 'users', cred.user.uid), {
        username,
        email,
        birthday,
        bux: 0,
        friends: [],
        trustedFriends: [],
        profanityFilter: true,
        createdAt: new Date().toISOString(),
      });

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
    'auth/user-not-found': 'No account found with this email',
    'auth/wrong-password': 'Incorrect password',
    'auth/too-many-requests': 'Too many attempts. Try again later',
    'auth/invalid-credential': 'Invalid email or password',
    'auth/network-request-failed': 'Network error. Check your connection',
  };
  return messages[code] || 'An error occurred. Please try again.';
}

// Redirect if already logged in
onAuthStateChanged(auth, (user) => {
  if (user && window.location.pathname.includes('auth.html')) {
    window.location.href = sitePath('index.html');
  }
});
