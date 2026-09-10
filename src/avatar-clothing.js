import * as THREE from 'three';

import { findClothing } from './clothing.js';

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const overlayCache = new WeakMap();
const pantsCache = new WeakMap();
// Keyed by the model (avatar) itself now, not a single mesh's geometry --
// see note below on why a single mesh can no longer be assumed.
const remappedGeometryCache = new WeakMap();
const pantsRemappedCache = new WeakMap();

// Normalized rectangles from the exact obfuscated code mappings
const TEMPLATE_RECTS = {
  torso: {
    top: [0.39487179487179486, 0.8711985688729875, 0.6136752136752137, 0.9856887298747764],
    front: [0.39487179487179486, 0.6386404293381038, 0.6136752136752137, 0.8676207513416816],
    bottom: [0.39487179487179486, 0.5205724508050089, 0.6136752136752137, 0.6350626118067979],
    left: [0.6170940170940171, 0.6386404293381038, 0.7264957264957265, 0.8676207513416816],
    right: [0.28205128205128205, 0.6386404293381038, 0.39145299145299145, 0.8676207513416816],
    back: [0.7299145299145299, 0.6386404293381038, 0.9487179487179487, 0.8676207513416816]
  },
  rightArm: {
    top: [0.37094017094017095, 0.368515205724508, 0.48034188034188036, 0.483005366726297],
    left: [0.03247863247863248, 0.13595706618962433, 0.14188034188034188, 0.3649373881932021],
    front: [0.37094017094017095, 0.13595706618962433, 0.48034188034188036, 0.3649373881932021],
    right: [0.25811965811965815, 0.13595706618962433, 0.36752136752136755, 0.3649373881932021],
    back: [0.1452991452991453, 0.13595706618962433, 0.2547008547008547, 0.3649373881932021],
    bottom: [0.37094017094017095, 0.017889087656529523, 0.48034188034188036, 0.1323792486583184]
  },
  leftArm: {
    top: [0.5264957264957265, 0.368515205724508, 0.6358974358974359, 0.483005366726297],
    front: [0.5264957264957265, 0.13595706618962433, 0.6358974358974359, 0.3649373881932021],
    left: [0.6393162393162393, 0.13595706618962433, 0.7487179487179487, 0.3649373881932021],
    back: [0.7521367521367521, 0.13595706618962433, 0.8615384615384616, 0.3649373881932021],
    right: [0.8649572649572649, 0.13595706618962433, 0.9726495726495726, 0.3649373881932021],
    bottom: [0.5264957264957265, 0.017889087656529523, 0.6358974358974359, 0.1323792486583184]
  }
};

function getTexture(texturePath) {
  if (!textureCache.has(texturePath)) {
    const texture = textureLoader.load(texturePath);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    textureCache.set(texturePath, texture);
  }
  return textureCache.get(texturePath);
}

// The model is NOT one combined skinned mesh covering the whole body --
// glTF splits a multi-material mesh into one SkinnedMesh per material/body
// part (e.g. "B7Body", "B7Body_1", ... each with a single material). The
// old getBaseSkinnedMesh() grabbed only the very first one it found during
// traversal (which happened to be the head), so shirts/pants had almost no
// real body geometry to work with. Gather every skinned mesh instead.
function getAllSkinnedMeshes(model) {
  const meshes = [];
  model?.traverse(child => {
    if (child.isSkinnedMesh) meshes.push(child);
  });
  return meshes;
}

function getDominantBoneIndex(mesh, vertexIndex) {
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  if (!skinIndex || !skinWeight || !mesh.skeleton) return -1;

  let bestSlot = 0;
  let bestWeight = skinWeight.getX(vertexIndex);
  for (let slot = 1; slot < 4; slot++) {
    const weight = skinWeight.getComponent(vertexIndex, slot);
    if (weight > bestWeight) {
      bestWeight = weight;
      bestSlot = slot;
    }
  }

  return skinIndex.getComponent(vertexIndex, bestSlot);
}

function classifyBoneName(boneName) {
  const name = boneName.toLowerCase();
  if (name.includes('torso')) return 'torso';
  if (name.includes('left_arm') || name.includes('left arm')) return 'leftArm';
  if (name.includes('right_arm') || name.includes('right arm')) return 'rightArm';
  if (name.includes('left_leg') || name.includes('left leg')) return 'leftLeg';
  if (name.includes('right_leg') || name.includes('right leg')) return 'rightLeg';
  return null;
}

