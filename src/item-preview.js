// Client-side catalog preview generation.
//
// The reference renders each catalog item on the server and serves the result
// from /api/catalog/thumbnail/:id. There is no image server here, so we do the
// equivalent in the browser: render the item once on the real avatar, cache the
// PNG, and reuse it everywhere. Nothing is uploaded.
//
//   clothing / pants -> the full white character wearing the item
//   faces            -> the head only, body hidden
//   accessories      -> the item alone, character hidden, framed on the mesh
//
// A hat is shown as a hat: an accessory next to a character is a screenshot of a
// character, and the item that was being shopped for is a detail on top of it.
//
// The cache is the avatar editor's own preview cache (bv:av:previews:v1, keyed
// by item id with the source it was rendered from), so a preview rendered here
// is reused by the editor and vice versa.
//
// three.js is imported lazily on first use, so a profile with nothing to
// generate never pays for it, and every entry point degrades to null (the
// caller then falls back to the item's flat texture or a letter tile).

const CACHE_KEY = 'bv:av:previews:v4';
const CACHE_MAX = 60; // data URLs are large; keep the tail bounded
// The tile a preview is shown in is 4:5 (catalog.css .catalog-product-image).
// Rendering square and letting object-fit letterbox it wasted 20% of the tile,
// which is why the full-body shots read small next to the faces. Render at the
// tile's shape so the model fills it.
const SIZE_W = 256;
const SIZE_H = 320;

// Which camera each kind is shot with, copied from avatar-render.html.
const FOV = 30;

// Clothing and faces are framed straight on from the model's own bounds instead of
// fixed coordinates, so they stay square to the camera and centred whatever the
// model looks like. An accessory is framed from its own mesh the same way, which
// is what lets the character be hidden and the item still fill the tile.
const SHOTS = {
  bodyMargin: 1.15,
  headMargin: 1.6,
  // A lone accessory is small and floats in the middle of the tile, so it gets a
  // little more air around it than a worn shirt does.
  accessoryMargin: 1.25,
  // The model is yawed by Math.PI (see loadAvatar), so these positions are on the
  // camera's axes, not the model's: front shots have positive Z, back shots
  // negative Z, and +X is the side that reads as the character's right.
  tiltedBase: { pos: [5, 5, 11], target: [0, 2.8, 0] },
  tiltedRight: { pos: [-5, 5, 11], target: [0, 2.8, 0] },
  backTiltedRight: { pos: [-5, 5, -11], target: [0, 2.8, 0] },
  tiltedPullback: 1.12,
};

// Straight-on framing: put the camera directly in front of the box centre, on
// the +Z axis the model faces after its Y rotation, far enough back that the box
// fits the frame on both axes. The tile is 4:5, so the horizontal field of view
// is the narrower one and a wide model has to clear that.
function frame(box, margin) {
  const sizeX = box.max.x - box.min.x;
  const sizeY = box.max.y - box.min.y;
  const cx = (box.max.x + box.min.x) / 2;
  const cy = (box.max.y + box.min.y) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  const halfFov = (FOV / 2) * (Math.PI / 180);
  const aspect = SIZE_W / SIZE_H;
  const dist = Math.max(
    (sizeY / 2 / Math.tan(halfFov)),
    (sizeX / 2 / Math.tan(halfFov) / aspect),
  ) * margin;
  return { pos: [cx, cy, cz + dist], target: [cx, cy, cz] };
}

const WHITE = '#ffffff';

// -- cache ---------------------------------------------------------------

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}

