// Web -> Studio deep link. The BloxVerse Studio desktop app registers the
// bloxverse-studio:// protocol; this builds the link carrying the user's
// BloxVerse session tokens so Studio signs in without a password.
// Any element with [data-open-studio] opens Studio (self-wiring).
import { auth, db } from './firebase.js';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const STUDIO_SCHEME = 'bloxverse-studio';

function currentUser() {
  const user = auth.currentUser;
  if (user) return Promise.resolve(user);
  return new Promise((resolve) => {
    const unsub = auth.onAuthStateChanged((u) => {
      unsub();
      resolve(u);
    });
  });
}

export async function openStudio() {
  const user = await currentUser();
  if (!user) {
    window.location.href = '/bloxverse/auth';
    return;
  }
  try {
    const idToken = await user.getIdToken();
    const refreshToken = user.refreshToken;
    const url = `${STUDIO_SCHEME}://open?refreshToken=${encodeURIComponent(refreshToken)}&idToken=${encodeURIComponent(idToken)}`;
    window.location.href = url;
    await setDoc(doc(db, 'presence', user.uid), { inStudio: true, lastSeen: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('Could not open Studio:', err);
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open-studio]');
  if (btn) openStudio();
});