function getDominantPart(mesh, vertexIndex) {
  const boneIndex = getDominantBoneIndex(mesh, vertexIndex);
  const boneName = boneIndex >= 0 ? mesh.skeleton.bones[boneIndex]?.name || '' : '';
  return classifyBoneName(boneName);
}

function expandBounds(bounds, positionAttribute, vertexIndex) {
  const x = positionAttribute.getX(vertexIndex);
  const y = positionAttribute.getY(vertexIndex);
  const z = positionAttribute.getZ(vertexIndex);
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

function createEmptyBounds() {
  return {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
}

// Yields [i0, i1, i2] vertex indices for every triangle in a mesh, honoring
// the index buffer when present. The previous version always walked the
// position attribute in flat triples, which silently produced garbage
// "triangles" out of unrelated vertices for any indexed geometry (which
// this model's geometry is -- every part re-uses shared vertices between
// faces via an index buffer, so consecutive position-buffer entries are NOT
// triangle triples).
function* iterateTriangleIndices(mesh) {
  const index = mesh.geometry.index;
  if (index) {
    for (let t = 0; t < index.count; t += 3) {
      yield [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    }
  } else {
    const count = mesh.geometry.attributes.position.count;
    for (let i = 0; i < count; i += 3) {
      yield [i, i + 1, i + 2];
    }
  }
}

// Analyzes every skinned mesh in the model and buckets each of its
// triangles into torso / leftArm / rightArm (for shirts) by the triangle's
// dominant bone. Because the model is split into one mesh per body part,
// this naturally also handles the case where everything is combined into a
// single mesh (as the dominant-bone check still works per vertex either
// way) -- it just no longer silently skips every mesh except the first.
function analyzeTriangles(meshes) {
  const partBounds = {
    torso: createEmptyBounds(),
    leftArm: createEmptyBounds(),
    rightArm: createEmptyBounds(),
  };
  const triangles = [];

  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes.position;
    for (const [i0, i1, i2] of iterateTriangleIndices(mesh)) {
      const p0 = getDominantPart(mesh, i0);
      const p1 = getDominantPart(mesh, i1);
      const p2 = getDominantPart(mesh, i2);
      let part = null;
      if (p0 && p0 === p1 && p0 === p2) part = p0;
      else if (p0 && p0 === p1) part = p0;
      else if (p1 && p1 === p2) part = p1;
      else if (p0 && p0 === p2) part = p0;
      else if (p0) part = p0;
      else if (p1) part = p1;
      else if (p2) part = p2;

      if (!part || !partBounds[part]) continue;

      triangles.push({ mesh, i0, i1, i2, part });
      expandBounds(partBounds[part], positions, i0);
      expandBounds(partBounds[part], positions, i1);
      expandBounds(partBounds[part], positions, i2);
    }
  }

  return { triangles, partBounds };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function invLerp(min, max, value) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 1e-5) return 0.5;
  return clamp01((value - min) / (max - min));
}

function detectFace(nx, ny, nz) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);

  if (ax >= ay && ax >= az) return nx >= 0 ? 'left' : 'right';
  if (az >= ax && az >= ay) return nz >= 0 ? 'bottom' : 'top';
  return ny >= 0 ? 'front' : 'back';
}

function sampleFaceUV(part, face, position, bounds) {
  const dx = bounds.maxX > bounds.minX ? (position.x - bounds.minX) / (bounds.maxX - bounds.minX) : 0.5;
  const dy = bounds.maxY > bounds.minY ? (position.y - bounds.minY) / (bounds.maxY - bounds.minY) : 0.5;
  const dz = bounds.maxZ > bounds.minZ ? (position.z - bounds.minZ) / (bounds.maxZ - bounds.minZ) : 0.5;

  let u, v;
  switch (face) {
    case 'front': u = dx; v = 1 - dz; break;
    case 'back': u = 1 - dx; v = 1 - dz; break;
    case 'left': u = 1 - dy; v = 1 - dz; break;
    case 'right': u = dy; v = 1 - dz; break;
    case 'top': u = dx; v = 1 - dy; break;
    case 'bottom': u = dx; v = dy; break;
    default: u = dx; v = 1 - dz; break;
  }

  return { u: clamp01(u), v: clamp01(v) };
}