function writeCache(cache) {
  try {
    // Object key order is insertion order, so the oldest entries lead.
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota or private mode; previews just won't persist */ }
}

const sourceOf = (item) => item.texturePath || item.meshPath || item.id || '';

// The catalog sends raw store items (no 'kind'), so translate the same way the
// avatar page does: faces -> face, any accessory type -> accessory, pants -> pants,
// everything else wearable -> clothing. Also keep hair/back/accessory distinct
// when present.
const accessoryLabels = {
  hat: 'Hats', hair: 'Hair', face_accessory: 'Face Accessories',
  neck_accessory: 'Neck Accessories', shoulder_accessory: 'Shoulder Accessories',
  front_accessory: 'Front Accessories', back_accessory: 'Back Accessories',
  waist_accessory: 'Waist Accessories',
};
function kindFor(item) {
  if (item.kind) return item.kind;
  if (item.type === 'face') return 'face';
  if (item.type === 'emote') return 'emote';
  if (item.type === 'accessory') {
    const raw = item.category || '';
    const c = raw.toLowerCase().replace(/\s+/g, '_');
    if (c === 'hair') return 'hair';
    if (c === 'hat' || c === 'hats') return 'accessory';
    if (c === 'back_accessory') return 'back_accessory';
    if (c === 'front_accessory') return 'front_accessory';
    if (c === 'face_accessory') return 'face_accessory';
    if (c === 'neck_accessory') return 'neck_accessory';
    if (c === 'shoulder_accessory') return 'shoulder_accessory';
    if (c === 'waist_accessory') return 'waist_accessory';
    if (c) return c;
    return 'accessory';
  }
  if (item.type === 'pant' || item.category === 'Pants') return 'pants';
  if (item.type === 'shirt' || item.type === 'clothing') return 'clothing';
  return item.type || 'clothing';
}

// Bump when the camera/visibility logic changes, so entries rendered by the old
// shot logic miss instead of being served forever.
const RENDER_VERSION = 9;

export function hasCachedPreview(item) {
  const hit = readCache()[item.id];
  const k = item.kind || kindFor(item);
  const s = sourceOf(item);
  return !!hit && hit.source === s && hit.kind === k
    && hit.version === RENDER_VERSION && typeof hit.dataUrl === 'string';
}

export function cachedPreview(item) {
  return hasCachedPreview(item) ? readCache()[item.id].dataUrl : null;
}

// -- renderer ------------------------------------------------------------
// One scene for the whole page: the avatar model is loaded at most once and
// reused, so a five-item grid is one model fetch rather than five.

let bootPromise = null;

function boot() {
  bootPromise ||= (async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    const [{ findFace }, { findClothing }, { findAccessory }] = await Promise.all([
      import('./faces.js'), import('./clothing.js'), import('./accessories.js'),
    ]);

    const scene = new THREE.Scene();
    scene.background = null;
    // avatar.html's rig is tuned for the dark editor and reads as mid-grey on a
    // white tile: three.js divides directional irradiance by PI, so the original
    // intensities top out well short of white. Scale them up so the character
    // actually reads as white, and keep an ambient floor so no face goes black.
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdddddd, 0.3));
    // Keyed by name so a back-facing shot can mirror the rig: the camera moves
    // to the other side of the model, so the lights have to move with it or the
    // rendered back is lit from behind and reads flat grey against the front.
    const RIG = [
      ['key', 2.4, 4, 6, 5], ['fill', 0.9, -4, 2, -3],
      ['rim', 0.55, 0, 3, -6], ['under', 0.45, 0, -1, 6],
    ];

      const state = {
      THREE, scene, findFace, findClothing, findAccessory,
      gltfLoader: new GLTFLoader(), fbxLoader: new FBXLoader(),
      avatar: null, headMaterials: [], shirtMaterials: [], pantMaterials: [],
      materialMap: new Map(), accessories: new Map(),
      lights: [],
      renderer: null,
      };

    state.lights = RIG.map(([name, intensity, x, y, z]) => {
      const light = new THREE.DirectionalLight(0xffffff, intensity);
      light.name = name;
      light.userData.home = [x, y, z];
      light.position.set(x, y, z);
      scene.add(light);
      return light;
    });

    await loadAvatar(state);
    return state;
  })().catch(err => {
    console.warn('[previews] renderer unavailable:', err);
    bootPromise = null; // let a later call retry
    return null;
  });
  return bootPromise;
}

