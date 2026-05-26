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
  },
]

export function getAllAccessories() {
  return accessories
}

export function findAccessory(id) {
  return accessories.find(a => a.id === id) || null
}
