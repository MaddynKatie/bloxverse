import * as THREE from 'three';

import { findClothing } from './clothing.js';

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const overlayCache = new WeakMap();
const remappedGeometryCache = new WeakMap();

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

function getBaseSkinnedMesh(model) {
  let found = null;
  model?.traverse(child => {
    if (!found && child.isSkinnedMesh) {
      found = child;
    }
  });
  return found;
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

function analyzeTriangles(mesh) {
  const positions = mesh.geometry.attributes.position;
  const partBounds = {
    torso: createEmptyBounds(),
    leftArm: createEmptyBounds(),
    rightArm: createEmptyBounds(),
  };
  const triangles = [];

  for (let i = 0; i < positions.count; i += 3) {
    const p0 = getDominantPart(mesh, i);
    const p1 = getDominantPart(mesh, i + 1);
    const p2 = getDominantPart(mesh, i + 2);
    let part = null;
    if (p0 && p0 === p1 && p0 === p2) part = p0;
    else if (p0 && p0 === p1) part = p0;
    else if (p1 && p1 === p2) part = p1;
    else if (p0 && p0 === p2) part = p0;
    else if (p0) part = p0;
    else if (p1) part = p1;
    else if (p2) part = p2;

    if (!part) continue;

    triangles.push({ start: i, part });
    expandBounds(partBounds[part], positions, i);
    expandBounds(partBounds[part], positions, i + 1);
    expandBounds(partBounds[part], positions, i + 2);
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

function buildRemappedGeometry(mesh) {
  if (remappedGeometryCache.has(mesh.geometry)) {
    return remappedGeometryCache.get(mesh.geometry).clone();
  }

  const source = mesh.geometry;
  const positions = source.attributes.position;
  const normals = source.attributes.normal;
  const skinIndex = source.attributes.skinIndex;
  const skinWeight = source.attributes.skinWeight;
  const { triangles, partBounds } = analyzeTriangles(mesh);

  const remappedPositions = [];
  const remappedNormals = [];
  const remappedSkinIndices = [];
  const remappedSkinWeights = [];
  const remappedUvs = [];

  for (const triangle of triangles) {
    const bounds = partBounds[triangle.part];
    const faceRects = TEMPLATE_RECTS[triangle.part];
    const i = triangle.start;
    const p0 = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
    const p1 = new THREE.Vector3(positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1));
    const p2 = new THREE.Vector3(positions.getX(i + 2), positions.getY(i + 2), positions.getZ(i + 2));

    const edge1 = new THREE.Vector3().subVectors(p1, p0);
    const edge2 = new THREE.Vector3().subVectors(p2, p0);
    const faceNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    
    const face = detectFace(faceNormal.x, faceNormal.y, faceNormal.z);
    const rect = faceRects[face];
    if (!rect) continue;

    const verts = [p0, p1, p2];
    for (let j = 0; j < 3; j++) {
      const sourceIndex = i + j;
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

  remappedGeometryCache.set(mesh.geometry, geometry.clone());
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

function applyAvatarClothing(model, clothingId) {
  removeAvatarClothing(model);

  const clothing = findClothing(clothingId);
  if (!model || !clothing) return null;

  const baseMesh = getBaseSkinnedMesh(model);
  if (!baseMesh) return null;

  const geometry = buildRemappedGeometry(baseMesh);
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
  overlay.name = `${baseMesh.name || 'avatar'}_shirt_overlay`;
  overlay.castShadow = true;
  overlay.receiveShadow = true;
  overlay.frustumCulled = false;
  overlay.renderOrder = 2;
  overlay.userData.isClothingOverlay = true;
  overlay.position.copy(baseMesh.position);
  overlay.quaternion.copy(baseMesh.quaternion);
  overlay.scale.copy(baseMesh.scale);
  overlay.bindMode = baseMesh.bindMode;
  overlay.bind(baseMesh.skeleton, baseMesh.bindMatrix.clone());
  overlay.bindMatrixInverse.copy(baseMesh.bindMatrixInverse);

  baseMesh.parent?.add(overlay);
  overlayCache.set(model, overlay);
  return overlay;
}

export {
  applyAvatarClothing,
  removeAvatarClothing,
};