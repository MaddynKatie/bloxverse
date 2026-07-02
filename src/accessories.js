export const accessories = [
  {
    id: 'cardboardbox',
    name: 'Cardboard Box',
    description: 'A humble cardboard box. Perfect for hiding.',
    price: 10,
    author: 'BloxVerse',
    icon: '📦',
    meshPath: new URL('../assets/accessories/CardboardBox/CardboardBox.fbx', import.meta.url).href,
    textures: {
      map: new URL('../assets/accessories/CardboardBox/Box_Diffuse.png', import.meta.url).href,
      normalMap: new URL('../assets/accessories/CardboardBox/Box_Normal.png', import.meta.url).href,
      displacementMap: new URL('../assets/accessories/CardboardBox/Box_Height.png', import.meta.url).href,
    },
    offset: { x: 0, y: 1.1, z: 0, rx: 0, ry: 0, rz: 0, scale: 0.01 },
    category: 'Hats',
    created: 'May 24, 2026 3:00:00 PM',
    updated: 'May 24, 2026 3:00:00 PM',
  },
  {
    id: 'palhair',
    name: 'Pal Hair',
    description: 'Yeah buddy!  Pal hair for the win.',
    price: 0,
    author: 'BloxVerse',
     icon: '👨‍🦰',
    meshPath: new URL('../assets/accessories/PalHair/pal_hair.glb', import.meta.url).href,
    textures: {
      map: new URL('../assets/accessories/PalHair/3E04297D-D5C9-41AB-AC7E-3E21E4EE7891.jpeg', import.meta.url).href,
    },
    offset: { x: 0, y: 0.2, z: 0, rx: 0, ry: -3.1, rz: 0, scale: 1 },
    category: 'Hair',
    created: 'May 24, 2026 3:20:00 PM',
    updated: 'May 24, 2026 3:20:00 PM',
  },
  {
    id: 'bloodfiendhair',
    name: 'Bloodfiend Hair',
    description: 'The hair of a true hero.',
    price: 10,
    author: 'Eliam',
     icon: '👨‍🦰',
    meshPath: new URL('../assets/accessories/BloodfiendHair/hair.fbx', import.meta.url).href,
    textures: {
      map: new URL('../assets/accessories/BloodfiendHair/109659719046608.png', import.meta.url).href,
    },
    offset: { x: 0.125, y: 0, z: -0.1, rx: 0, ry: -3.1, rz: 0, scale: 0.009 },
    category: 'Hair',
    created: 'June 9, 2026 4:10:00 PM',
    updated: 'June 9, 2026 4:10:00 PM',
  },
]

export function getAllAccessories() {
  return accessories
}

export function findAccessory(id) {
  return accessories.find(a => a.id === id) || null
}