// Material names come straight from the avatar model, same as the editor.
const SLOT_NAMES = ['Head', 'Torso', 'L Arm', 'R Arm', 'L Leg', 'R Leg'];
const BODY_MAT_SLOT = {
  'Material.002': 0,
  'Material.001': 1, 'Material.003': 1,
  'Material.004': 2,
  'Material.005': 3,
  'Material.007': 4,
  'Material.008': 5,
};
const SHIRT_MATS = new Set(['Material.001', 'Material.003', 'Material.004', 'Material.005']);
const PANT_MATS = new Set(['Material.007', 'Material.008']);

// The face is mirrored across the head's centre seam and feathered at the
// edges; the clothing texture is alpha-composited over the body colour.
const headBlendShader = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '');
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vec2(1.0 - vMapUv.x, vMapUv.y));
        float front = vColor.r;
        diffuseColor.rgb = mix(diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a * front);
        diffuseColor.a = 1.0;
    #endif`
  );
};
const clothingBlendShader = shader => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        diffuseColor.rgb = mix(diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a);
        diffuseColor.a = 1.0;
    #endif`
  );
};

const loadGltf = (loader, url) => new Promise((resolve, reject) => {
  loader.load(url, gltf => resolve(gltf.scene), undefined, e => reject(new Error(e?.message || 'GLTF load failed')));
});

const loadTexture = (THREE, url) => new Promise((resolve, reject) => {
  new THREE.TextureLoader().load(url, tex => { tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); }, undefined, reject);
});

const loadAccessoryModel = (state, def) => new Promise((resolve, reject) => {
  const p = def.meshPath.toLowerCase();
  if (p.endsWith('.fbx')) state.fbxLoader.load(def.meshPath, resolve, undefined, () => reject(new Error('FBX load failed')));
  else if (p.endsWith('.glb') || p.endsWith('.gltf')) loadGltf(state.gltfLoader, def.meshPath).then(resolve, reject);
  else reject(new Error('unsupported accessory format'));
});

async function loadAvatar(state) {
  const root = await loadGltf(state.gltfLoader, new URL('../assets/models/male.glb', import.meta.url).href);

  state.headMaterials = [];
  state.shirtMaterials = [];
  state.pantMaterials = [];
  state.materialMap.clear();

  root.traverse(child => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const isHeadMesh = mats.some(m => m && m.name === 'Material.002');

    if (child.geometry && !isHeadMesh) {
      // Body meshes must not keep baked vertex colours, or applyColors() below
      // cannot make the character white.
      for (const key of Object.keys(child.geometry.attributes)) {
        if (key.toLowerCase().includes('color')) child.geometry.deleteAttribute(key);
      }
      if (child.geometry.morphAttributes) {
        for (const key of Object.keys(child.geometry.morphAttributes)) {
          if (key.toLowerCase().includes('color')) delete child.geometry.morphAttributes[key];
        }
      }
    }

    for (const mat of mats) {
      if (!mat) continue;
      mat.toneMapped = false;
      if (mat.emissive) mat.emissive.setHex(0);
      mat.emissiveIntensity = 0;

      const slot = BODY_MAT_SLOT[mat.name];
      if (mat.name === 'Material.002') {
        mat.vertexColors = true;
        mat.transparent = false;
        mat.onBeforeCompile = headBlendShader;
        mat.needsUpdate = true;
        state.headMaterials.push(mat);
        if (child.geometry && !child.geometry.getAttribute('color')) addHeadMask(state, child);
        if (slot !== undefined) state.materialMap.set(mat, slot);
        continue;
      }

      mat.vertexColors = false;
      if (SHIRT_MATS.has(mat.name) || PANT_MATS.has(mat.name)) {
        mat.transparent = false;
        mat.onBeforeCompile = clothingBlendShader;
        if (SHIRT_MATS.has(mat.name)) state.shirtMaterials.push(mat);
        if (PANT_MATS.has(mat.name)) state.pantMaterials.push(mat);
      }
      mat.needsUpdate = true;
      if (slot !== undefined) state.materialMap.set(mat, slot);
    }
  });

  const box = new state.THREE.Box3().setFromObject(root);
  root.position.set(0, -box.min.y, 0);
  // The model is authored facing local -Z and the shots are taken from +Z, so
  // this half turn is what makes the character face the camera.
  root.rotation.y = Math.PI;
  root.updateMatrixWorld(true);
  state.scene.add(root);
  state.avatar = root;

  // Measure the body and the head once, in world space, so the straight-on
  // shots can be aimed at them. Box3 walks invisible meshes too, so the head box
  // is measured from the head materials rather than after anything is hidden.
  state.bodyBox = new state.THREE.Box3().setFromObject(root);
  const headMats = new Set(state.headMaterials);
  const headBox = new state.THREE.Box3();
  root.traverse(child => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    if (mats.length && mats.every(m => headMats.has(m))) headBox.expandByObject(child);
  });
  state.headBox = headBox.isEmpty() ? state.bodyBox : headBox;
}

