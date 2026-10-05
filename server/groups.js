/**
 * Groups API.
 *
 * The reference (unused\uirevamp\groups.js) talks to /api/groups with the same
 * endpoints and payload shapes this module answers, so the page script is a near
 * direct port. What changes is the storage: the reference keeps groups in its own
 * database, BloxVerse keeps them in Firestore and reads/writes them with the Admin
 * SDK.
 *
 * Creating a group spends Bux, so that write happens here for the same reason
 * catalog purchases do (see catalog-trading.js): the client asks for an outcome and
 * the server settles it, because security rules cannot verify a debit and a client
 * that decided its own price could charge itself nothing. Join and leave also run as
 * transactions so memberCount cannot drift from the members subcollection.
 *
 * Data shape:
 *   groups/{groupId}                       { name, nameLower, description, ownerId,
 *                                            ownerName, createdAt, memberCount }
 *   groups/{groupId}/members/{uid}        { role: 'owner' | 'member', joinedAt }
 *
 * memberCount is denormalised onto the group so "most members" sorting is a single
 * ordered query instead of a collection count per group.
 *
 * nameLower exists only so search can use a range query. Firestore has no substring
 * match, so searching matches a name PREFIX; the client copy carries the same limit.
 */
const { readJsonBody, send, requireUid, optionalUid, recordTransaction } = require('./http-util.js');

/** Matches the reference's page size (groups.js: Math.ceil(total / 30)). */
const PAGE_SIZE = 30;

/** Creating a group costs this much, matching the create dialog's copy. */
const CREATE_COST = 100;

const MAX_NAME = 50;
const MAX_DESCRIPTION = 1000;

/**
 * A search reads a prefix range rather than an indexed substring match. The range is
 * capped so a one-letter search cannot pull an unbounded number of group documents.
 */
const SEARCH_READ_CAP = 300;

/**
 * Validate a group name. Returns the error message, or null when the name is fine.
 *
 * Mirrors the reference's groupNameError(), which is not shipped in
 * unused\uirevamp, so the rules are spelled out here and reused by the client copy in
 * src/groups_page.js to keep the two messages identical.
 */
function groupNameError(name) {
  if (!name) return 'Enter a group name.';
  if (name.length > MAX_NAME) return `Group names can be at most ${MAX_NAME} characters.`;
  // Control characters (including newlines) would break the single-line card title and
  // cannot be typed into the input anyway.
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'Group names cannot contain control characters.';
  return null;
}

function normalizeDescription(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_DESCRIPTION);
}

/**
 * The card shape the reference groupCard() renders.
 *
 * Takes the document id and its .data() rather than the DocumentSnapshot itself,
 * because a snapshot exposes only exists/ref/id/data/get -- reading doc.name or
 * doc.memberCount off one silently yields undefined, which rendered every card
 * blank until this was caught.
 */
function toCard(id, group, extra = {}) {
  const createdAt = group.createdAt;
  return {
    id,
    name: group.name || '',
    // Left as an empty string rather than omitted, so the card can tell "no
    // description" from "this endpoint does not carry descriptions".
    description: group.description || '',
    member_count: Number(group.memberCount) || 0,
    owner_id: group.ownerId || null,
    owner_username: group.ownerName || '',
    // serverTimestamp resolves to a Timestamp, but a group written by a script may
    // carry an ISO string, so both are accepted.
    created_at: createdAt
      ? (typeof createdAt === 'string' ? createdAt
        : typeof createdAt.toDate === 'function' ? createdAt.toDate().toISOString()
          : String(createdAt))
      : null,
    ...extra,
  };
}

/**
 * The ids of every group the player is a member of.
 *
 * Used to keep the explore listing free of the viewer's own groups, since those
 * already appear under "My groups" and carrying a Join button for a group you are in
 * is both wrong and a confusing thing to click.
 */
