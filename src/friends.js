import { db } from './firebase.js';
import {
  collection, query, where, getDocs, addDoc, deleteDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, orderBy, limit
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

export async function getFriends(userId) {
  const userDoc = await getDoc(doc(db, 'users', userId));
  if (!userDoc.exists()) return [];

  const friendIds = userDoc.data().friends || [];
  if (friendIds.length === 0) return [];

  const friends = [];
  for (const fid of friendIds) {
    const fDoc = await getDoc(doc(db, 'users', fid));
    if (fDoc.exists()) {
      friends.push({ id: fid, ...fDoc.data() });
    }
  }
  return friends;
}