// Vertex-colour mask the head shader uses to fade the face off at the seams.
function addHeadMask(state, mesh) {
  const posAttr = mesh.geometry.getAttribute('position');
  if (!posAttr) return;
  const pos = posAttr.array;
  const count = posAttr.count;
  let minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < count; v++) {
    const z = pos[v * 3 + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const zRange = maxZ - minZ || 1;
  const feather = 0.35;
  const edgeLow = minZ + zRange * (0.5 - feather / 2);
  const edgeHigh = minZ + zRange * (0.5 + feather / 2);
  const colors = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const z = pos[v * 3 + 2];
    let t = (z - edgeLow) / (edgeHigh - edgeLow);
    t = Math.min(1, Math.max(0, t));
    const smooth = t * t * (3 - 2 * t);
    const r = 1.0 - smooth;
    colors[v * 3] = r; colors[v * 3 + 1] = r; colors[v * 3 + 2] = r;
  }
  mesh.geometry.setAttribute('color', new state.THREE.BufferAttribute(colors, 3));
  mesh.geometry.getAttribute('color').needsUpdate = true;
}

function paintWhite(state) {
  for (const [mat, slot] of state.materialMap) {
    if (!state.headMaterials.includes(mat)) mat.vertexColors = false;
    mat.emissive && mat.emissive.setHex(0);
    mat.emissiveIntensity = 0;
    mat.toneMapped = false;
    mat.transparent = false;
    mat.opacity = 1;
    mat.color.setStyle(WHITE, state.THREE.SRGBColorSpace);
    mat.needsUpdate = true;
  }
}

function clearTexture(mats) {
  for (const mat of mats) {
    if (mat.map) { mat.map.dispose(); mat.map = null; }
    mat.needsUpdate = true;
  }
}

// Each of these reports whether the item was actually found and applied. An
// unknown or asset-less id must return false, otherwise we would happily
// capture a blank white body and cache it as that item's preview.
//
// The definition passed in wins over the local seed registry. renderItemPreview
// already holds the merged catalog entry, which is the only place a Cloudinary-only
// item exists: looking the id up in faces.js/accessories.js found nothing for those
// and reported a missing texture for an item that in fact had a perfectly good URL.
function resolveDef(passed, id, finder) {
  return passed || finder(id);
}

async function applyFace(state, faceId, passed) {
  clearTexture(state.headMaterials);
  const def = resolveDef(passed, faceId, state.findFace);
  if (!def?.texturePath && !def?.imageUrl && !def?.fileUrl) {
    console.warn('[previews] face missing texture for', faceId);
    return false;
  }
  const texUrl = def.texturePath || def.imageUrl || def.fileUrl;
  const tex = await loadTexture(state.THREE, texUrl);
  tex.flipY = false;
  for (const mat of state.headMaterials) { mat.map = tex; mat.needsUpdate = true; }
  return true;
}

async function applyClothing(state, mats, itemId, passed) {
  clearTexture(mats);
  const def = resolveDef(passed, itemId, state.findClothing);
  if (!def?.texturePath && !def?.imageUrl && !def?.fileUrl) {
    console.warn('[previews] clothing missing texture for', itemId);
    return false;
  }
  const texUrl = def.texturePath || def.imageUrl || def.fileUrl;
  const tex = await loadTexture(state.THREE, texUrl);
  tex.flipY = false;
  for (const mat of mats) { mat.map = tex; mat.needsUpdate = true; }
  return true;
}

