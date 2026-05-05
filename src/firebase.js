import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, getDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA-4DyZMqHgMCme2-hicVg4AV5ax-_fnmY",
  authDomain: "bloxverse-154b2.firebaseapp.com",
  projectId: "bloxverse-154b2",
  storageBucket: "bloxverse-154b2.firebasestorage.app",
  messagingSenderId: "209592007747",
  appId: "1:209592007747:web:e1ff36337655ff484568f6",
  measurementId: "G-273FC0DR2H"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function listenBux(userId, callback, username = null, email = null) {
  const userRef = doc(db, 'users', userId);
  return onSnapshot(userRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data()?.bux || 0);
    } else {
      // Create user doc with all fields if it doesn't exist
      setDoc(userRef, { bux: 0, username: username || 'Player', email: email || '', friends: [], createdAt: new Date().toISOString() }, { merge: true });
      callback(0);
    }
  });
}

export function setBux(userId, amount) {
  return setDoc(doc(db, 'users', userId), { bux: amount }, { merge: true });
}

export function updateBux(userId, amount) {
  return updateDoc(doc(db, 'users', userId), { bux: amount });
}

export function trackPresence(userId) {
  const presenceRef = doc(db, 'presence', userId);

  function updatePresence(data) {
    setDoc(presenceRef, { ...data, lastSeen: serverTimestamp() }, { merge: true });
  }

  updatePresence({ online: true, inGame: false });

  const cleanup = () => {
    updatePresence({ online: false, inGame: false });
  };
  window.addEventListener('beforeunload', cleanup);

  return {
    setInGame(inGame) {
      updatePresence({ online: true, inGame });
    },
    goOffline() {
      cleanup();
    }
  };
}

export async function getBux(userId) {
  const snap = await getDoc(doc(db, 'users', userId));
  return snap.data()?.bux || 0;
}