async function memberGroupIds(db, uid) {
  const memberships = await db.collectionGroup('members').where('userId', '==', uid).get();
  // De-duplicated by group id rather than trusted: a repeated id would only waste a
  // Set entry here, but the same shape is relied on by myGroups().
  return [...new Set(memberships.docs.map(doc => doc.ref.parent.parent.id))];
}

/**
 * Page through the ordered query keeping only the groups the caller is not in.
 *
 * The offset has to be counted over the *filtered* sequence, not the raw one. Scanning
 * from each page's own raw offset and topping the page up from later offsets looks
 * right but is not: page 0 topping up from offset 30 makes page 1 (which starts at raw
 * offset 30) re-serve the same groups. So this walks from the start, counting filtered
 * rows, and returns the ones that land inside the requested page.
 *
 * Skipping is bounded by how many groups the caller is in, so the scan reads at most
 * `skipTo + own + PAGE_SIZE` documents rather than the whole collection, and READ_BUDGET
 * stops a pathological case rather than letting it run away.
 *
 * `candidates` is offset => snapshot, so the ordered query is built once by the caller.
 */
const LIST_READ_BUDGET = 600;

async function withoutOwnGroups(ownIds, candidates, page) {
  const own = new Set(ownIds);
  const skipTo = page * PAGE_SIZE;
  const kept = [];
  let seen = 0;
  let offset = 0;
  let read = 0;

  for (;;) {
    const snapshot = await candidates(offset);
    const docs = snapshot.docs;
    if (!docs.length || read >= LIST_READ_BUDGET) break;

    for (const doc of docs) {
      if (own.has(doc.id)) continue;
      if (seen < skipTo) {
        seen++;
        continue;
      }
      kept.push(doc);
      if (kept.length === PAGE_SIZE) return kept;
    }

    offset += docs.length;
    read += docs.length;
    if (docs.length < PAGE_SIZE) break;
  }

  return kept;
}

/**
 * Explore listing.
 *
 * `viewer` is the signed-in caller, or null. Their own groups are removed so a group
 * shows up in exactly one of the two sections.
 */
function listGroups(admin, res, query, viewer) {
  const db = admin.firestore();
  const collection = db.collection('groups');
  // Defaults to empty rather than trusting the caller to pass a URLSearchParams: the
  // query string is optional, and a missing one used to throw on the first .get().
  const params = query instanceof URLSearchParams ? query : new URLSearchParams(query || {});
  const q = String(params.get('q') || '').trim();
  const sort = params.get('sort') === 'newest' ? 'newest' : 'members';
  const page = Math.max(0, Number(params.get('page')) || 0);

  return (async () => {
    if (!q) {
      // No search, so the sort is a single ordered query with server-side paging.
      const ordered = sort === 'newest'
        ? collection.orderBy('createdAt', 'desc')
        : collection.orderBy('memberCount', 'desc').orderBy(admin.firestore.FieldPath.documentId(), 'desc');

      // In @google-cloud/firestore 7.x, get() resolves to an AggregateQuerySnapshot;
      // its aggregation values (including count) are exposed through data().
      const total = (await ordered.count().get()).data().count;

      const ownIds = viewer ? await memberGroupIds(db, viewer) : [];
      const docs = ownIds.length
        ? await withoutOwnGroups(ownIds, offset => ordered.offset(offset).limit(PAGE_SIZE).get(), page)
        : (await ordered.offset(page * PAGE_SIZE).limit(PAGE_SIZE).get()).docs;

      // Every group the caller is in is in this listing, so the count the page shows
      // is the total minus exactly those, rather than a guess.
      const visibleTotal = Math.max(0, total - ownIds.length);

      return {
        items: docs.map(doc => toCard(doc.id, doc.data())),
        total: visibleTotal,
        sort,
      };
    }

    // Searched: Firestore cannot combine a prefix range with the sort field without a
    // composite index this repo does not ship, so the matches are sorted here. A prefix
    // match narrows to a small set, and the read is capped above.
    const lower = q.toLowerCase();
    const snapshot = await collection
      .where('nameLower', '>=', lower)
      .where('nameLower', '<=', lower + '\uf8ff')
      .limit(SEARCH_READ_CAP)
      .get();

    let items = snapshot.docs.map(doc => toCard(doc.id, doc.data()));
    if (viewer) {
      const own = new Set(await memberGroupIds(db, viewer));
      items = items.filter(item => !own.has(item.id));
    }
    items.sort((a, b) => (sort === 'newest'
      ? String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      : b.member_count - a.member_count));

    const total = items.length;
    return {
      items: items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
      total,
      sort,
      // Told to the client so it can say the list was capped rather than implying
      // these are every match.
      truncated: total >= SEARCH_READ_CAP,
    };
  })().then(data => send(res, 200, data), error => {
    console.warn('[groups] list failed:', error.message);
    send(res, 500, { error: 'Could not load groups.' });
  });
}

