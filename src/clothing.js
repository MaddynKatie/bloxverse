export const clothingItems = [
  {
    id: 'i-love-bloxverse',
    name: 'I ❤️ BloxVerse',
    description: 'Show your love for BloxVerse with this classic t-shirt!',
    price: 0,
    author: 'BloxVerse',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/i❤️bloxverse.png', import.meta.url).href,
    created: 'May 13, 2026 6:12:00 PM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  {
    id: 'shirt-template',
    name: 'Shirt Template',
    description: 'The BloxVerse shirt template. Features a checkered patten with labels.',
    price: 0,
    author: 'BloxVerse',
    category: 'Templates',
    texturePath: new URL('../assets/clothing/shirtTemplate.png', import.meta.url).href,
    created: 'May 13, 2026 6:00:00 PM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  {
    id: 'egyptianshirt',
    name: 'Egyptian',
    description: 'Represent the ancient civilization with this Egyptian-themed shirt.',
    price: 10,
    author: 'BloxVerse',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/egyptianShirt.png', import.meta.url).href,
    created: 'May 13, 2026 6:00:00 PM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  /*
  {
    id: 'bloxverseenthusiast',
    name: 'BloxVerse Enthusiast',
    description: 'Show your passion for BloxVerse with this exclusive shirt.',
    price: 10,
    author: 'Zarif',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/bloxverseEnthusiast.png', import.meta.url).href,
    created: 'May 13, 2026 6:20:00 PM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  */
  {
    id: 'basicsuit',
    name: 'Basic Suit',
    description: 'A simple and classic suit for any occasion.',
    price: 20,
    author: 'BloxVerse',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/basicSuit.png', import.meta.url).href,
    created: 'May 13, 2026 6:34:00 PM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  {
    id: 'motorcycleshirt',
    name: 'Motorcycle Shirt',
    description: 'Classic black and purple shirt with a black motorcycle design on the front.',
    price: 0,
    author: 'BloxVerse',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/MotorcycleShirt.png', import.meta.url).href,
    created: 'May 13, 2026 6:40:00 PM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  {
    id: 'duckshirt',
    name: 'Duck',
    description: 'A classic black t-shirt with a duck on the front.',
    price: 20,
    author: 'BloxVerse',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/duck.png', import.meta.url).href,
    created: 'May 25, 2026 6:00:00 PM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  {
    id: 'blockyfightshirt',
    name: 'Blocky Fight Shirt',
    description: 'A shirt to represent your fighting skills.',
    price: 15,
    author: 'BloxVerse',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/blockyFightShirt.png', import.meta.url).href,
    created: 'June 2, 2026 10:00:00 AM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  {
    id: 'perkypolosweater',
    name: 'Polo Sweater',
    description: 'A cozy and comfy sweater with appealing colors.',
    price: 25,
    author: 'Perky',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/perkyPoloSweater.png', import.meta.url).href,
    created: 'June 4, 2026 3:48:00 PM',
    updated: 'September 9, 2026 8:36:00 PM',
  },
  /*
  {
    id: 'mikushirt',
    name: 'Miku Shirt',
    description: 'A cute shirt based on the popular character Miku.',
    price: 39,
    author: 'hi :D',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/ukiMShirt.png', import.meta.url).href,
    created: 'June 6, 2026 11:14:00 AM',
    updated: 'June 6, 2026 11:14:00 AM',
  },
  */
  {
    id: 'bloxverseshirt',
    name: 'BloxVerse Shirt',
    description: 'A shirt to show your appreciation for Bloxverse.',
    price: 12,
    author: 'Perky',
    category: 'Shirts',
    texturePath: new URL('../assets/clothing/bloxverseShirt.png', import.meta.url).href,
    created: 'June 7, 2026 4:36:00 PM',
    updated: 'September 11, 2026 5:34:32 PM',
  },
  // ── Pants ────────────────────────────────────────────────────────────────────
  /*
  {
    id: 'blockyfightspants',
    name: 'Blocky Fights Pants',
    description: 'Pants designed to go along with the Blocky Fights shirt.',
    price: 15,
    author: 'BloxVerse',
    category: 'Pants',
    texturePath: new URL('../assets/clothing/pants/blockyfightsPants.png', import.meta.url).href,
    created: 'July 2, 2026 5:53:32 PM',
    updated: 'July 2, 2026 6:04:29 PM',
  },
  */
  {
    id: 'errorpants',
    name: 'Error Pants',
    description: 'Uh oh.. Seems like the textures are missing.',
    price: 10,
    author: 'BloxVerse',
    category: 'Pants',
    texturePath: new URL('../assets/clothing/pants/errorPants.png', import.meta.url).href,
    created: 'July 6, 2026 10:53:37 AM',
    updated: 'July 6, 2026 10:54:37 AM',
  },
];

export function getAllClothing() {
  return clothingItems.slice();
}

export function findClothing(id) {
  return clothingItems.find(item => item.id === id) || null;
}

export {
  applyAvatarClothing,
  removeAvatarClothing,
  applyAvatarPants,
  removeAvatarPants,
  preloadTexture,
} from './avatar-clothing.js';
