const EMOTE_DIR = new URL('../assets/emotes/', import.meta.url).href;

export const emoteItems = [
    {
        id: 'wave',
        name: 'Wave',
        description: 'A friendly wave to greet your friends.',
        price: 0,
        author: 'BloxVerse',
        looping: false,
        icon: '👋',
        file: 'wave.json',
    },
    {
        id: 'point',
        name: 'Point',
        description: 'Hey, look over there!',
        price: 0,
        author: 'BloxVerse',
        looping: false,
        icon: '🫵',
        file: 'point.json',
    },
    {
        id: 'tpose',
        name: 'T-Pose',
        description: 'The classic T-pose!',
        price: 5,
        author: 'BloxVerse',
        looping: true,
        icon: 'T',
        file: 'tpose.json',
    },
    {
        id: 'cheer',
        name: 'Cheer',
        description: 'Celebrate with a cheer!',
        price: 0,
        author: 'BloxVerse',
        looping: false,
        icon: '🎉',
        file: 'cheer.json',
    },
    {
        id: 'armthrow',
        name: 'Arm Throw',
        description: "I don't need this arm!",
        price: 10,
        author: 'BloxVerse',
        looping: false,
        icon: '🫳',
        file: 'armthrow.json',
    },
    {
        id: 'bibilicallyaccurateemote',
        name: 'Biblically Accurate Emote',
        description: "Become an angel",
        price: 15,
        author: 'BloxVerse',
        looping: true,
        icon: '😇',
        file: 'bibilicallyaccurateemote.json',
    },
];

async function loadAnimData(entry) {
    try {
        const res = await fetch(EMOTE_DIR + entry.file);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        entry.duration = data.duration;
        entry.keyframes = data.keyframes;
    } catch (e) {
        console.warn('Failed to load emote anim:', entry.id, e);
    }
}

await Promise.all(emoteItems.map(loadAnimData));

export function getAllEmotes() {
    return emoteItems;
}

export function findEmote(id) {
    return emoteItems.find(e => e.id === id) || null;
}
