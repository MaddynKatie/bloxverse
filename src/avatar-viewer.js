// Profile 3D avatar preview.
//
// Reference: unused/uirevamp/avatar_viewer.js. That build serves meshes and
// textures from an image API (/assets/:type.glb, /api/clothing/image/:id,
// /api/mesh/:id). BloxVerse has no image server, so the same viewer is rebuilt on
// the local pipeline that avatar.html and src/item-preview.js already use:
//
//   model      -> assets/models/{male,female}.glb
//   clothing   -> src/clothing.js   (texturePath)
//   faces      -> src/faces.js      (texturePath)
//   accessories-> src/accessories.js(meshPath, glb/glTF or fbx)
//
// Material names, the shirt/pant sets and the head blend shader are identical to
// the editor's, so an outfit looks the same here as it does in the avatar page.
//
// three.js is imported lazily, and every failure path degrades to the static
// full-body preview image rather than leaving an empty box on the profile.

const SHIRT_MATS = new Set(['Material.001', 'Material.003', 'Material.004', 'Material.005']);
const PANT_MATS = new Set(['Material.007', 'Material.008']);
const HEAD_MAT = 'Material.002';

// Material name -> [Head, Torso, L Arm, R Arm, L Leg, R Leg]
const BODY_MAT_SLOT = {
  'Material.002': 0,
  'Material.001': 1, 'Material.003': 1,
  'Material.004': 2,
  'Material.005': 3,
  'Material.007': 4,
  'Material.008': 5,
};
const SLOT_DEFAULTS = ['#ffffff', '#8350fb', '#ffffff', '#ffffff', '#400eb4', '#400eb4'];

// The face is mirrored across the head's centre seam and feathered at the edges;
// the clothing texture is alpha-composited over the body colour. Both are copied
// from avatar.html so the preview matches the editor exactly.
const headBlendShader = (shader) => {
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

const clothingBlendShader = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        diffuseColor.rgb = mix(diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a);
        diffuseColor.a = 1.0;
    #endif`
  );
};

// Vertex-colour mask the head shader reads to fade the face off at the seams.
function addHeadMask(THREE, mesh) {
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
    const t = Math.min(1, Math.max(0, (z - edgeLow) / (edgeHigh - edgeLow)));
    const smooth = t * t * (3 - 2 * t);
    const r = 1.0 - smooth;
    colors[v * 3] = r; colors[v * 3 + 1] = r; colors[v * 3 + 2] = r;
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Textures are shared across viewers. Models are NOT: a three.js object can only
// have one parent, so each viewer keeps its own loaded copy (see createViewer).
const textureCache = new Map();

const loadGltf = (loader, url) => new Promise((resolve, reject) => {
  loader.load(url, (gltf) => resolve(gltf.scene), undefined,
    (e) => reject(new Error(e?.message || 'GLTF load failed')));
});

// The loaders are passed in rather than reached for on the THREE namespace:
// GLTFLoader/FBXLoader ship as separate modules, exactly as avatar.html and
// src/item-preview.js import them.
function loadModel(modelCache, GLTFLoader, type) {
  if (!modelCache.has(type)) {
    const url = new URL(`../assets/models/${type}.glb`, import.meta.url).href;
    modelCache.set(type, loadGltf(new GLTFLoader(), url));
  }
  return modelCache.get(type);
}

function loadTexture(THREE, url) {
  if (!textureCache.has(url)) {
    textureCache.set(url, new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        resolve(tex);
      }, undefined, reject);
    }).catch((err) => {
      // A failed texture must not poison the cache for the next viewer.
      textureCache.delete(url);
      throw err;
    }));
  }
  return textureCache.get(url);
}