/** The groups a player owns or belongs to, owner first. */
async function myGroups(admin, res, uid) {
  try {
    const db = admin.firestore();
    const memberships = await db.collectionGroup('members')
      .where('userId', '==', uid)
      .get();

    // Each membership document is /groups/{groupId}/members/{uid}.
    //
    // Every write goes through server-side joins and leaves, so there should be exactly
    // one membership per group a player is in. They are still de-duplicated by group id
    // rather than trusted: a duplicated card is a visible bug, and this costs one Map.
    const rows = [];
    const seen = new Set();
    for (const doc of memberships.docs) {
      const groupId = doc.ref.parent.parent.id;
      if (seen.has(groupId)) continue;
      seen.add(groupId);
      const group = await db.collection('groups').doc(groupId).get();
      if (!group.exists) continue; // Membership outlived its group.
      const data = group.data();
      rows.push(toCard(group.id, data, { is_owner: data.ownerId === uid }));
    }

    // Owners before members, then busier groups first.
    rows.sort((a, b) => (Number(b.is_owner) - Number(a.is_owner)) || (b.member_count - a.member_count));
    send(res, 200, rows);
  } catch (error) {
    console.warn('[groups] mine failed:', error.message);
    send(res, 500, { error: 'Could not load your groups.' });
  }
}

/**
 * Create a group and charge the creator.
 *
 * The debit, the group document and the owner membership are one transaction, so a
 * player is never charged for a group that was not written and a group is never
 * written without the membership that makes the owner its owner.
 */
