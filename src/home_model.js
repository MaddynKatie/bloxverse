// Home page view model, mirroring unused/uirevamp/home_model.js so the section
// order, titles and sorting match the reference.
//
//   1. Popular right now  - most active first (visits break ties), max 8
//   2. Recently added     - newest first, max 8
//   3. Explore BloxVerse  - the rest, alphabetical
//
// Empty groups are dropped.

const byId = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''));

const activeOf = (game) => Number(game.activePlayers ?? game.active ?? 0) || 0;
const visitsOf = (game) => Number(game.visits ?? 0) || 0;

export function gameSections(games) {
    const all = [...games];

    const popular = all
        .slice()
        .sort((a, b) => (activeOf(b) - activeOf(a)) || (visitsOf(b) - visitsOf(a)) || byId(a, b))
        .slice(0, 8);

    const recent = all
        .slice()
        .sort((a, b) => {
            const created = (game) => game.createdAt ?? game.created_at ?? null;
            const left = created(a);
            const right = created(b);
            if (left != null && right != null && left !== right) {
                return (typeof left === 'number' && typeof right === 'number')
                    ? right - left
                    : String(right).localeCompare(String(left));
            }
            if (left != null && right == null) return -1;
            if (left == null && right != null) return 1;
            return byId(b, a);
        })
        .slice(0, 8);

    const explore = all.slice().sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));

    return [
        { key: 'popular', title: 'Popular right now', games: popular },
        { key: 'recent', title: 'Recently added', games: recent },
        { key: 'explore', title: 'Explore BloxVerse', games: explore },
    ].filter(group => group.games.length);
}

// How many friend tiles fit, matching the reference formula. When the row would
// overflow, one slot is reserved for the "view all" tile.
export function visibleFriends(total, width, cardWidth, gap, fluid = false) {
    if (total <= 0) return 0;
    const capacity = Math.max(0, Math.floor((width + gap) / (cardWidth + gap)));
    const slots = capacity - 1;
    if (total > slots) return Math.max(0, slots);
    return fluid ? Math.round(total) : Math.floor(total);
}

// 1234 -> "1.2K", matching the reference compact formatter.
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function compactNumber(value) {
    return compact.format(Number(value) || 0);
}