// Async because three.js and the catalogs are imported here rather than at
// module scope: a profile without an avatar preview must never pay for them.
// Resolves to null when the page cannot render 3D at all, and the caller keeps
// the static full-body preview in that case.
export async function createViewer(canvas, {
  width = 336,
  height = 420,
  transparent = true,
  interactive = true,
  fit = 1.15,
  rotateToggle = null,
} = {}) {
  let THREE, OrbitControls, GLTFLoader, FBXLoader, catalogs;
  try {
    [THREE, { OrbitControls }, { GLTFLoader }, { FBXLoader }, catalogs] = await Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/FBXLoader.js'),
      // Resolved through catalogStore, not faces.js/clothing.js/accessories.js
      // directly. Those hold only the bundled seed items, so an accessory that
      // exists solely in Cloudinary resolved to nothing and the viewer rendered a
      // bare white body. The store merges the server catalog in and falls back to
      // the seeds, so this is also correct before the catalog request lands.
      import('./catalogStore.js').then(store => ({
        findFace: store.findFaceStore,
        findClothing: store.findClothingStore,
        findAccessory: store.findAccessoryStore,
      })),
    ]);
  } catch (e) {
    console.warn('[avatar-viewer] 3D unavailable:', e);
    return null;
  }

  canvas.width = width;
  canvas.height = height;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent });
  } catch (e) {
    // No WebGL: bail out before the caller is told the viewer is ready.
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = null;

  // Same rig as avatar.html, which is tuned for the dark editor.
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdddddd, 0.3));
  for (const [intensity, x, y, z] of [[2.4, 4, 6, 5], [0.9, -4, 2, -3], [0.55, 0, 3, -6], [0.45, 0, -1, 6]]) {
    const light = new THREE.DirectionalLight(0xffffff, intensity);
    light.position.set(x, y, z);
    scene.add(light);
  }

  const camera = new THREE.PerspectiveCamera(32, width / height, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  // Every toggle keys off `interactive`, exactly like the reference viewer.
  controls.enablePan = interactive;
  controls.enableZoom = interactive;
  controls.enableRotate = interactive;
  controls.autoRotate = interactive;
  controls.autoRotateSpeed = 1.5;
  controls.enabled = interactive;

  // The reference leaves mouseButtons at the Three.js default
  // (LEFT: rotate, MIDDLE: dolly, RIGHT: pan), so right-drag pans the model.
  // Overriding RIGHT to ROTATE and leaving enablePan off made right-drag orbit
  // instead, which is not what the reference does. The context menu is still
  // suppressed, otherwise it interrupts a right-drag halfway through.
  const blockContextMenu = (e) => e.preventDefault();
  if (interactive) {
    canvas.addEventListener('contextmenu', blockContextMenu);
  }

  // The editor's rotate button is handed to the viewer rather than wired by the
  // page, so the lock icon and aria-pressed state cannot drift from autoRotate.
  if (rotateToggle) {
    const icon = rotateToggle.querySelector('i');
    const syncIcon = () => {
      rotateToggle.setAttribute('aria-pressed', String(controls.autoRotate));
      rotateToggle.title = controls.autoRotate ? 'Pause rotation' : 'Resume rotation';
      if (!icon) return;
      icon.classList.toggle('fa-lock-open', controls.autoRotate);
      icon.classList.toggle('fa-lock', !controls.autoRotate);
    };
    syncIcon();
    rotateToggle.addEventListener('click', () => {
      controls.autoRotate = !controls.autoRotate;
      syncIcon();
    });
  }

  let bodyColors = SLOT_DEFAULTS.slice();
  let materialMap = new Map();
  let headMaterials = [];
  let shirtMaterials = [];
  let pantMaterials = [];
  const modelCache = new Map(); // this viewer's own loaded models
  let currentScene = null;
  let characterHeight = 0;
  let cameraReady = false;
  let frameHandle = 0;
  let disposed = false;
  let accessories = new Map();
  // What the caller last asked for on each wearable slot. applyModel() rebuilds
  // the scene and its materials, so these are replayed afterwards -- otherwise
  // switching Male/Female would strip the worn outfit.
  const wanted = { shirt: null, pant: null, face: null };
  const { findFace, findClothing, findAccessory } = catalogs;

  function render() {
    if (disposed || !cameraReady) return;
    renderer.render(scene, camera);
  }

  function animate() {
    if (disposed) return;
    frameHandle = requestAnimationFrame(animate);
    controls.update();
    render();
  }

  function applyColors() {
    for (const [mat, slot] of materialMap) {
      const hex = bodyColors[slot] || SLOT_DEFAULTS[slot];
      // The head keeps its vertex colours: the blend shader needs the seam mask.
      if (!headMaterials.includes(mat)) mat.vertexColors = false;
      if (mat.emissive) mat.emissive.setHex(0);
      mat.emissiveIntensity = 0;
      mat.color.setStyle(hex, THREE.SRGBColorSpace);
      mat.needsUpdate = true;
    }
  }

  function clearTexture(mats) {
    for (const mat of mats) {
      mat.map = null;
      mat.needsUpdate = true;
    }
  }

  // Unknown id or an item with no texture: leave the slot unpainted rather than
  // promising a result the asset cannot back up.
  async function applyTexture(mats, id, lookup) {
    clearTexture(mats);
    if (id == null) return false;
    const def = lookup(id);
    if (!def?.texturePath) return false;
    try {
      const tex = await loadTexture(THREE, def.texturePath);
      for (const mat of mats) { mat.map = tex; mat.needsUpdate = true; }
      render();
      return true;
    } catch (e) {
      console.warn('[avatar-viewer] texture failed for', id, e);
      return false;
    }
  }

  async function applyAccessory(id) {
    if (accessories.has(id)) return true;
    const def = findAccessory(id);
    if (!def?.meshPath) return false;
    try {
      let root;
      const p = def.meshPath.toLowerCase();
      if (p.endsWith('.fbx')) {
        root = await new Promise((resolve, reject) => {
          new FBXLoader().load(def.meshPath, resolve, undefined,
            () => reject(new Error('FBX load failed')));
        });
      } else {
        root = await loadGltf(new GLTFLoader(), def.meshPath);
      }
      root.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (!mat?.transparent) continue;
          // Accessories are authored as thin double-sided shells; leaving them
          // transparent makes the character show through them.
          mat.transparent = false;
          mat.depthWrite = true;
          mat.alphaTest = 0.5;
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        }
      });
      if (!currentScene) return false;
      currentScene.add(root);
      root.updateMatrixWorld(true);
      // Tagged so showAccessoryOnly() can hide the body while leaving this alone.
      root.userData = root.userData || {};
      root.userData.isAccessory = true;
      accessories.set(id, root);
      return true;
    } catch (e) {
      console.warn('[avatar-viewer] accessory failed for', id, e);
      return false;
    }
  }

  async function applyModel(type) {
    let root;
    try {
      root = await loadModel(modelCache, GLTFLoader, type === 'female' ? 'female' : 'male');
    } catch (e) {
      console.warn('[avatar-viewer] model failed:', type, e);
      return false;
    }
    if (disposed) return false;

    // Loaded per viewer (no clone), same as the reference, so the skeleton and
    // the rendered meshes are the same objects.
    const model = root;
    headMaterials = [];
    shirtMaterials = [];
    pantMaterials = [];
    materialMap = new Map();

    model.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const isHeadMesh = mats.some((m) => m && m.name === HEAD_MAT);

      if (child.geometry && !isHeadMesh) {
        // Baked vertex colours would block applyColors() from tinting the body.
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

        if (mat.name === HEAD_MAT) {
          mat.vertexColors = true;
          mat.transparent = false;
          mat.onBeforeCompile = headBlendShader;
          mat.needsUpdate = true;
          headMaterials.push(mat);
          if (child.geometry && !child.geometry.getAttribute('color')) addHeadMask(THREE, child);
        } else {
          mat.vertexColors = false;
          if (SHIRT_MATS.has(mat.name)) { mat.transparent = false; mat.onBeforeCompile = clothingBlendShader; shirtMaterials.push(mat); }
          if (PANT_MATS.has(mat.name)) { mat.transparent = false; mat.onBeforeCompile = clothingBlendShader; pantMaterials.push(mat); }
          mat.needsUpdate = true;
        }
        const slot = BODY_MAT_SLOT[mat.name];
        if (slot !== undefined) materialMap.set(mat, slot);
      }
    });

    model.position.set(0, 0, 0);
    model.rotation.y = Math.PI;
    model.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(model);
    let center = box.getCenter(new THREE.Vector3());
    let size = box.getSize(new THREE.Vector3());

    model.position.y = -box.min.y;
    model.updateMatrixWorld(true);

    box = new THREE.Box3().setFromObject(model);
    center = box.getCenter(new THREE.Vector3());
    size = box.getSize(new THREE.Vector3());

    characterHeight = size.y;

    if (currentScene) scene.remove(currentScene);
    for (const obj of accessories.values()) obj.removeFromParent();
    accessories.clear();
    currentScene = model;
    scene.add(model);
    applyColors();
    // The materials above are brand new, so the worn textures have to go back
    // on or switching Male/Female would strip the outfit.
    await Promise.all([
      applyTexture(shirtMaterials, wanted.shirt, findClothing),
      applyTexture(pantMaterials, wanted.pant, findClothing),
      applyTexture(headMaterials, wanted.face, findFace),
    ]);

    if (!cameraReady) {
      const dist =
        (size.y / 2) /
        Math.tan((camera.fov * Math.PI / 180) / 2) *
        fit;

      camera.position.set(
        center.x,
        center.y,
        center.z + dist
      );

      controls.target.copy(center);

      controls.minDistance = dist * 0.4;
      controls.maxDistance = dist * 2;

      controls.update();
      cameraReady = true;
      animate();
    }
    return true;
  }

  // avatarColors is stored as { Head, Torso, Arms, Legs } by older docs, and as
  // the six per-side slots by the editor. Both are accepted, per-side first.
  function resolveColors(colors) {
    if (!colors) return SLOT_DEFAULTS.slice();
    const pick = (name, fallback) => {
      const value = colors[name];
      return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
    };
    const head = pick('Head', SLOT_DEFAULTS[0]);
    const torso = pick('Torso', SLOT_DEFAULTS[1]);
    const armL = pick('L Arm', pick('Arms', SLOT_DEFAULTS[2]));
    const armR = pick('R Arm', pick('Arms', SLOT_DEFAULTS[2]));
    const legL = pick('L Leg', pick('Legs', SLOT_DEFAULTS[4]));
    const legR = pick('R Leg', pick('Legs', SLOT_DEFAULTS[4]));
    return [head, torso, armL, armR, legL, legR];
  }

  // `outfit` mirrors the user doc: the same shape _equippedItemsFor() reads.
  async function loadOutfit(outfit = {}) {
    if (disposed) return false;
    bodyColors = resolveColors(outfit.avatarColors);
    // Set before applyModel() so its texture replay lands the saved outfit.
    wanted.shirt = outfit.avatarClothing ?? null;
    wanted.pant = outfit.avatarPants ?? null;
    wanted.face = outfit.avatarFace ?? null;
    const loaded = await applyModel(outfit.avatarBodyType || outfit.bodyType || 'male');
    if (!loaded) return false;
    for (const id of (Array.isArray(outfit.avatarAccessories) ? outfit.avatarAccessories : [])) {
      await applyAccessory(id);
    }
    render();
    return true;
  }

  function getBodyColors() {
    return bodyColors.slice();
  }

  function applyBodyColors(hexArray) {
    if (!Array.isArray(hexArray) || hexArray.length !== SLOT_DEFAULTS.length) return;
    bodyColors = hexArray.slice();
    applyColors();
    render();
  }

  function applyBodyColor(slot, hex) {
    if (slot < 0 || slot >= SLOT_DEFAULTS.length) return;
    bodyColors[slot] = hex;
    applyColors();
    render();
  }

  // The editor drives the preview slot by slot instead of reloading the outfit,
  // so each of these resolves once the texture is in place. They also record what
  // was asked for, which is what applyModel() replays onto a rebuilt scene.
  function applyShirt(id) {
    wanted.shirt = id;
    return applyTexture(shirtMaterials, id, findClothing);
  }

  function applyPant(id) {
    wanted.pant = id;
    return applyTexture(pantMaterials, id, findClothing);
  }

  function applyFace(id) {
    wanted.face = id;
    return applyTexture(headMaterials, id, findFace);
  }

  function equipAccessory(id) {
    return applyAccessory(id);
  }

  function unequipAccessory(id) {
    const obj = accessories.get(id);
    if (!obj) return;
    obj.removeFromParent();
    accessories.delete(id);
    render();
  }

  async function setAccessories(itemIds) {
    const wanted = new Set(Array.isArray(itemIds) ? itemIds : []);
    for (const [id, obj] of [...accessories]) {
      if (wanted.has(id)) continue;
      obj.removeFromParent();
      accessories.delete(id);
    }
    for (const id of wanted) await applyAccessory(id);
    render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameHandle);
    canvas.removeEventListener('contextmenu', blockContextMenu);
    controls.dispose();
    for (const obj of accessories.values()) obj.removeFromParent();
    accessories.clear();
    if (currentScene) scene.remove(currentScene);
    renderer.dispose();
  }

  // Renders synchronously and reads the buffer in the same task, which is the
  // only moment the drawing buffer is guaranteed to still hold the frame (it is
  // cleared once the frame is composited).
  function snapshot() {
    render();
    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[avatar-viewer] snapshot failed:', e);
      return null;
    }
  }

  // The saved profile/avatar thumbnails are square crops, so they are framed from
  // the model's own bounds here. Reusing the editor canvas would letterbox them
  // at its 210x266 aspect, and its camera is user-controllable, so neither can
  // produce a stable crop.
  function renderSquare(camera3d, size) {
    const rt = new THREE.WebGLRenderTarget(size, size);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera3d);
    renderer.setRenderTarget(null);
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    rt.dispose();

    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    // readRenderTargetPixels is bottom-up and canvas 2D is top-down.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const si = (y * size + x) * 4;
        const di = ((size - 1 - y) * size + x) * 4;
        imageData.data[di] = pixels[si];
        imageData.data[di + 1] = pixels[si + 1];
        imageData.data[di + 2] = pixels[si + 2];
        imageData.data[di + 3] = pixels[si + 3];
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return out.toDataURL('image/png');
  }

  // Show the character, or hide just the body and leave what it is wearing
  // visible. Accessories are children of the same root as the body, so flipping
  // currentScene.visible would take them down with it -- instead each mesh is
  // classified by whether an accessory root sits above it.
  function setBodyVisible(on) {
    if (!currentScene) return;
    currentScene.traverse((child) => {
      if (!child.isMesh) return;
      let node = child;
      let worn = false;
      while (node && node !== currentScene) {
        if (node.userData?.isAccessory) { worn = true; break; }
        node = node.parent;
      }
      child.visible = on || worn;
    });
    render();
  }

  // Point the camera at one object instead of the whole character, so an item
  // shown on its own fills the tile rather than sitting on it as a speck.
  function frameOn(root, pad = fit) {
    if (!root) return;
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z);
    const dist = (span / 2) / Math.tan((camera.fov * Math.PI / 180) / 2) * pad;
    camera.position.set(center.x, center.y, center.z + dist);
    controls.target.copy(center);
    controls.minDistance = dist * 0.4;
    controls.maxDistance = dist * 2;
    controls.update();
    render();
  }

  // The catalog detail page shows a wearable on its own instead of on a full
  // body (reference item.js:99). Try On is the mode that puts the character back,
  // so this is a view mode rather than a different character.
  async function showAccessoryOnly(id) {
    if (!currentScene && !(await applyModel('male'))) return false;
    for (const obj of accessories.values()) obj.removeFromParent();
    accessories.clear();
    setBodyVisible(false);
    if (!(await applyAccessory(id))) {
      setBodyVisible(true);
      return false;
    }
    frameOn(accessories.get(id), 1.6);
    return true;
  }

  function showAvatar() {
    setBodyVisible(true);
    // The camera was left framed on the accessory, and applyModel() only frames
    // once, so bring it back to the whole character here.
    if (currentScene) frameOn(currentScene);
    return true;
  }

  async function showFace(id) {
    if (!currentScene && !(await applyModel('male'))) return false;
    setBodyVisible(true);
    if (!(await applyFace(id))) return false;
    frameOn(currentScene);
    return true;
  }

  function snapshotBody(size = 256) {
    if (!currentScene || !characterHeight) return null;
    try {
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      const targetY = characterHeight * 0.45;
      const dist = (characterHeight / 2) / Math.tan((cam.fov * Math.PI / 180) / 2) * 1.05;
      cam.position.set(0, targetY, dist);
      cam.lookAt(0, targetY, 0);
      return renderSquare(cam, size);
    } catch (e) {
      console.warn('[avatar-viewer] body snapshot failed:', e);
      return null;
    }
  }

  function snapshotHead(size = 256) {
    if (!currentScene) return null;
    const box = new THREE.Box3();
    currentScene.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      if (mats.some((m) => headMaterials.includes(m))) box.expandByObject(child);
    });
    if (box.isEmpty()) return snapshotBody(size);
    try {
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      const center = box.getCenter(new THREE.Vector3());
      const size3 = box.getSize(new THREE.Vector3());
      const dist = (Math.max(size3.x, size3.y) / 2) / Math.tan((cam.fov * Math.PI / 180) / 2) * 1.45;
      cam.position.set(center.x, center.y, center.z + dist);
      cam.lookAt(center);
      return renderSquare(cam, size);
    } catch (e) {
      console.warn('[avatar-viewer] head snapshot failed:', e);
      return null;
    }
  }

  return {
    loadOutfit, dispose, controls, snapshot, snapshotBody, snapshotHead,
    applyModel, applyBodyColors, applyBodyColor, getBodyColors,
    applyShirt, applyPant, applyFace,
    equipAccessory, unequipAccessory, setAccessories,
    showAccessoryOnly, showAvatar, showFace,
  };
}