async function createGroup(admin, res, uid, body) {
  const db = admin.firestore();
  const name = String(body.name || '').trim();
  const nameErr = groupNameError(name);
  if (nameErr) return send(res, 400, { error: nameErr, field: 'name' });

  const description = normalizeDescription(body.description);
  const profile = await db.collection('users').doc(uid).get();
  const ownerName = (profile.get('username') || '').toString();

  let groupId;
  try {
    groupId = await db.runTransaction(async txn => {
      const userRef = db.collection('users').doc(uid);
      const user = await txn.get(userRef);

      const balance = Number(user.get('bux')) || 0;
      if (balance < CREATE_COST) {
        throw Object.assign(new Error('insufficient_bux'), { status: 402 });
      }

      const groupRef = db.collection('groups').doc();
      txn.create(groupRef, {
        name,
        // Only the lowercased name is searched; name keeps the creator's capitalisation.
        nameLower: name.toLowerCase(),
        description,
        ownerId: uid,
        ownerName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        memberCount: 1,
      });

      txn.set(groupRef.collection('members').doc(uid), {
        userId: uid,
        username: ownerName,
        role: 'owner',
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      txn.update(userRef, { bux: balance - CREATE_COST });
      return groupRef.id;
    });
  } catch (error) {
    if (error.status === 402) return send(res, 402, { error: 'insufficient_bux' });
    console.warn('[groups] create failed:', error.message);
    return send(res, 500, { error: 'Could not create the group.' });
  }

  // Written after the transaction so a history failure cannot undo a created group.
  await recordTransaction(db, uid, -CREATE_COST, (Number(profile.get('bux')) || 0) - CREATE_COST,
    'Groups', `Created group ${name}`);

  send(res, 201, { id: groupId });
}

/**
 * Join a group.
 *
 * Idempotent: joining a group you are already in succeeds rather than erroring, so a
 * double tap or a retried request cannot look like a failure.
 */
async function joinGroup(admin, res, uid, groupId) {
  const db = admin.firestore();
  try {
    // Read outside the transaction: the member list shows names, so the joiner's
    // username is denormalised onto the membership document. Firestore requires every
    // read in a transaction to happen before its first write, so this cannot be read
    // inside the txn below.
    const profile = await db.collection('users').doc(uid).get();
    const username = (profile.get('username') || '').toString();
    await db.runTransaction(async txn => {
      const groupRef = db.collection('groups').doc(groupId);
      const group = await txn.get(groupRef);
      if (!group.exists) throw Object.assign(new Error('That group no longer exists.'), { status: 404 });

      const memberRef = groupRef.collection('members').doc(uid);
      const member = await txn.get(memberRef);
      if (member.exists) return;

      txn.set(memberRef, {
        userId: uid,
        username,
        role: 'member',
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      txn.update(groupRef, { memberCount: (Number(group.get('memberCount')) || 0) + 1 });
    });
    send(res, 200, { ok: true });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    console.warn('[groups] join failed:', error.message);
    send(res, 500, { error: 'Could not join the group.' });
  }
}

/**
 * Leave a group.
 *
 * Owners cannot leave: a group with no owner has nobody who can edit it, remove a
 * member, or delete it, so the request is refused and the client is pointed at the
 * group page to hand over ownership.
 */
async function leaveGroup(admin, res, uid, groupId) {
  const db = admin.firestore();
  try {
    await db.runTransaction(async txn => {
      const groupRef = db.collection('groups').doc(groupId);
      const group = await txn.get(groupRef);
      if (!group.exists) throw Object.assign(new Error('That group no longer exists.'), { status: 404 });

      const memberRef = groupRef.collection('members').doc(uid);
      const member = await txn.get(memberRef);
      if (!member.exists) return;
      if (member.get('role') === 'owner' || group.get('ownerId') === uid) {
        throw Object.assign(new Error('Transfer ownership before leaving.'), { status: 403 });
      }

      txn.delete(memberRef);
      txn.update(groupRef, { memberCount: Math.max(0, (Number(group.get('memberCount')) || 1) - 1) });
    });
    send(res, 200, { ok: true });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    console.warn('[groups] leave failed:', error.message);
    send(res, 500, { error: 'Could not leave the group.' });
  }
}

/**
 * Dispatch /api/groups and everything under it.
 *
 * The listing is public; every route that writes needs a verified caller, and those
 * answers come from requireUid throwing a status rather than from a silent 401.
 */
async function handleGroups(admin, req, res, pathname, query, method) {
  if (!admin) return send(res, 503, { error: 'Server cannot reach Firestore.' });

  // Reading a group needs no identity either, so it is answered before any token is
  // required. The listing and a single group are both browsable signed out, which is
  // what the Firestore read rules say and what the reference does; only the routes
  // that change something need a verified caller.
  if (pathname === '/api/groups' && method === 'GET') {
    // The identity is optional here, unlike the routes below: the listing is public,
    // and it only uses the caller to leave their own groups out of "Explore" so a
    // group appears under exactly one of the two sections.
    return listGroups(admin, res, query, await optionalUid(admin, req));
  }

  // /api/groups/mine is a reserved segment, not a group id. Without this it matches
  // the detail pattern below and is answered as a lookup for a group named "mine",
  // which 404s before the caller's token is ever checked.
  const match = pathname.match(/^\/api\/groups\/([^/]+)(?:\/(join|leave))?$/);

  // The member list is public, like the group itself, and is answered before a token is
  // required. It is matched ahead of the bare-id pattern because "members" would
  // otherwise be read as a sub-route of a group called "members".
  const membersMatch = pathname.match(/^\/api\/groups\/([^/]+)\/members(?:\/([^/]+))?$/);
  if (membersMatch && !membersMatch[2] && method === 'GET') {
    return listMembers(admin, res, decodeURIComponent(membersMatch[1]), query);
  }

  if (match && !match[2] && match[1] !== 'mine' && method === 'GET') {
    return groupDetail(admin, res, req, decodeURIComponent(match[1]));
  }

  let uid;
  try {
    uid = await requireUid(admin, req);
  } catch (error) {
    return send(res, error.status || 401, { error: error.message });
  }

  if (pathname === '/api/groups/mine' && method === 'GET') return myGroups(admin, res, uid);
  if (pathname === '/api/groups' && method === 'POST') {
    const body = await readJsonBody(req);
    return createGroup(admin, res, uid, body);
  }

  // DELETE /api/groups/{id}/members/{userId}
  if (membersMatch && membersMatch[2] && method === 'DELETE') {
    return removeMember(admin, res, uid, decodeURIComponent(membersMatch[1]), decodeURIComponent(membersMatch[2]));
  }

  // /api/groups/{id}/join, /leave and /transfer. Matched on its own rather than off
  // `match` above, which only spans a bare id and those two older actions.
  const action = pathname.match(/^\/api\/groups\/([^/]+)\/(join|leave|transfer)$/);
  if (action && method === 'POST') {
    const groupId = decodeURIComponent(action[1]);
    if (action[2] === 'join') return joinGroup(admin, res, uid, groupId);
    if (action[2] === 'leave') return leaveGroup(admin, res, uid, groupId);
    const body = await readJsonBody(req);
    return transferOwner(admin, res, uid, groupId, body);
  }

  // PATCH and DELETE on the group itself.
  if (match && !match[2] && match[1] !== 'mine') {
    const groupId = decodeURIComponent(match[1]);
    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      return updateGroup(admin, res, uid, groupId, body);
    }
    if (method === 'DELETE') return deleteGroup(admin, res, uid, groupId);
  }

  send(res, 404, { error: 'Not found.' });
}

/**
 * One member row per membership document, with the profile fields a row needs.
 *
 * A member row shows a name and an avatar, so the profiles are read in one batched
 * getAll rather than a read per member. That also fills in memberships written before
 * the username was denormalised onto the membership document, and it picks up a name
 * or avatar changed since joining, which a stored copy would keep showing stale.
 *
 * Field names follow the reference's memberCard(): user_id, username, is_owner,
 * joined_at. Firestore only indexes what it stores, so the membership keeps role and
 * userId and this maps them onto the shape the page script reads.
 */
async function memberRows(db, groupRef) {
  const snapshot = await groupRef.collection('members').get();
  const rows = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      user_id: doc.id,
      username: (data.username || '').toString(),
      is_owner: data.role === 'owner',
      joined_at: data.joinedAt && typeof data.joinedAt.toDate === 'function'
        ? data.joinedAt.toDate().toISOString()
        : null,
    };
  });

  const profiles = rows.length
    ? await db.getAll(...rows.map(row => db.collection('users').doc(row.user_id)))
    : [];
  rows.forEach((row, i) => {
    const profile = profiles[i];
    if (!profile || !profile.exists) return;
    if (!row.username) row.username = (profile.get('username') || '').toString();
    // The head crop is what the rest of the site shows in a player list
    // (src/social_page.js avatarImage()); the full preview is the fallback.
    const avatar = profile.get('avatarPreviewHead') || profile.get('avatarPreview') || '';
    row.avatar = typeof avatar === 'string' ? avatar : '';
  });

  // Firestore returns memberships in document-id order, which files the owner under a
  // uid rather than at the top. The reference has this ordering too; sorting the owner
  // first is the one place this module departs from it.
  rows.sort((a, b) => Number(b.is_owner) - Number(a.is_owner));
  return rows;
}

