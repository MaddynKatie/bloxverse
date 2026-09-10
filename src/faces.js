export const faceItems = [
  {
    id: 'smile',
    name: 'Smile',
    description: 'A classic smiley face.',
    price: 0,
    author: 'BloxVerse',
    texturePath: new URL('../assets/models/Smile.png', import.meta.url).href,
  },
  {
    id: 'faceless',
    name: 'Faceless',
    description: 'A face without a face.',
    price: 0,
    author: 'BloxVerse',
    texturePath: new URL('../assets/faces/faceless.png', import.meta.url).href,
  },
  {
    id: 'upsidedown',
    name: 'Upside Down',
    description: 'A face turned upside down.',
    price: 0,
    author: 'BloxVerse',
    // 9/9/26 4:56:18 PM
    texturePath: new URL('../assets/faces/upsidedown.png', import.meta.url).href,
  },
]

export function getAllFaces() {
  return faceItems.slice()
}

export function findFace(id) {
  return faceItems.find(f => f.id === id) || null
}
