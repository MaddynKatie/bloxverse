export const accessories = [
  {
    id: 'bloodfiendhair',
    name: 'Bloodfiend Hair',
    description: 'The hair of a true hero.',
    price: 30,
    author: 'Eliam',
     icon: 'B',
    meshPath: new URL('../assets/accessories/bloodfiendhair.glb', import.meta.url).href,
    category: 'Hair',
    created: 'June 9, 2026 4:10:00 PM',
    updated: 'September 9, 2026 5:09:19 PM',
  },
  {
    id: 'halo',
    name: 'Halo',
    description: 'A divine halo.',
    price: 20,
    author: 'BloxVerse',
     icon: 'H',
    meshPath: new URL('../assets/accessories/halo.glb', import.meta.url).href,
    category: 'Hat',
    created: 'June 9, 2026 4:10:00 PM',
    updated: 'September 9, 2026 6:02:19 PM',
  },
  {
    id: 'tophat',
    name: 'Top Hat',
    description: 'A classic top hat.',
    price: 30,
    author: 'BloxVerse',
     icon: 'T',
    meshPath: new URL('../assets/accessories/tophat.glb', import.meta.url).href,
    category: 'Hat',
    created: 'June 9, 2026 4:10:00 PM',
    updated: 'September 9, 2026 6:02:19 PM',
  },
  {
    id: 'stickynote',
    name: 'Sticky Note',
    description: 'My name is Bloxversian.',
    price: 20,
    author: 'BloxVerse',
     icon: 'T',
    meshPath: new URL('../assets/accessories/stickynote.glb', import.meta.url).href,
    category: 'Hat',
    created: 'June 9, 2026 4:10:00 PM',
    updated: 'September 9, 2026 6:02:19 PM',
  },
]

export function getAllAccessories() {
  return accessories
}

export function findAccessory(id) {
  return accessories.find(a => a.id === id) || null
}