/** The reference's member page size (group.js: Math.ceil(total / 50)). */
const MEMBER_PAGE_SIZE = 50;

/**
 * GET /api/groups/{id}/members?page=N
 *
 * A page of the member list, separate from the group itself. The reference splits it
 * this way so a large group does not have to travel with the page header, and so the
 * member list can be re-read on its own after a removal without reloading the group.
 */
async function listMembers(admin, res, groupId, query) {
  try {
    const db = admin.firestore();
    const groupRef = db.collection('groups').doc(groupId);
    const group = await groupRef.get();
    if (!group.exists) return send(res, 404, { error: 'That group no longer exists.' });

    const rows = await memberRows(db, groupRef);
    const page = Math.max(0, Number(query.get('page')) || 0);
    const start = page * MEMBER_PAGE_SIZE;

    send(res, 200, { items: rows.slice(start, start + MEMBER_PAGE_SIZE), total: rows.length });
  } catch (error) {
    console.warn('[groups] members failed:', error.message);
    send(res, 500, { error: 'Could not load members.' });
  }
}

/**
 * One group, plus whether the caller is in it.
 *
 * The route is public, so a token is optional: it is verified when present so the page
 * can offer Join or Leave, and ignored when absent or stale rather than failing the read
 * for a signed-out visitor. The member list is deliberately not included -- it comes
 * from /members so it can be paged and re-read on its own.
 */
