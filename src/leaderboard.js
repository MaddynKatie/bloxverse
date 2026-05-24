import { db } from './firebase.js';
import { collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp, getDoc } from 'firebase/firestore';

export function joinLeaderboard(gameId, userId, username) {
  if (!gameId || !userId) return { leave: () => {} };

  const playerRef = doc(db, 'games', gameId, 'players', userId);
  setDoc(playerRef, {
    username,
    userId,
    joinedAt: serverTimestamp(),
  });

  return {
    leave() {
      deleteDoc(playerRef);
    },
  };
}

export function listenToLeaderboard(gameId, callback) {
  if (!gameId) return () => {};

  const playersRef = collection(db, 'games', gameId, 'players');
  return onSnapshot(playersRef, (snapshot) => {
    const players = snapshot.docs.map(d => d.data());
    players.sort((a, b) => (a.joinedAt?.seconds || 0) - (b.joinedAt?.seconds || 0));
    callback(players);
  });
}