function clearAccessories(state) {
  for (const obj of state.accessories.values()) obj.removeFromParent();
  state.accessories.clear();
}

async function applyAccessory(state, accId, passed) {
  const def = resolveDef(passed, accId, state.findAccessory);
  if (!def?.meshPath && !def?.modelUrl && !def?.fileUrl) {
    console.warn('[previews] accessory missing meshPath/modelUrl/fileUrl for', accId);
    return false;
  }
  const modelUrl = def.meshPath || def.modelUrl || def.fileUrl;
  const root = await loadAccessoryModel(state, { ...def, meshPath: modelUrl });
  root.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
  state.avatar.add(root);
  root.userData = root.userData || {};
  root.userData.isAccessory = true;
  root.updateMatrixWorld(true);
  state.accessories.set(def.id, root);
  return true;
}

// Hide everything that is not the head, so a face reads as a floating head.
function setHeadOnly(state, on) {
  const head = new Set(state.headMaterials);
  state.avatar.traverse(child => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const isHead = mats.length > 0 && mats.every(m => head.has(m));
    if (!isHead) child.visible = !on;
  });
  for (const obj of state.accessories.values()) obj.visible = !on;
}

// Ancestry decides, because applyAccessory parents the mesh under the avatar and
// nothing about the mesh itself distinguishes it from a body part.
function isAccessoryMesh(mesh) {
  for (let node = mesh; node; node = node.parent) {
    if (node.userData?.isAccessory) return true;
  }
  return false;
}

// Hide the character so an accessory reads as the item on its own. Visibility is
// set per mesh rather than on the accessory root, because the root and its meshes
// are separate objects and only the meshes are what get drawn.
function setAccessoryOnly(state, on) {
  state.avatar.traverse(child => {
    if (child.isMesh) child.visible = !on || isAccessoryMesh(child);
  });
}

// Pants and shirts are worn on the avatar in the grid (the reference shows the
// character wearing them). Back accessories get the tilted shot, which looks best
// when the item floats alone. Hair: we hide the character and frame it alone,
// same as the reference's flat item thumbnail for hair.
function setItemOnly(state, on) {
  state.avatar.traverse(child => {
    if (child.isMesh) child.visible = !on || isAccessoryMesh(child);
  });
}

// The rig is authored for the front-facing shots. A shot taken from behind sees
// the unlit side of every mesh, so mirror the rig in Z for it; ambient and
// hemisphere are directionless and stay put.
function setLightSide(state, mirrored) {
  for (const light of state.lights || []) {
    const [x, y, z] = light.userData.home;
    light.position.set(x, y, mirrored ? -z : z);
  }
}

function capture(state, shot) {
  const { THREE, scene } = state;
  const W = SIZE_W, H = SIZE_H;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = state.renderer || new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, alpha: true });
  state.renderer = renderer;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
  renderer.setClearColor(0x000000, 0);

  const cam = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 100);
  cam.position.set(...shot.pos);
  cam.lookAt(new THREE.Vector3(...shot.target));

  const rt = new THREE.WebGLRenderTarget(W, H);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);

  const pixels = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
  rt.dispose();
  // Don't dispose shared renderer; reuse across captures
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  const imageData = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const di = ((H - 1 - y) * W + x) * 4;
      imageData.data[di] = pixels[si];
      imageData.data[di + 1] = pixels[si + 1];
      imageData.data[di + 2] = pixels[si + 2];
      imageData.data[di + 3] = pixels[si + 3];
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return out.toDataURL('image/png');
}