async function groupDetail(admin, res, req, groupId) {
  try {
    const db = admin.firestore();
    const group = await db.collection('groups').doc(groupId).get();
    if (!group.exists) return send(res, 404, { error: 'That group no longer exists.' });

    const viewer = await optionalUid(admin, req);
    let isMember = false;
    if (viewer) {
      const membership = await db.collection('groups').doc(groupId).collection('members').doc(viewer).get();
      isMember = membership.exists;
    }

    send(res, 200, toCard(group.id, group.data(), {
      is_member: isMember,
      is_owner: !!viewer && group.data().ownerId === viewer,
    }));
  } catch (error) {
    console.warn('[groups] detail failed:', error.message);
    send(res, 500, { error: 'Could not load the group.' });
  }
}

/** Load a group and refuse anyone who is not its owner. */
async function requireOwner(admin, uid, groupId) {
  const db = admin.firestore();
  const groupRef = db.collection('groups').doc(groupId);
  const group = await groupRef.get();
  if (!group.exists) throw Object.assign(new Error('That group no longer exists.'), { status: 404 });
  if (group.get('ownerId') !== uid) {
    throw Object.assign(new Error('Only the group owner can do that.'), { status: 403 });
  }
  return { db, groupRef, group };
}

/**
 * POST /api/groups/{id}/transfer  { user_id }
 *
 * Ownership moves in one transaction so the group document and both membership roles
 * can never disagree about who owns it.
 */
async function transferOwner(admin, res, uid, groupId, body) {
  const targetId = String(body.user_id || '').trim();
  try {
    const db = admin.firestore();
    await db.runTransaction(async txn => {
      const groupRef = db.collection('groups').doc(groupId);
      const group = await txn.get(groupRef);
      if (!group.exists) throw Object.assign(new Error('That group no longer exists.'), { status: 404 });
      if (group.get('ownerId') !== uid) throw Object.assign(new Error('Only the group owner can do that.'), { status: 403 });

      // Checked after the ownership test, and inside the transaction, so a non-owner is
      // refused as a non-owner instead of being told their payload is malformed.
      if (!targetId) throw Object.assign(new Error('Choose someone to make the owner.'), { status: 400 });
      if (targetId === uid) throw Object.assign(new Error('You already own this group.'), { status: 400 });

      const targetRef = groupRef.collection('members').doc(targetId);
      const target = await txn.get(targetRef);
      if (!target.exists) throw Object.assign(new Error('That player is not in this group.'), { status: 404 });

      // Prefer the target's live username over the copy stored at join time.
      const profile = await db.collection('users').doc(targetId).get();
      const targetName = (profile.get('username') || target.get('username') || '').toString();

      txn.update(targetRef, { role: 'owner', username: targetName });
      txn.update(groupRef.collection('members').doc(uid), { role: 'member' });
      txn.update(groupRef, { ownerId: targetId, ownerName: targetName });
    });
    send(res, 200, { ok: true });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    console.warn('[groups] transfer failed:', error.message);
    send(res, 500, { error: 'Could not transfer ownership.' });
  }
}