function toTemplateUV(rect, localU, localV) {
  const [x0, y0, x1, y1] = rect;
  const u = x0 + (x1 - x0) * localU;
  const v = y0 + (y1 - y0) * localV;
  return [u, v];
}

// Builds one combined overlay geometry out of triangles collected from
// (potentially several) source meshes. Every part-mesh here shares the same
// identity local transform and skeleton bind pose (verified against the
// actual model), so their position/normal/skin attributes can be combined
// directly with no extra transform bookkeeping.
function buildRemappedGeometryFromTriangles(triangles, partBoundsOrRemap, remapPart) {
  const remappedPositions = [];
  const remappedNormals = [];
  const remappedSkinIndices = [];
  const remappedSkinWeights = [];
  const remappedUvs = [];

  for (const triangle of triangles) {
    const effectivePart = remapPart ? remapPart(triangle.part) : triangle.part;
    if (!effectivePart) continue;
    const faceRects = TEMPLATE_RECTS[effectivePart];
    if (!faceRects) continue;
    const bounds = partBoundsOrRemap[triangle.part];
    if (!bounds) continue;

    const mesh = triangle.mesh;
    const positions = mesh.geometry.attributes.position;
    const normals = mesh.geometry.attributes.normal;
    const skinIndex = mesh.geometry.attributes.skinIndex;
    const skinWeight = mesh.geometry.attributes.skinWeight;

    const idxs = [triangle.i0, triangle.i1, triangle.i2];
    const verts = idxs.map(i => new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)));

    const edge1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
    const edge2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
    const faceNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

    const face = detectFace(faceNormal.x, faceNormal.y, faceNormal.z);
    const rect = faceRects[face];
    if (!rect) continue;

    for (let j = 0; j < 3; j++) {
      const sourceIndex = idxs[j];
      const vertex = verts[j];
      const local = sampleFaceUV(triangle.part, face, vertex, bounds);
      const [u, v] = toTemplateUV(rect, local.u, local.v);

      remappedPositions.push(vertex.x, vertex.y, vertex.z);
      remappedNormals.push(
        normals.getX(sourceIndex),
        normals.getY(sourceIndex),
        normals.getZ(sourceIndex),
      );
      remappedSkinIndices.push(
        skinIndex.getX(sourceIndex),
        skinIndex.getY(sourceIndex),
        skinIndex.getZ(sourceIndex),
        skinIndex.getW(sourceIndex),
      );
      remappedSkinWeights.push(
        skinWeight.getX(sourceIndex),
        skinWeight.getY(sourceIndex),
        skinWeight.getZ(sourceIndex),
        skinWeight.getW(sourceIndex),
      );
      remappedUvs.push(u, v);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(remappedPositions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(remappedNormals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(remappedUvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(remappedSkinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(remappedSkinWeights, 4));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildRemappedGeometry(model) {
  if (remappedGeometryCache.has(model)) {
    return remappedGeometryCache.get(model).clone();
  }

  const meshes = getAllSkinnedMeshes(model);
  const { triangles, partBounds } = analyzeTriangles(meshes);
  const geometry = buildRemappedGeometryFromTriangles(triangles, partBounds, null);

  remappedGeometryCache.set(model, geometry.clone());
  return geometry;
}

function removeAvatarClothing(model) {
  const overlay = overlayCache.get(model);
  if (!overlay) return;
  overlay.removeFromParent();
  overlay.geometry?.dispose?.();
  const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material];
  for (const material of materials) material?.dispose?.();
  overlayCache.delete(model);
}

function bindOverlayLikeSource(overlay, sourceMesh) {
  overlay.position.copy(sourceMesh.position);
  overlay.quaternion.copy(sourceMesh.quaternion);
  overlay.scale.copy(sourceMesh.scale);
  overlay.bindMode = sourceMesh.bindMode;
  overlay.bind(sourceMesh.skeleton, sourceMesh.bindMatrix.clone());
  overlay.bindMatrixInverse.copy(sourceMesh.bindMatrixInverse);
}

function applyAvatarClothing(model, clothingId) {
  removeAvatarClothing(model);

  const clothing = findClothing(clothingId);
  if (!model || !clothing) return null;

  const meshes = getAllSkinnedMeshes(model);
  if (meshes.length === 0) return null;

  const geometry = buildRemappedGeometry(model);
  if (geometry.attributes.position.count === 0) return null;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: getTexture(clothing.texturePath),
    transparent: true,
    alphaTest: 0.05,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.FrontSide,
  });
  material.toneMapped = false;

  const overlay = new THREE.SkinnedMesh(geometry, material);
  overlay.name = 'avatar_shirt_overlay';
  overlay.castShadow = true;
  overlay.receiveShadow = true;
  overlay.frustumCulled = false;
  overlay.renderOrder = 2;
  overlay.userData.isClothingOverlay = true;
  bindOverlayLikeSource(overlay, meshes[0]);

  meshes[0].parent?.add(overlay);
  overlayCache.set(model, overlay);
  return overlay;
}

function removeAvatarPants(model) {
  const overlay = pantsCache.get(model);
  if (!overlay) return;
  overlay.removeFromParent();
  overlay.geometry?.dispose?.();
  const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material];
  for (const material of materials) material?.dispose?.();
  pantsCache.delete(model);
}

