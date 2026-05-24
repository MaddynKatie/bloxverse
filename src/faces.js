export const faceItems = [
  {
    id: 'smile',
    name: 'Smile',
    description: 'A classic smiley face.',
    texturePath: new URL('../assets/models/Smile.png', import.meta.url).href,
  },
  {
    id: 'handdrawn',
    name: 'Hand Drawn',
    description: 'A hand-drawn face.',
    texturePath: new URL('../assets/faces/handdrawn.png', import.meta.url).href,
  },
  {
    id: 'manface',
    name: 'Man Face',
    description: 'Hey there, handsome!',
    texturePath: new URL('../assets/faces/manface.png', import.meta.url).href,
  },
  {
    id: 'whistle',
    name: 'Whistle',
    description: 'Just play it cool...',
    texturePath: new URL('../assets/faces/whistle.png', import.meta.url).href,
  },
  {
    id: 'chill',
    name: 'Chill',
    description: "It's time to chillax.",
    texturePath: new URL('../assets/faces/chill.png', import.meta.url).href,
  },
  {
    id: 'winningsmile',
    name: 'The Winning Smile',
    description: 'A million-dollar smile captivates any audience.',
    texturePath: new URL('../assets/faces/winningsmile.png', import.meta.url).href,
  },
  {
    id: 'supersuperhappy',
    name: 'Super Super Happy Face',
    description: 'I am not sure I have ever been this happy.',
    texturePath: new URL('../assets/faces/supersuperhappy.png', import.meta.url).href,
  },
  {
    id: 'epicface',
    name: 'Epic Face',
    description: 'ZOMG SO EPIK! SO FAIC! BUT IS IT OVAR 9000?',
    texturePath: new URL('../assets/faces/epicface.png', import.meta.url).href,
  },
  {
    id: 'faceless',
    name: 'Faceless',
    description: 'A face without a face.',
    texturePath: new URL('../assets/faces/faceless.png', import.meta.url).href,
  },
]

export function getAllFaces() {
  return faceItems.slice()
}

export function findFace(id) {
  return faceItems.find(f => f.id === id) || null
}