/**
 * DELETE /api/groups/{id}/members/{userId}
 *
 * The owner cannot be removed: that is a transfer, not a removal, and silently deleting
 * the owner's membership would leave the group with nobody able to delete it.
 */
async function removeMember(admin, res, uid, groupId, targetId) {
  try {
    const { db, groupRef } = await requireOwner(admin, uid, groupId);
    if (targetId === uid) return send(res, 400, { error: 'Transfer ownership before removing yourself.' });

    await db.runTransaction(async txn => {
      const group = await txn.get(groupRef);
      const memberRef = groupRef.collection('members').doc(targetId);
      const member = await txn.get(memberRef);
      if (!member.exists) return;
      if (member.get('role') === 'owner') throw Object.assign(new Error('The owner cannot be removed.'), { status: 400 });

      txn.delete(memberRef);
      txn.update(groupRef, { memberCount: Math.max(0, (Number(group.get('memberCount')) || 1) - 1) });
    });
    send(res, 200, { ok: true });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    console.warn('[groups] remove member failed:', error.message);
    send(res, 500, { error: 'Could not remove this member.' });
  }
}

/**
 * PATCH /api/groups/{id}  { name?, description? }
 *
 * Only the fields present in the body are touched, so the settings form can save the
 * name without also rewriting a description the owner did not touch.
 */
async function updateGroup(admin, res, uid, groupId, body) {
  try {
    const { db, groupRef, group } = await requireOwner(admin, uid, groupId);
    const update = {};

    if (body.name !== undefined) {
      const name = String(body.name || '').trim();
      const nameErr = groupNameError(name);
      if (nameErr) return send(res, 400, { error: nameErr, field: 'name' });
      update.name = name;
      // The lowercased copy is what search range-queries, so it moves with the name.
      update.nameLower = name.toLowerCase();
    }
    if (body.description !== undefined) update.description = normalizeDescription(body.description);

    if (!Object.keys(update).length) return send(res, 400, { error: 'Nothing to save.' });
    await groupRef.update(update);
    send(res, 200, { ok: true, name: update.name || group.get('name') });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    console.warn('[groups] update failed:', error.message);
    send(res, 500, { error: 'Could not save this change.' });
  }
}

/**
 * DELETE /api/groups/{id}
 *
 * The memberships go with the group. Firestore has no cascade delete, so they are
 * listed and removed explicitly -- a group whose membership documents outlive it would
 * keep showing up in myGroups() until each row was cleaned by hand.
 */
async function deleteGroup(admin, res, uid, groupId) {
  try {
    const { db, groupRef } = await requireOwner(admin, uid, groupId);

    const snapshot = await groupRef.collection('members').get();
    // Firestore caps a batch at 500 writes. A group that large is not reachable through
    // the UI, but chunking costs one loop and removes the ceiling entirely.
    for (let i = 0; i < snapshot.size; i += 400) {
      const batch = db.batch();
      snapshot.docs.slice(i, i + 400).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    await groupRef.delete();

    send(res, 200, { ok: true });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    console.warn('[groups] delete failed:', error.message);
    send(res, 500, { error: 'Could not delete this group.' });
  }
}


module.exports = { handleGroups, groupNameError, CREATE_COST, PAGE_SIZE };