function analyzeLegTriangles(meshes) {
  const partBounds = { leftLeg: createEmptyBounds(), rightLeg: createEmptyBounds() };
  const triangles = [];

  for (const mesh of meshes) {
    const positions = mesh.geometry.attributes.position;
    for (const [i0, i1, i2] of iterateTriangleIndices(mesh)) {
      const p0 = getDominantPart(mesh, i0);
      const p1 = getDominantPart(mesh, i1);
      const p2 = getDominantPart(mesh, i2);

      let part = null;
      if (p0 && p0 === p1 && p0 === p2) part = p0;
      else if (p0 && p0 === p1) part = p0;
      else if (p1 && p1 === p2) part = p1;
      else if (p0 && p0 === p2) part = p0;
      else if (p0) part = p0;
      else if (p1) part = p1;
      else if (p2) part = p2;

      if (!part || !partBounds[part]) continue;

      triangles.push({ mesh, i0, i1, i2, part });
      expandBounds(partBounds[part], positions, i0);
      expandBounds(partBounds[part], positions, i1);
      expandBounds(partBounds[part], positions, i2);
    }
  }

  return { triangles, partBounds };
}

function buildRemappedGeometryPants(model) {
  if (pantsRemappedCache.has(model)) {
    return pantsRemappedCache.get(model).clone();
  }

  const meshes = getAllSkinnedMeshes(model);
  const { triangles, partBounds } = analyzeLegTriangles(meshes);
  const legToArm = { leftLeg: 'leftArm', rightLeg: 'rightArm' };
  const geometry = buildRemappedGeometryFromTriangles(triangles, partBounds, part => legToArm[part]);

  pantsRemappedCache.set(model, geometry.clone());
  return geometry;
}

function applyAvatarPants(model, clothingId) {
  removeAvatarPants(model);

  const clothing = findClothing(clothingId);
  if (!model || !clothing) return null;

  const meshes = getAllSkinnedMeshes(model);
  if (meshes.length === 0) return null;

  const geometry = buildRemappedGeometryPants(model);
  if (geometry.attributes.position.count === 0) return null;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: getTexture(clothing.texturePath),
    transparent: true,
    alphaTest: 0.05,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.FrontSide,
  });
  material.toneMapped = false;

  const overlay = new THREE.SkinnedMesh(geometry, material);
  overlay.name = 'avatar_pants_overlay';
  overlay.castShadow = true;
  overlay.receiveShadow = true;
  overlay.frustumCulled = false;
  overlay.renderOrder = 2;
  overlay.userData.isClothingOverlay = true;
  bindOverlayLikeSource(overlay, meshes[0]);

  meshes[0].parent?.add(overlay);
  pantsCache.set(model, overlay);
  return overlay;
}

function preloadTexture(path) {
  if (!textureCache.has(path)) {
    getTexture(path);
  }
  const tex = textureCache.get(path);
  if (tex.image && tex.image.complete) return Promise.resolve(tex);
  return new Promise(resolve => {
    const check = () => {
      if (tex.image && tex.image.complete) return resolve(tex);
      requestAnimationFrame(check);
    };
    check();
  });
}

export {
  applyAvatarClothing,
  removeAvatarClothing,
  applyAvatarPants,
  removeAvatarPants,
  preloadTexture,
};