// Renders one item and returns a data URL, or null if it cannot be rendered.
export async function renderItemPreview(item) {
  const state = await boot();
  if (!state) return null;
  const k = kindFor(item);
    const headOnly = k === 'face';
    const backAccessory = k === 'back_accessory';
    const itemOnly = false; // show full character for all accessories
    const tiltShot = backAccessory || k === 'accessory' || k === 'hair' || k === 'front_accessory' || k === 'face_accessory' || k === 'neck_accessory' || k === 'shoulder_accessory' || k === 'waist_accessory' || k === 'hat';
  try {
    // Always start from a clean, all-white character.
    clearAccessories(state);
    clearTexture(state.shirtMaterials);
    clearTexture(state.pantMaterials);
    clearTexture(state.headMaterials);
    paintWhite(state);
    setHeadOnly(state, false);

    let applied;
    if (k === 'face') {
      applied = await applyFace(state, item.id, item);
    } else if (k === 'emote') {
      return null; // no 3D preview for emotes; let fallback handle
    } else if (k === 'accessory' || k === 'hair' || k === 'back_accessory' || k === 'front_accessory' || k === 'face_accessory' || k === 'neck_accessory' || k === 'shoulder_accessory' || k === 'waist_accessory') {
      applied = await applyAccessory(state, item.id, item);
    } else {
      applied = await applyClothing(state, k === 'pants' ? state.pantMaterials : state.shirtMaterials, item.id, item);
    }
    // Unknown id or missing asset: leave the tile on its own fallback rather
    // than caching a blank character as this item's preview.
    if (!applied) {
      console.warn('[previews] apply failed for', item?.id, k, item?.meshPath, item?.texturePath);
      return null;
    }
    state.avatar.updateMatrixWorld(true);

    if (headOnly) setHeadOnly(state, true);
    if (itemOnly) setItemOnly(state, true);
    state.avatar.updateMatrixWorld(true);

    // The accessory/hair/back accessory are framed from their own mesh, so the
    // character it used to be measured against is no longer drawn.
    let shot;
    if (itemOnly) {
      const accRoot = state.accessories.get(item.id);
      const box = new state.THREE.Box3().setFromObject(accRoot || state.avatar);
      if (box.isEmpty()) return null;
      if (backAccessory) {
        const { pos, target } = SHOTS.tiltedBase;
        shot = { pos: [target[0] - (pos[0]-target[0])*SHOTS.tiltedPullback, target[1], target[2] + (pos[2]-target[2])*SHOTS.tiltedPullback*.5],
                 target: [...target] };
      } else {
        // This shouldn't happen now since only back accessory is itemOnly
        const { pos, target } = SHOTS.tiltedBase;
        shot = { pos: target.map((t, i) => t + (pos[i] - t) * SHOTS.tiltedPullback), target: [...target] };
      }
    } else if (tiltShot) {
      // Tilted shot of full character tilted to user's right to show accessory on body
      const base = backAccessory ? SHOTS.backTiltedRight : SHOTS.tiltedRight;
      const { pos, target } = base;
      shot = { pos: target.map((t, i) => t + (pos[i] - t) * SHOTS.tiltedPullback), target: [...target] };
    } else {
      shot = headOnly ? frame(state.headBox, SHOTS.headMargin)
        : frame(state.bodyBox, SHOTS.bodyMargin);
    }
    const dataUrl = (setLightSide(state, backAccessory), capture(state, shot));
    setLightSide(state, false);
    if (headOnly) setHeadOnly(state, false);
    if (itemOnly) setItemOnly(state, false);
    return dataUrl;
  } catch (err) {
    console.warn('[previews] render failed for', item?.id, err);
    return null;
  }
}

// Cached-first: only items with no usable preview are rendered. onRender is
// called as each item lands, so a grid can fill in progressively instead of
// waiting for the whole batch.
export async function ensureItemPreviews(items, onRender) {
  const out = new Map();
  const missing = [];
  for (const item of items) {
    const hit = cachedPreview(item);
    if (hit) out.set(item.id, hit);
    else missing.push(item);
  }
  if (!missing.length) return out;

  const state = await boot();
  if (!state) return out;

  const cache = readCache();
  for (const item of missing) {
    const dataUrl = await renderItemPreview(item);
    if (!dataUrl) continue;
    cache[item.id] = { dataUrl, source: sourceOf(item), kind: item.kind || kindFor(item), version: RENDER_VERSION };
    // Persist before the callback: the callback repaints from the cache, so an
    // entry that is only flushed at the end of the batch would still miss.
    writeCache(cache);
    out.set(item.id, dataUrl);
    onRender?.(item, dataUrl);
  }
  return out;
}
