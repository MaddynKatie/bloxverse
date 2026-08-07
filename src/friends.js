import { db } from './firebase.js';
import {
  collection, query, where, getDocs, addDoc, deleteDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, orderBy, limit, onSnapshot
} from 'firebase/firestore';

export async function searchUsers(searchTerm) {
  if (searchTerm.length < 3) return [];

  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('username', '>=', searchTerm), where('username', '<=', searchTerm + '\uf8ff'), limit(10));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function sendFriendRequest(userId, targetId, targetUsername) {
  const reqRef = collection(db, 'friendRequests');
  await addDoc(reqRef, {
    from: userId,
    to: targetId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
}

export async function acceptFriendRequest(reqId, fromId, toId) {
  const reqRef = doc(db, 'friendRequests', reqId);
  await updateDoc(reqRef, { status: 'accepted' });

  const userRef = doc(db, 'users', fromId);
  await updateDoc(userRef, { friends: arrayUnion(toId) });

  const targetRef = doc(db, 'users', toId);
  await updateDoc(targetRef, { friends: arrayUnion(fromId) });

  await deleteDoc(reqRef);
}

export async function declineFriendRequest(reqId) {
  await deleteDoc(doc(db, 'friendRequests', reqId));
}

export async function removeFriend(userId, friendId) {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { friends: arrayRemove(friendId) });

  const friendRef = doc(db, 'users', friendId);
  await updateDoc(friendRef, { friends: arrayRemove(userId) });
}

export async function getFriendRequests(userId) {
  const reqRef = collection(db, 'friendRequests');
  const q = query(reqRef, where('to', '==', userId), where('status', '==', 'pending'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function onFriendRequests(userId, callback) {
  const reqRef = collection(db, 'friendRequests');
  const q = query(reqRef, where('to', '==', userId), where('status', '==', 'pending'));
  return onSnapshot(q, (snapshot) => {
    const requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(requests);
  });
}

export async function getFriends(userId) {
  const userDoc = await getDoc(doc(db, 'users', userId));
  if (!userDoc.exists()) return [];

  const friendIds = userDoc.data().friends || [];
  if (friendIds.length === 0) return [];

  // Fetch all friends concurrently instead of one round-trip each.
  const snapshots = await Promise.all(friendIds.map((fid) => getDoc(doc(db, 'users', fid))));
  const friends = [];
  for (const fDoc of snapshots) {
    if (fDoc.exists()) {
      friends.push({ id: fDoc.id, ...fDoc.data() });
    }
  }
  return friends;
}
