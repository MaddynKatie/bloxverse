import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as CANNON from 'cannon-es';
const playerModelUrl = new URL('../assets/models/player.fbx', import.meta.url).href;
const studTextureUrl = new URL('../assets/textures/stud.jpeg', import.meta.url).href;
import { findAccessory } from './accessories.js';
import { findFace } from './faces.js';
import { applyAvatarClothing, removeAvatarClothing } from './avatar-clothing.js';
import { findEmote } from './emotes.js';
import { Instance } from './instances.js';

// ─── Constants ───────────────────────────────────────────────
const STUDS_PER_TILE = 4;
const G_LEVEL = 0; // world ground Y (top of baseplate)
const DEG2RAD = Math.PI / 180;

let WALK_SPEED         = 16;
const JUMP_POWER       = 50;
const GRAVITY          = -196.2;
const ROT_SPEED        = 14;
const STEP_HEIGHT      = 1.1;
const STEP_CLIMB_SPEED = 16;
const COYOTE_TIME      = 0.12;
const JUMP_BUFFER_T    = 0.15;
const CAM_KEY_ZOOM_SPEED = 32;
const CAM_PIVOT_Y        = 2.56;
const SHIFT_LOCK_OFFSET  = 1.75;
const FIRST_PERSON_RANGE = 3.0;

const CLIMB_RISE_SPEED  = 11.2;
const CLIMB_REACH       = 0.1;
const CLIMB_FALL_CUTOFF = -200;
const CLIMB_MAX_PART_H  = 1.5;
const CLIMB_WINDOW      = 2.2;
const CLIMB_JUMP_UP     = 38;
const CLIMB_JUMP_BACK_V = 14;
const HANG_DEPTH        = 1.2;

let currentUserId = null;
const CHUNK_SIZE = 4;
const PUSH_SCALE = 8;
let _skipPhysicsSyncUntil = 0;
const PHYSICS_OWNER_LEASE_MS = 900;
const PHYSICS_OWNER_SEND_EXTEND_MS = 700;
const PHYSICS_OWNER_CLAIM_SUFFIX = Math.floor(Math.random() * 1000);
let _worldFloorEnabled = true;
let _respawnY = -100;
let _dead = false;
let _respawnTimer = 0;
const _respawnCallbacks = [];
const _deathCallbacks = [];

// ─── Graphics Auto-Adjust ─────────────────────────────────────────────
let _graphicsAuto = true;
let _graphicsLevel = 5;
const _fpsHistory = [];
const _fpsWindow = 30;
let _autoAdjustCooldown = 0;
let _qualityChangeCallback = null;

// ─── Chat Bubble Config ────────────────────────────────────────────────
const BUBBLE_WORLD_W  = 4.0;
const BUBBLE_CANVAS_W = 500;
const BUBBLE_SCALE    = BUBBLE_WORLD_W / BUBBLE_CANVAS_W;
const BUBBLE_DURATION = 15000;
const MAX_BUBBLES     = 3;

const B_PAD  = 24;
const B_R    = 16;
const B_FONT = '38px system-ui,sans-serif';
const B_LINE = 48;
const B_TRI  = 14;
const B_GAP  = 8;

const _bubbles = new Map();
const _measureCtx = document.createElement('canvas').getContext('2d');
_measureCtx.font = B_FONT;

function resolvePartColor(colorValue) {
    if (Array.isArray(colorValue)) {
        const [r = 0.5, g = 0.5, b = 0.5] = colorValue;
        const scale = (r <= 1 && g <= 1 && b <= 1) ? 255 : 1;
        return ((Math.round(r * scale) & 255) << 16)
            | ((Math.round(g * scale) & 255) << 8)
            | (Math.round(b * scale) & 255);
    }
    if (typeof colorValue === 'string') {
        const parsed = Number.parseInt(colorValue.replace(/^#/, ''), 16);
        return Number.isFinite(parsed) ? parsed : 0x808080;
    }
    if (typeof colorValue === 'number' && Number.isFinite(colorValue)) {
        return colorValue >>> 0;
    }
    return 0x808080;
}

function _wrapLines(ctx, text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && cur) {
            lines.push(cur);
            cur = w;
        } else {
            cur = t;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

function _redrawBubble(id) {
    const b = _bubbles.get(id);
    if (!b || !b.msgs.length) return;
    const maxWrapW = BUBBLE_CANVAS_W - B_PAD * 2;
    const msgLines = b.msgs.map(m => _wrapLines(_measureCtx, m.text, maxWrapW));
    const msgW = msgLines.map(ls =>
        Math.ceil(Math.min(
            Math.max(...ls.map(l => _measureCtx.measureText(l).width)) + B_PAD * 2,
            BUBBLE_CANVAS_W
        ))
    );
    const CW = Math.max(...msgW);
    const msgBodyH = msgLines.map(ls => ls.length * B_LINE + B_PAD * 2);
    const totalH   = msgBodyH.reduce((a,h)=>a+h,0) + B_GAP*(b.msgs.length-1) + B_TRI;
    const canvas = document.createElement('canvas');
    canvas.width = CW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');
    ctx.font = B_FONT;
    let y = 0;
    for (let i = 0; i < b.msgs.length; i++) {
        const isBottom = i === b.msgs.length - 1;
        const bodyH = msgBodyH[i];
        const lines = msgLines[i];
        const bw    = msgW[i];
        const bx    = (CW - bw) / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.moveTo(bx + B_R, y);
        ctx.lineTo(bx + bw - B_R, y);
        ctx.arcTo(bx + bw, y, bx + bw, y + B_R, B_R);
        ctx.lineTo(bx + bw, y + bodyH - B_R);
        ctx.arcTo(bx + bw, y + bodyH, bx + bw - B_R, y + bodyH, B_R);
        if (isBottom) {
            ctx.lineTo(CW/2 + B_TRI, y + bodyH);
            ctx.lineTo(CW/2,         y + bodyH + B_TRI);
            ctx.lineTo(CW/2 - B_TRI, y + bodyH);
        }
        ctx.lineTo(bx + B_R, y + bodyH);
        ctx.arcTo(bx, y + bodyH, bx, y + bodyH - B_R, B_R);
        ctx.lineTo(bx, y + B_R);
        ctx.arcTo(bx, y, bx + B_R, y, B_R);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let j = 0; j < lines.length; j++) {
            ctx.fillText(lines[j], CW/2, y + B_PAD + j*B_LINE);
        }
        y += bodyH + (isBottom ? B_TRI : B_GAP);
    }
    if (!b.sprite) {
        b.sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ transparent: true, depthTest: false })
        );
        scene.add(b.sprite);
    }
    b.sprite.material.map?.dispose();
    const bubbleTexture = new THREE.CanvasTexture(canvas);
    bubbleTexture.needsUpdate = true;
    b.sprite.material.map = bubbleTexture;
    b.sprite.material.needsUpdate = true;
    b.sprite.scale.set(CW * BUBBLE_SCALE, totalH * BUBBLE_SCALE, 1);
    b.sprite.visible = true;
}

function _showBubble(id, text) {
    let b = _bubbles.get(id);
    if (!b) {
        b = { msgs: [], sprite: null };
        _bubbles.set(id, b);
    }
    if (b.msgs.length >= MAX_BUBBLES) {
        clearTimeout(b.msgs.shift().timer);
    }
    const entry = { text, timer: null };
    b.msgs.push(entry);
    _redrawBubble(id);
    entry.timer = setTimeout(() => {
        const i = b.msgs.indexOf(entry);
        if (i !== -1) b.msgs.splice(i, 1);
        if (!b.msgs.length) {
            if (b.sprite) b.sprite.visible = false;
            _bubbles.delete(id);
        } else {
            _redrawBubble(id);
        }
    }, BUBBLE_DURATION);
}

function _updateBubblePositions() {
    if (!window._bloxverse) return;
    const base = window._bloxverse.getCharBubbleBase();
    for (const [id, b] of _bubbles) {
        if (!b.sprite || !b.msgs.length) continue;
        let pos;
        // Check if this is the local player by comparing with currentUserId
        if (id === currentUserId) {
            if (!character) continue;
            pos = character.position;
        } else {
            const p = otherPlayers.get(id);
            if (!p || !p.mesh) continue;
            pos = p.mesh.position;
        }
        b.sprite.position.set(
            pos.x,
            pos.y + base + b.sprite.scale.y / 2,
            pos.z
        );
    }
}

// ─── Username Labels Config ────────────────────────────────────────────────
const USERNAME_FONT = 'bold 48px system-ui,sans-serif';
const USERNAME_OFFSET_Y = -0.8; // Height above head (negative moves down)

const _playerNames = new Map(); // userId -> { username, sprite }
const _playerHealthBars = new Map(); // userId -> { sprite, canvas, ctx }
const _playerStreaks = new Map(); // userId -> { streak, sprite }

function _createNameSprite(username, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = USERNAME_FONT;
    
    // Measure text
    const metrics = ctx.measureText(username);
    const textWidth = metrics.width;
    const textHeight = 64;
    const padding = 8;
    
    canvas.width = textWidth + padding * 2;
    canvas.height = textHeight + padding * 2;
    
    // Draw text with stroke for outline (no background)
    ctx.font = USERNAME_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Draw black outline/stroke
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 4;
    ctx.strokeText(username, canvas.width / 2, canvas.height / 2);
    
    // Draw text on top (default white, or team color)
    ctx.fillStyle = color || '#ffffff';
    ctx.fillText(username, canvas.width / 2, canvas.height / 2);
    
    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.needsUpdate = true;
    const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ 
            map: labelTexture,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            alphaTest: 0.25,
            sizeAttenuation: true
        })
    );
    const scale = 0.008;
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
    scene.add(sprite);
    
    return sprite;
}

function _createStreakSprite(streak) {
    const text = `🔥 ${streak}`;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 42px system-ui,sans-serif';
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = 54;
    const padding = 8;
    canvas.width = textWidth + padding * 2;
    canvas.height = textHeight + padding * 2;
    ctx.font = 'bold 42px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // No background — draw outlined text for readability
    ctx.lineWidth = Math.max(3, Math.floor(canvas.width * 0.02));
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.fillStyle = '#ff6a00';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2 - 4);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 4);
    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.needsUpdate = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        alphaTest: 0.25,
        sizeAttenuation: true
    }));
    const scale = 0.008;
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
    scene.add(sprite);
    return sprite;
}

function _updateStreakSprite(sprite, streak) {
    if (!sprite) return;
    const text = `🔥 ${streak}`;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 42px system-ui,sans-serif';
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = 54;
    const padding = 8;
    canvas.width = textWidth + padding * 2;
    canvas.height = textHeight + padding * 2;
    ctx.font = 'bold 42px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, Math.floor(canvas.width * 0.02));
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.fillStyle = '#ff6a00';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2 - 4);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 4);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    sprite.material.map.dispose();
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
    const scale = 0.008;
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
}

function _createHealthBarSprite() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 240;
    canvas.height = 12;
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            alphaTest: 0.1,
            sizeAttenuation: true
        })
    );
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(2, 2 / aspect, 1);
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, canvas, ctx };
}

function _drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function _updateHealthBarSprite(bar, health, maxHealth) {
    if (!bar) return;
    const { ctx, canvas, sprite } = bar;
    const ratio = Math.max(0, Math.min(1, health / maxHealth));
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background like the UI bar (semi-transparent dark)
    _drawRoundedRect(ctx, 0, 0, canvas.width, canvas.height, 6);
    ctx.fillStyle = 'rgba(10, 16, 30, 0.5)';
    ctx.fill();

    // Fill with same green-to-red as the UI bar
    const r = ratio > 0.5 ? Math.floor(255 * (1 - (ratio - 0.5) * 2)) : 255;
    const g = ratio > 0.5 ? 255 : Math.floor(255 * (ratio * 2));
    ctx.fillStyle = `rgb(${r},${g},0)`;
    const fillW = Math.max(2, (canvas.width - 2) * ratio);
    _drawRoundedRect(ctx, 1, 1, fillW, canvas.height - 2, 5);
    ctx.fill();

    sprite.material.map.needsUpdate = true;
    sprite.visible = health < maxHealth;
}

function _updateNameLabelPositions() {
    if (!character) return;
    const userIds = new Set([..._playerNames.keys(), ..._playerHealthBars.keys(), ..._playerStreaks.keys()]);
    
    for (const userId of userIds) {
        let avatarObj = null;
        
        if (userId === currentUserId && character) {
            avatarObj = character;
        } else {
            const p = otherPlayers.get(userId);
            if (p && p.mesh) {
                avatarObj = p.mesh;
            }
        }
        
        if (!avatarObj) continue;

        const headTop = _getHeadTopWorldPosition(avatarObj, userId);
        if (!headTop) continue;

        const nameY = headTop.y + 0.5;
        const streakY = nameY + 0.45;
        const healthY = headTop.y + 0.1;

        const nameData = _playerNames.get(userId);
        if (nameData && nameData.sprite) {
            nameData.sprite.position.set(headTop.x, nameY, headTop.z);
        }

        const streakData = _playerStreaks.get(userId);
        if (streakData && streakData.sprite) {
            streakData.sprite.position.set(headTop.x, streakY, headTop.z);
        }

        const bar = _playerHealthBars.get(userId);
        if (bar && bar.sprite && bar.sprite.visible) {
            bar.sprite.position.set(headTop.x, healthY, headTop.z);
        }
    }
}

// ─── Scene ───────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87CEEB, 192, 480);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x87CEEB);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Lights ──────────────────────────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(160, 320, 160);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 960;
sun.shadow.camera.left = -192;
sun.shadow.camera.right = 192;
sun.shadow.camera.top = 192;
sun.shadow.camera.bottom = -192;
sun.shadow.autoUpdate = true;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

_applyGraphicsLevel();

// ─── Physics World ───────────────────────────────────────────────────────────
const physicsWorld = new CANNON.World();
physicsWorld.gravity.set(0, GRAVITY, 0);
physicsWorld.defaultContactMaterial.friction = 0.4;

// Patch solver to use body._bounciness for restitution (bypasses broken material system)
const origAddEq = physicsWorld.solver.addEquation.bind(physicsWorld.solver);
physicsWorld.solver.addEquation = function(eq) {
    if (eq.restitution !== undefined && eq.bi && eq.bj) {
        const br = eq.bi._bounciness;
        eq.restitution = typeof br === 'number' ? br : eq.restitution;
        const br2 = eq.bj._bounciness;
        eq.restitution = typeof br2 === 'number' ? br2 : eq.restitution;
    }
    return origAddEq(eq);
};

// Track physics bodies synced with mesh
const physicsBodies = new Map(); // mesh -> { body, anchored, mesh }

function markLocalPhysicsOwner(mesh, durationMs = PHYSICS_OWNER_LEASE_MS) {
    if (!mesh || !currentUserId) return;
    mesh.userData.physicsOwnerId = currentUserId;
    mesh.userData.physicsOwnerUntil = performance.now() + durationMs;
    mesh.userData.physicsOwnerClaimId = Date.now() * 1000 + PHYSICS_OWNER_CLAIM_SUFFIX;
}

function hasActivePhysicsOwner(mesh, ownerId = mesh?.userData?.physicsOwnerId) {
    return !!mesh && !!ownerId && performance.now() < (mesh.userData.physicsOwnerUntil || 0);
}

function isLocalPhysicsOwner(mesh) {
    return !!currentUserId && mesh?.userData?.physicsOwnerId === currentUserId && hasActivePhysicsOwner(mesh, currentUserId);
}

function shouldKeepLocalPhysicsOwner(mesh, remoteClaimId) {
    if (!isLocalPhysicsOwner(mesh)) return false;
    const localClaimId = mesh.userData.physicsOwnerClaimId || 0;
    return !remoteClaimId || localClaimId >= remoteClaimId;
}

// ─── Geometry / Material caches ──────────────────────────────────────────────
const geoCache = new Map();
const matCache = new Map();

// Load stud texture once, repeat per face to avoid reloading.
// Each call to studTex() creates a fresh Texture with its own Source
// so Three.js allocates GPU memory correctly (texture.clone() has a
// shared-source bug with the texStorage2D path).
let _studTexImage = null;
let _studTexReady = false;

fetch(studTextureUrl)
    .then(r => r.blob())
    .then(blob => createImageBitmap(blob))
    .then(bitmap => {
        _studTexImage = bitmap;
        _studTexReady = true;
        // Wipe matCache so getCachedMats calls create fresh materials
        matCache.clear();

        // Refresh every existing block mesh that was created with map: null
        // because studTex() wasn't ready yet at construction time.
        const oldMats = new Set();
        scene.traverse(child => {
            if (!child.isMesh) return;
            const halfSize = child.userData.halfSize;
            if (!halfSize) return;
            const { sw, sh, sd } = halfSize;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            const color = mats[0]?.color?.getHex();
            if (color == null) return;
            child.material = getCachedMats(sw, sh, sd, color);
            applyMeshTransparency(child, child.userData.transparency || 0);
            for (const m of mats) { if (m) oldMats.add(m); }
        });
        for (const m of oldMats) m.dispose();
    })
    .catch(err => console.error('stud texture load failed:', err));

function studTex(rx, ry) {
    if (!_studTexReady) return null;
    const t = new THREE.Texture(_studTexImage);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
}

function getCachedGeo(sw, sh, sd) {
    const key = `${sw},${sh},${sd}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(sw, sh, sd));
    return geoCache.get(key);
}

function getCachedSphereGeo(radius) {
    const key = `sphere:${radius}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.SphereGeometry(radius, 24, 24));
    return geoCache.get(key);
}

function getCachedMats(sw, sh, sd, color) {
    const key = `${sw},${sh},${sd},${color}`;
    if (matCache.has(key)) return matCache.get(key);
    const t = (v) => Math.max(1, v / STUDS_PER_TILE);
    const m = (rx, ry) => new THREE.MeshStandardMaterial({
        color,
        map: studTex(rx, ry),
        roughness: 0.85,
        metalness: 0.0,
    });
    const mats = [
        m(t(sd), t(sh)), // right
        m(t(sd), t(sh)), // left
        m(t(sw), t(sd)), // top
        m(t(sw), t(sd)), // bottom
        m(t(sw), t(sh)), // front
        m(t(sw), t(sh)), // back
    ];
    matCache.set(key, mats);
    return mats;
}

function getSphereMat(color) {
    const key = `sphere:${color}`;
    if (matCache.has(key)) return matCache.get(key);
    const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.1,
    });
    matCache.set(key, mat);
    return mat;
}

function cloneMeshMaterials(mesh) {
    if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(mat => mat?.clone?.() || mat);
    } else if (mesh.material?.clone) {
        mesh.material = mesh.material.clone();
    }
}

function applyMeshTransparency(mesh, transparency) {
    const t = Math.max(0, Math.min(1, Number(transparency) || 0));
    const opacity = 1 - t;
    mesh.userData.transparency = t;

    // Cached stud materials are shared by size/color. Clone before changing
    // opacity so one invisible trigger does not hide later visible parts.
    if (opacity < 1) cloneMeshMaterials(mesh);

    mesh.renderOrder = opacity < 1 ? 1 : 0;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
        if (!mat) continue;
        const transparent = opacity < 1;
        mat.transparent = transparent;
        mat.depthWrite = !transparent;
        mat.opacity = opacity;
        mat.needsUpdate = true;
    }
}

// ─── Collision spatial grid ───────────────────────────────────────────────────
const colliders = [];
const chunkMap  = new Map();

function chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }
function worldToChunk(x) { return Math.floor(x / CHUNK_SIZE); }

function insertToChunks(b) {
    const x0 = worldToChunk(b.minX), x1 = worldToChunk(b.maxX);
    const y0 = worldToChunk(b.minY), y1 = worldToChunk(b.maxY);
    const z0 = worldToChunk(b.minZ), z1 = worldToChunk(b.maxZ);
    for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++)
            for (let cz = z0; cz <= z1; cz++) {
                const key = chunkKey(cx, cy, cz);
                if (!chunkMap.has(key)) chunkMap.set(key, new Set());
                chunkMap.get(key).add(b);
            }
}

const _nearbySet = new Set();
function getNearbyColliders(px, py, pz) {
    _nearbySet.clear();
    const cx = worldToChunk(px), cy = worldToChunk(py), cz = worldToChunk(pz);
    for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
                const bucket = chunkMap.get(chunkKey(cx + dx, cy + dy, cz + dz));
                if (bucket) bucket.forEach(b => _nearbySet.add(b));
            }
    
    // Add dynamic physics body colliders
    physicsBodies.forEach(({ body, anchored, mesh }) => {
        if (!anchored && body && body._obb && mesh.userData.canCollide !== false) {
            // Check if dynamic body is within search radius
            const dx = Math.abs(body._obb.cx - px);
            const dy = Math.abs(body._obb.cy - py);
            const dz = Math.abs(body._obb.cz - pz);
            const ex = body._obb.maxX - body._obb.cx;
            const ey = body._obb.maxY - body._obb.cy;
            const ez = body._obb.maxZ - body._obb.cz;
            
            // Simple AABB proximity check
            if (dx < ex + CHAR_HALF_W + 16 && dy < ey + CHAR_HEIGHT + 16 && dz < ez + CHAR_HALF_D + 16) {
                _nearbySet.add(body._obb);
            }
        }
    });
    
    return _nearbySet;
}

// ─── OBB helpers ─────────────────────────────────────────────────────────────
function buildOBB(sw, sh, sd, cx, cy, cz, rx, ry, rz) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    const e = m.elements;
    const ux = e[0], uy = e[1], uz = e[2];
    const vx = e[4], vy = e[5], vz = e[6];
    const wx = e[8], wy = e[9], wz = e[10];
    const hx = sw/2, hy = sh/2, hz = sd/2;
    const ex = hx*Math.abs(ux)+hy*Math.abs(vx)+hz*Math.abs(wx);
    const ey = hx*Math.abs(uy)+hy*Math.abs(vy)+hz*Math.abs(wy);
    const ez = hx*Math.abs(uz)+hy*Math.abs(vz)+hz*Math.abs(wz);
    return { isOBB:true, cx,cy,cz, hx,hy,hz, ux,uy,uz, vx,vy,vz, wx,wy,wz,
        minX:cx-ex, maxX:cx+ex, minY:cy-ey, maxY:cy+ey, minZ:cz-ez, maxZ:cz+ez };
}

// ─── Ray-vs-collider helpers (for camera collision) ──────────────────────────
function rayVsAABB(origin, dir, aabb) {
    const invDx = 1 / dir.x, invDy = 1 / dir.y, invDz = 1 / dir.z;
    let t1 = (aabb.minX - origin.x) * invDx;
    let t2 = (aabb.maxX - origin.x) * invDx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    let tmin = t1, tmax = t2;
    t1 = (aabb.minY - origin.y) * invDy;
    t2 = (aabb.maxY - origin.y) * invDy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
    t1 = (aabb.minZ - origin.z) * invDz;
    t2 = (aabb.maxZ - origin.z) * invDz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
    const t = tmin >= 0 ? tmin : tmax;
    if (t <= 0 || !isFinite(t)) return null;
    return t;
}

function rayVsOBB(origin, dir, obb) {
    const dx = dir.x * obb.ux + dir.y * obb.uy + dir.z * obb.uz;
    const dy = dir.x * obb.vx + dir.y * obb.vy + dir.z * obb.vz;
    const dz = dir.x * obb.wx + dir.y * obb.wy + dir.z * obb.wz;
    const ox = (origin.x - obb.cx) * obb.ux + (origin.y - obb.cy) * obb.uy + (origin.z - obb.cz) * obb.uz;
    const oy = (origin.x - obb.cx) * obb.vx + (origin.y - obb.cy) * obb.vy + (origin.z - obb.cz) * obb.vz;
    const oz = (origin.x - obb.cx) * obb.wx + (origin.y - obb.cy) * obb.wy + (origin.z - obb.cz) * obb.wz;
    let tmin = -Infinity, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
        const d = i === 0 ? dx : (i === 1 ? dy : dz);
        const o = i === 0 ? ox : (i === 1 ? oy : oz);
        const h = i === 0 ? obb.hx : (i === 1 ? obb.hy : obb.hz);
        if (Math.abs(d) < 1e-10) {
            if (o < -h || o > h) return null;
            continue;
        }
        let t1 = (-h - o) / d;
        let t2 = (h - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
    }
    const t = tmin >= 0 ? tmin : tmax;
    if (t <= 0 || !isFinite(t)) return null;
    return t;
}

const _rayCache = new Set();
function getCollidersAlongRay(x1, y1, z1, x2, y2, z2) {
    _rayCache.clear();
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
    const cx0 = worldToChunk(minX) - 1, cx1 = worldToChunk(maxX) + 1;
    const cy0 = worldToChunk(minY) - 1, cy1 = worldToChunk(maxY) + 1;
    const cz0 = worldToChunk(minZ) - 1, cz1 = worldToChunk(maxZ) + 1;
    for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++)
            for (let cz = cz0; cz <= cz1; cz++) {
                const bucket = chunkMap.get(chunkKey(cx, cy, cz));
                if (bucket) bucket.forEach(b => {
                    if (b._meshRef && (b._meshRef.userData.transparency || 0) >= 0.25) return;
                    _rayCache.add(b);
                });
            }
    for (const { body, anchored, mesh } of physicsBodies.values()) {
        if (!anchored && body && body._obb && mesh.userData.canCollide !== false && (mesh.userData.transparency || 0) < 0.25) {
            const dx = body._obb.minX > maxX || body._obb.maxX < minX;
            const dy = body._obb.minY > maxY || body._obb.maxY < minY;
            const dz = body._obb.minZ > maxZ || body._obb.maxZ < minZ;
            if (dx || dy || dz) continue;
            _rayCache.add(body._obb);
        }
    }
    return _rayCache;
}

// ─── Map mode ────────────────────────────────────────────────────────────────
const _urlParams = new URLSearchParams(window.location.search);
const _gameMode = _urlParams.get('game') || 'demo';

// ─── Mass helpers ─────────────────────────────────────────────────────────────
const ROBLOX_DENSITY = 0.6;

function computeMass(sw, sh, sd, shape) {
    let volume;
    if (shape === 'Ball') {
        const r = Math.max(sw, sh, sd) / 2;
        volume = (4 / 3) * Math.PI * r * r * r;
    } else {
        volume = sw * sh * sd;
    }
    return volume * ROBLOX_DENSITY;
}

// ─── World builder ───────────────────────────────────────────────────────────
function addStud(sw, sh, sd, color, x, y, z, rx = 0, ry = 0, rz = 0, anchored = true, shape = 'Block', bodyMass, canCollide = true) {
    if (bodyMass == null) bodyMass = computeMass(sw, sh, sd, shape);
    let mesh;
    if (shape === 'Ball') {
        const radius = Math.max(sw, sh, sd) / 2;
        mesh = new THREE.Mesh(getCachedSphereGeo(radius), getSphereMat(color));
    } else {
        mesh = new THREE.Mesh(getCachedGeo(sw, sh, sd), getCachedMats(sw, sh, sd, color));
    }
    const cy = y + sh / 2;
    mesh.position.set(x, cy, z);
    if (rx !== 0 || ry !== 0 || rz !== 0) mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    mesh.userData.halfSize = { sw, sh, sd };
    mesh.userData.canCollide = canCollide;

    // Create physics body
    let cannonShape;
    if (shape === 'Ball') {
        const radius = Math.max(sw, sh, sd) / 2;
        cannonShape = new CANNON.Sphere(radius);
    } else {
        cannonShape = new CANNON.Box(new CANNON.Vec3(sw / 2, sh / 2, sd / 2));
    }
    const cannonMass = anchored ? 0 : bodyMass;
    const body = new CANNON.Body({ mass: cannonMass, shape: cannonShape });
    body.position.set(x, cy, z);
    
    if (rx !== 0 || ry !== 0 || rz !== 0) {
        const quat = new CANNON.Quaternion();
        quat.setFromEuler(rx, ry, rz);
        body.quaternion = quat;
    }
    
    if (canCollide) {
        physicsWorld.addBody(body);
    }
    physicsBodies.set(mesh, { body, anchored, mesh });

    mesh.userData.initialPos = new THREE.Vector3(x, cy, z);
    mesh.userData.initialQuat = new THREE.Quaternion();
    if (rx !== 0 || ry !== 0 || rz !== 0) {
        mesh.userData.initialQuat.setFromEuler(new THREE.Euler(rx, ry, rz));
    }

    if (anchored && canCollide) {
        let b;
        if (rx === 0 && ry === 0 && rz === 0) {
            b = { minX: x-sw/2, maxX: x+sw/2, minY: y, maxY: y+sh, minZ: z-sd/2, maxZ: z+sd/2 };
        } else {
            b = buildOBB(sw, sh, sd, x, cy, z, rx, ry, rz);
        }
        b._meshRef = mesh;
        colliders.push(b);
        insertToChunks(b);
    }
    return mesh;
}

// Baseplate (top surface at y=0)
addStud(320, 3.2, 320, 0x4db84b, 0, -3.2, 0);

// ─── Character / Physics state ───────────────────────────────────────────────
let CHAR_STAND_Y   = 3.68;  // updated after model loads
let CHAR_FOOT_OFFSET = 2.08;
let CHAR_HEIGHT      = 5;
let CHAR_HALF_W      = 1;
let CHAR_HALF_D      = 0.5;

let velY       = 0;
let grounded   = true;
let stepUpTarget = -Infinity;
const pushedBlocks = new Set();
let shiftLock  = false;
let locked     = false;
let coyoteTimer = 0;
let jumpBuffer  = 0;

let climbState    = 'none';
let climbLedgeY   = 0;
let climbFwdX     = 0, climbFwdZ = 0;
let climbBlock    = null;
let climbCooldown = 0;

let extraVelX = 0, extraVelZ = 0;
let _charMoving = false;

// ─── Camera state ─────────────────────────────────────────────────────────────
const cam = { yaw: 0, pitch: 0.35, distance: 25.6, targetDistance: 25.6,
    minPitch: -0.5, maxPitch: 1.35, minDist: 0.5, maxDist: 128 };
let _firstPerson = false;
let _firstPersonBlend = 0;
const FP_BLEND_SPEED = 8;

let CAM_H_SENS = 0.002 * Math.PI;
let CAM_V_SENS = 0.0015 * Math.PI;

// ─── Debug visuals ────────────────────────────────────────────────────────────
let debugMode = false;
const debugMeshes = [];
let charDebugMesh = null;
let chunkZoneMesh = null;

function makeWireBox(minX, minY, minZ, maxX, maxY, maxZ, color) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(maxX-minX, maxY-minY, maxZ-minZ));
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const m = new THREE.LineSegments(geo, mat);
    m.position.set((minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2);
    m.renderOrder = 999;
    return m;
}

function makeWireOBB(b, color) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.hx*2, b.hy*2, b.hz*2));
    const mat = new THREE.LineBasicMaterial({ color: color || 0xff8800, depthTest: false });
    const m = new THREE.LineSegments(geo, mat);
    m.position.set(b.cx, b.cy, b.cz);
    const mat4 = new THREE.Matrix4();
    mat4.set(b.ux,b.vx,b.wx,0, b.uy,b.vy,b.wy,0, b.uz,b.vz,b.wz,0, 0,0,0,1);
    m.setRotationFromMatrix(mat4);
    m.renderOrder = 999;
    return m;
}

function toggleDebug() {
    debugMode = !debugMode;
    if (debugMode) {
        charDebugMesh = makeWireBox(-CHAR_HALF_W, 0, -CHAR_HALF_D, CHAR_HALF_W, CHAR_HEIGHT, CHAR_HALF_D, 0xff4444);
        scene.add(charDebugMesh);
    } else {
        debugMeshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); scene.remove(m); });
        debugMeshes.length = 0;
        if (charDebugMesh) { charDebugMesh.geometry.dispose(); charDebugMesh.material.dispose(); scene.remove(charDebugMesh); charDebugMesh = null; }
        if (chunkZoneMesh) { chunkZoneMesh.geometry.dispose(); chunkZoneMesh.material.dispose(); scene.remove(chunkZoneMesh); chunkZoneMesh = null; }
    }
}

function updateDebugMeshes() {
    if (!debugMode || !character) return;
    debugMeshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); scene.remove(m); });
    debugMeshes.length = 0;
    if (chunkZoneMesh) { chunkZoneMesh.geometry.dispose(); chunkZoneMesh.material.dispose(); scene.remove(chunkZoneMesh); chunkZoneMesh = null; }

    const nearby = getNearbyColliders(character.position.x, character.position.y, character.position.z);
    for (const b of nearby) {
        const meshRef = b._meshRef;
        const isInvisible = meshRef ? (meshRef.userData.transparency || 0) >= 1 : false;
        const color = b._meshRef === window._ragdollProxy ? 0x000000 : isInvisible ? 0xff0000 : (b.isOBB ? 0xff8800 : 0xffff00);
        const m = b.isOBB ? makeWireOBB(b, color) : makeWireBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, color);
        scene.add(m);
        debugMeshes.push(m);
    }

    const cx = worldToChunk(character.position.x), cz = worldToChunk(character.position.z);
    const zoneMinX = (cx-1)*CHUNK_SIZE, zoneMaxX = (cx+2)*CHUNK_SIZE;
    const zoneMinZ = (cz-1)*CHUNK_SIZE, zoneMaxZ = (cz+2)*CHUNK_SIZE;
    chunkZoneMesh = makeWireBox(zoneMinX, -256, zoneMinZ, zoneMaxX, 256, zoneMaxZ, 0x00ccff);
    scene.add(chunkZoneMesh);
}

// ─── Input ───────────────────────────────────────────────────────────────────
const keys = {};
let rmb = false;

let joystickVector = { x: 0, y: 0 };
let joystickActive = false;
const _pendingMobileKeys = new Set();

let mobileUIInjected = false;
let _touchUI = null;
window.addEventListener('touchstart', (e) => {
    if (mobileUIInjected) {
        if (_touchUI) {
            _touchUI.style.display = '';
            locked = true;
            overlay.style.display = 'none';
            cursorEl.style.display = 'none';
            document.body.style.cursor = 'none';
        }
        return;
    }
    mobileUIInjected = true;
    locked = true;
    overlay.style.display = 'none';
    cursorEl.style.display = 'none';
    document.body.style.cursor = 'none';
    const uiContainer = document.createElement('div');
    _touchUI = uiContainer;
    uiContainer.style.position = 'absolute';
    uiContainer.style.inset = '0';
    uiContainer.style.pointerEvents = 'none';
    uiContainer.style.zIndex = '999';
    document.body.appendChild(uiContainer);

    const joyBase = document.createElement('div');
    joyBase.style.position = 'absolute';
    joyBase.style.bottom = '40px';
    joyBase.style.left = '40px';
    joyBase.style.width = '120px';
    joyBase.style.height = '120px';
    joyBase.style.borderRadius = '50%';
    joyBase.style.background = 'rgba(255,255,255,0.2)';
    joyBase.style.border = '2px solid rgba(255,255,255,0.4)';
    joyBase.style.pointerEvents = 'auto';
    uiContainer.appendChild(joyBase);

    const joyThumb = document.createElement('div');
    joyThumb.style.position = 'absolute';
    joyThumb.style.top = '50%';
    joyThumb.style.left = '50%';
    joyThumb.style.width = '50px';
    joyThumb.style.height = '50px';
    joyThumb.style.margin = '-25px 0 0 -25px';
    joyThumb.style.borderRadius = '50%';
    joyThumb.style.background = 'rgba(255,255,255,0.6)';
    joyThumb.style.pointerEvents = 'none';
    joyBase.appendChild(joyThumb);

    let joyTouchId = null;
    let joyRect = null;
    const updateJoy = (touch) => {
        joystickActive = true;
        const centerX = joyRect.left + joyRect.width/2;
        const centerY = joyRect.top + joyRect.height/2;
        let dx = touch.clientX - centerX;
        let dy = touch.clientY - centerY;
        const maxDist = joyRect.width/2;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > maxDist) { dx = (dx/dist)*maxDist; dy = (dy/dist)*maxDist; }
        joyThumb.style.transform = `translate(${dx}px, ${dy}px)`;
        joystickVector = { x: dx/maxDist, y: dy/maxDist };
    };

    joyBase.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        joyRect = joyBase.getBoundingClientRect();
        joyTouchId = e.changedTouches[0].identifier;
        updateJoy(e.changedTouches[0]);
    }, {passive: false});

    joyBase.addEventListener('touchmove', (e) => {
        e.preventDefault(); e.stopPropagation();
        for(let i=0; i<e.changedTouches.length; i++) {
            if(e.changedTouches[i].identifier === joyTouchId) updateJoy(e.changedTouches[i]);
        }
    }, {passive: false});

    const endJoy = (e) => {
        e.preventDefault(); e.stopPropagation();
        for(let i=0; i<e.changedTouches.length; i++) {
            if(e.changedTouches[i].identifier === joyTouchId) {
                joyTouchId = null; joystickActive = false; joystickVector = {x: 0, y: 0};
                joyThumb.style.transform = 'translate(0px, 0px)';
            }
        }
    };
    joyBase.addEventListener('touchend', endJoy);
    joyBase.addEventListener('touchcancel', endJoy);

    const jumpBtn = document.createElement('div');
    jumpBtn.style.position = 'absolute';
    jumpBtn.style.bottom = '40px';
    jumpBtn.style.right = '40px';
    jumpBtn.style.width = '80px';
    jumpBtn.style.height = '80px';
    jumpBtn.style.borderRadius = '50%';
    jumpBtn.style.background = 'rgba(255,255,255,0.2)';
    jumpBtn.style.border = '2px solid rgba(255,255,255,0.4)';
    jumpBtn.style.pointerEvents = 'auto';
    jumpBtn.style.display = 'flex';
    jumpBtn.style.justifyContent = 'center';
    jumpBtn.style.alignItems = 'center';
    jumpBtn.style.color = 'rgba(255,255,255,0.6)';
    jumpBtn.style.fontSize = '32px';
    jumpBtn.innerHTML = '&#8593;';
    uiContainer.appendChild(jumpBtn);

    const triggerJump = (state) => {
        keys['Space'] = state;
        if (state) jumpBuffer = JUMP_BUFFER_T;
        jumpBtn.style.background = state ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)';
    };
    jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); triggerJump(true); });
    jumpBtn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); triggerJump(false); });
    jumpBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); e.stopPropagation(); triggerJump(false); });

    // Auto-create action buttons for registered mobile keys
    const _mobileCreatedKeys = new Set();
    const _createMobileBtn = (key, label) => {
        if (_mobileCreatedKeys.has(key)) return;
        _mobileCreatedKeys.add(key);
        const yOff = 120 + _mobileCreatedKeys.size * 80;
        const btn = document.createElement('div');
        btn.style.position = 'absolute';
        btn.style.bottom = yOff + 'px';
        btn.style.right = '40px';
        btn.style.width = '64px';
        btn.style.height = '64px';
        btn.style.borderRadius = '50%';
        btn.style.background = 'rgba(255,255,255,0.2)';
        btn.style.border = '2px solid rgba(255,255,255,0.4)';
        btn.style.pointerEvents = 'auto';
        btn.style.display = 'flex';
        btn.style.justifyContent = 'center';
        btn.style.alignItems = 'center';
        btn.style.color = 'rgba(255,255,255,0.8)';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = 'bold';
        btn.innerHTML = label;
        uiContainer.appendChild(btn);
        const trigger = (state) => { keys[key] = state; btn.style.background = state ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)'; };
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); trigger(true); });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); trigger(false); });
        btn.addEventListener('touchcancel', (e) => { e.preventDefault(); e.stopPropagation(); trigger(false); });
    };
    const skipKeys = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
    const regKeys = window._bloxverse?._getMobileKeys?.() || [];
    for (const k of regKeys) {
        if (!skipKeys.has(k)) _createMobileBtn(k, k.replace('Key', ''));
    }

    const lockBtn = document.createElement('div');
    lockBtn.style.position = 'absolute';
    lockBtn.style.bottom = '40px';
    lockBtn.style.right = '140px';
    lockBtn.style.width = '60px';
    lockBtn.style.height = '60px';
    lockBtn.style.borderRadius = '50%';
    lockBtn.style.background = 'rgba(255,255,255,0.2)';
    lockBtn.style.border = '2px solid rgba(255,255,255,0.4)';
    lockBtn.style.pointerEvents = 'auto';
    lockBtn.style.display = 'flex';
    lockBtn.style.justifyContent = 'center';
    lockBtn.style.alignItems = 'center';
    uiContainer.appendChild(lockBtn);

    const lockIcon = document.createElement('div');
    lockIcon.style.width = '24px';
    lockIcon.style.height = '24px';
    lockIcon.style.borderRadius = '50%';
    lockIcon.style.border = '3px solid rgba(255,255,255,0.6)';
    lockIcon.style.position = 'relative';
    const dot = document.createElement('div');
    dot.style.position = 'absolute';
    dot.style.inset = '4px';
    dot.style.borderRadius = '50%';
    dot.style.background = 'rgba(255,255,255,0.6)';
    lockIcon.appendChild(dot);
    lockBtn.appendChild(lockIcon);

    lockBtn.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window._bloxverse?.shiftLockEnabled === false) return;
        shiftLock = !shiftLock;
        shiftLockIndicator.classList.toggle('visible', shiftLock);
        dot.style.background = shiftLock ? '#4ade80' : 'rgba(255,255,255,0.6)';
        lockIcon.style.borderColor = shiftLock ? '#4ade80' : 'rgba(255,255,255,0.6)';
        if (!shiftLock && character) {
            cam.yaw = character.rotation.y - Math.PI;
        }
    });

    let camTouchId = null;
    let lastCamX = 0, lastCamY = 0;
    document.addEventListener('touchstart', (e) => {
        if (camTouchId !== null) return;
        if (e.target.closest('#leaderboard') || e.target.closest('#header') || e.target.closest('#chat-container') || e.target.closest('.auth-overlay')) return;
        camTouchId = e.changedTouches[0].identifier;
        lastCamX = e.changedTouches[0].clientX;
        lastCamY = e.changedTouches[0].clientY;
    }, {passive: false});

    document.addEventListener('touchmove', (e) => {
        if (camTouchId === null) return;
        for(let i=0; i<e.changedTouches.length; i++) {
            if(e.changedTouches[i].identifier === camTouchId) {
                const t = e.changedTouches[i];
                const dx = t.clientX - lastCamX;
                const dy = t.clientY - lastCamY;
                lastCamX = t.clientX;
                lastCamY = t.clientY;
                cam.yaw -= dx * CAM_H_SENS * 1.5;
                cam.pitch += dy * CAM_V_SENS * 1.5;
                cam.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cam.pitch));
                e.preventDefault();
            }
        }
    }, {passive: false});

    const endCam = (e) => {
        if (camTouchId === null) return;
        for(let i=0; i<e.changedTouches.length; i++) {
            if(e.changedTouches[i].identifier === camTouchId) camTouchId = null;
        }
    };
    document.addEventListener('touchend', endCam);
    document.addEventListener('touchcancel', endCam);
});

document.addEventListener('keydown', () => {
    if (_touchUI) {
        _touchUI.style.display = 'none';
    }
});

// Background script tick — keeps os.clock()-based timers advancing when tab is hidden
let _bgScriptInterval = null;
let _lastBgUpdateMs = 0;
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        _lastBgUpdateMs = Date.now();
        _bgScriptInterval = setInterval(() => {
            const now = Date.now();
            const dt = Math.min((now - _lastBgUpdateMs) / 1000, 0.1);
            _lastBgUpdateMs = now;
            window._scriptUpdate?.(dt);
        }, 100);
    } else {
        clearInterval(_bgScriptInterval);
        _bgScriptInterval = null;
    }
});

// Build minimal overlay / shift-lock / cursor DOM elements
function ensureEl(id, tag, css) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement(tag); el.id = id; document.body.appendChild(el); }
    if (css) el.style.cssText += css;
    return el;
}

const overlay = ensureEl('overlay', 'div');
overlay.textContent = 'Click to play';

const shiftLockIndicator = ensureEl('shift-lock-indicator', 'div');

const cursorEl = ensureEl('game-cursor', 'div');

let cursorX = window.innerWidth / 2;
let cursorY = window.innerHeight / 2;

function updateCursorPos() {
    cursorEl.style.left = cursorX + 'px';
    cursorEl.style.top = cursorY + 'px';
}
updateCursorPos();

document.addEventListener('keydown', e => {
    if (window._chatFocused) return;
    if (!locked) return;
    keys[e.code] = true;
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && window._bloxverse?.shiftLockEnabled !== false) {
        shiftLock = !shiftLock;
        shiftLockIndicator.classList.toggle('visible', shiftLock);
        cursorEl.style.display  = shiftLock ? 'none'  : 'block';
        if (!shiftLock) {
            cursorX = window.innerWidth / 2;
            cursorY = window.innerHeight / 2;
            updateCursorPos();
            if (character) {
                character.rotation.y = ((character.rotation.y % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
                if (character.rotation.y > Math.PI) character.rotation.y -= 2*Math.PI;
            }
        }
    }
    if (e.code === 'Comma')    cam.yaw = Math.round((cam.yaw + Math.PI/4)/(Math.PI/4))*(Math.PI/4);
    if (e.code === 'Period')   cam.yaw = Math.round((cam.yaw - Math.PI/4)/(Math.PI/4))*(Math.PI/4);
    if (e.code === 'Space')    jumpBuffer = JUMP_BUFFER_T;
    if (e.code === 'Backquote') toggleDebug();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

document.addEventListener('pointerlockchange', () => {
    locked = !!document.pointerLockElement;
    if (locked) {
        overlay.style.display = 'none';
        updateCursorPos();
    } else {
        overlay.style.display = '';
        Object.keys(keys).forEach(k => keys[k] = false);
        rmb = false;
    }
});

renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
});
overlay.addEventListener('click', () => renderer.domElement.requestPointerLock());

let customCursorDownTarget = null;
let suppressNextCustomCursorClick = false;

function getCustomCursorTarget() {
    if (!locked || shiftLock || rmb) return null;
    if (cursorEl.style.display === 'none') return null;

    const x = Math.max(0, Math.min(window.innerWidth - 1, cursorX));
    const y = Math.max(0, Math.min(window.innerHeight - 1, cursorY));
    const target = document.elementFromPoint(x, y);
    if (!target || target === renderer.domElement || target === cursorEl || target === overlay || target === document.body || target === document.documentElement) return null;
    return target;
}

function dispatchCustomCursorMouse(target, type, sourceEvent) {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: sourceEvent.button,
        buttons: sourceEvent.buttons,
        clientX: cursorX,
        clientY: cursorY,
        screenX: sourceEvent.screenX,
        screenY: sourceEvent.screenY,
        ctrlKey: sourceEvent.ctrlKey,
        shiftKey: sourceEvent.shiftKey,
        altKey: sourceEvent.altKey,
        metaKey: sourceEvent.metaKey,
    });
    Object.defineProperty(event, '_bloxverseCustomCursor', { value: true });
    window._bloxverseCustomCursorEvent = true;
    target.dispatchEvent(event);
    window._bloxverseCustomCursorEvent = false;
}

document.addEventListener('mousedown', e => {
    if (!e.isTrusted || e.button !== 0) return;
    const target = getCustomCursorTarget();
    if (!target) return;
    customCursorDownTarget = target;
    const focusTarget = target.closest?.('input, textarea, select, button, a[href], [tabindex]');
    if (focusTarget?.focus) focusTarget.focus({ preventScroll: true });
    dispatchCustomCursorMouse(target, 'mousedown', e);
    e.preventDefault();
    e.stopPropagation();
}, true);

document.addEventListener('mouseup', e => {
    if (!e.isTrusted || e.button !== 0 || !customCursorDownTarget) return;
    const upTarget = getCustomCursorTarget() || customCursorDownTarget;
    const downTarget = customCursorDownTarget;
    customCursorDownTarget = null;
    dispatchCustomCursorMouse(upTarget, 'mouseup', e);
    if (upTarget === downTarget || downTarget.contains(upTarget) || upTarget.contains(downTarget)) {
        dispatchCustomCursorMouse(upTarget, 'click', e);
        suppressNextCustomCursorClick = true;
        setTimeout(() => { suppressNextCustomCursorClick = false; }, 0);
    }
    e.preventDefault();
    e.stopPropagation();
}, true);

document.addEventListener('click', e => {
    if (!e.isTrusted || !suppressNextCustomCursorClick) return;
    suppressNextCustomCursorClick = false;
    e.preventDefault();
    e.stopPropagation();
}, true);

renderer.domElement.addEventListener('mousedown', e => { if (e.button === 2) rmb = true; });
document.addEventListener('mouseup', e => { if (e.button === 2) rmb = false; });

document.addEventListener('mousemove', e => {
    if (!locked) return;
    if (shiftLock || rmb || _firstPerson) {
        cam.yaw   -= e.movementX * CAM_H_SENS;
        cam.pitch  = Math.max(cam.minPitch, Math.min(cam.maxPitch, cam.pitch + e.movementY * CAM_V_SENS));
    } else {
        cursorX = Math.max(0, Math.min(window.innerWidth,  cursorX + e.movementX));
        cursorY = Math.max(0, Math.min(window.innerHeight, cursorY + e.movementY));
        updateCursorPos();
    }
});

renderer.domElement.addEventListener('wheel', e => {
    cam.targetDistance = Math.max(cam.minDist, Math.min(cam.maxDist, cam.targetDistance + e.deltaY * 0.04));
}, { passive: true });

// ─── Animation helpers ────────────────────────────────────────────────────────
const anim = { time: 0, bones: {}, rest: {}, offset: {}, posOffset: {}, emote: null };

function clearEmoteOffsets(def) {
    const axesToClear = {};
    const posAxesToClear = {};
    function addBone(name, axis) {
        if (!axesToClear[name]) axesToClear[name] = new Set();
        axesToClear[name].add(axis);
    }
    function addPosBone(name) {
        posAxesToClear[name] = true;
    }
    if (def.keyframes) {
        for (const kf of def.keyframes) {
            if (kf.bones) {
                for (const bName in kf.bones)
                    for (const axis in kf.bones[bName]) addBone(bName, axis);
            }
            if (kf.position) {
                for (const bName in kf.position) addPosBone(bName);
            }
        }
    } else {
        for (const bName in def.bones)
            for (const axis in def.bones[bName]) addBone(bName, axis);
        if (def.oscillate) {
            for (const bName in def.oscillate) {
                if (bName === 'freq') continue;
                for (const axis in def.oscillate[bName]) addBone(bName, axis);
            }
        }
        if (def.position) {
            for (const bName in def.position) addPosBone(bName);
        }
    }
    for (const bName in axesToClear) {
        if (!anim.offset[bName]) continue;
        for (const axis of axesToClear[bName]) delete anim.offset[bName][axis];
        if (Object.keys(anim.offset[bName]).length === 0) {
            delete anim.offset[bName];
            const bone = anim.bones[bName];
            if (bone && anim.rest[bName]) {
                const rest = anim.rest[bName];
                if (rest.x !== undefined) bone.rotation.x = rest.x;
                if (rest.y !== undefined) bone.rotation.y = rest.y;
                if (rest.z !== undefined) bone.rotation.z = rest.z;
            }
        }
    }
    for (const bName in posAxesToClear) {
        delete anim.posOffset[bName];
        const bone = anim.bones[bName];
        if (bone && anim.rest[bName]) {
            const rest = anim.rest[bName];
            if (rest.px != null) bone.position.x = rest.px;
            if (rest.py != null) bone.position.y = rest.py;
            if (rest.pz != null) bone.position.z = rest.pz;
        }
    }
}

function setRot(bone, axis, target, speed, dt) {
    if (!bone) return;
    const rest = anim.rest[bone.name]?.[axis] ?? 0;
    const offset = anim.offset[bone.name]?.[axis] ?? 0;
    bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], rest + offset + target, Math.min(1, speed * dt));
}

function updateEmote(dt) {
    if (_charMoving && anim.emote) {
        clearEmoteOffsets(anim.emote.def);
        anim.emote = null;
        return;
    }
    const e = anim.emote;
    if (!e) return;
    e.timer += dt;
    if (e.timer >= e.def.duration) {
        if (e.def.looping) {
            e.timer = 0;
        } else {
            clearEmoteOffsets(e.def);
            anim.emote = null;
            return;
        }
    }
    if (e.def.keyframes) {
        const kfs = e.def.keyframes;
        if (kfs.length === 0) return;
        let prevKF = kfs[0];
        let nextKF = kfs[kfs.length - 1];
        if (kfs.length === 1 || e.timer <= kfs[0].time) {
            prevKF = nextKF = kfs[0];
        } else if (e.timer >= kfs[kfs.length - 1].time) {
            prevKF = nextKF = kfs[kfs.length - 1];
        } else {
            for (let i = 0; i < kfs.length - 1; i++) {
                if (e.timer >= kfs[i].time && e.timer <= kfs[i + 1].time) {
                    prevKF = kfs[i];
                    nextKF = kfs[i + 1];
                    break;
                }
            }
        }
        const range = nextKF.time - prevKF.time;
        const t = range === 0 ? 0 : (e.timer - prevKF.time) / range;
        const allBones = {};
        const allPosBones = {};
        for (const kf of [prevKF, nextKF]) {
            if (kf.bones) {
                for (const bName in kf.bones) {
                    if (!allBones[bName]) allBones[bName] = new Set();
                    for (const axis in kf.bones[bName]) allBones[bName].add(axis);
                }
            }
            if (kf.position) {
                for (const bName in kf.position) allPosBones[bName] = true;
            }
        }
        for (const bName in allBones) {
            const prev = prevKF.bones?.[bName] || {};
            const next = nextKF.bones?.[bName] || {};
            if (!anim.offset[bName]) anim.offset[bName] = {};
            for (const axis of allBones[bName]) {
                const pv = prev[axis] ?? 0;
                const nv = next[axis] ?? 0;
                anim.offset[bName][axis] = pv + (nv - pv) * t;
            }
        }
        for (const bName in allPosBones) {
            const prev = prevKF.position?.[bName] || {};
            const next = nextKF.position?.[bName] || {};
            if (!anim.posOffset[bName]) anim.posOffset[bName] = {};
            const allPosAxes = new Set([...Object.keys(prev), ...Object.keys(next)]);
            for (const axis of allPosAxes) {
                const pv = prev[axis] ?? 0;
                const nv = next[axis] ?? 0;
                anim.posOffset[bName][axis] = pv + (nv - pv) * t;
            }
        }
        return;
    }
    for (const boneName in e.def.bones) {
        if (!anim.offset[boneName]) anim.offset[boneName] = {};
        for (const axis in e.def.bones[boneName]) {
            anim.offset[boneName][axis] = e.def.bones[boneName][axis];
        }
    }
    if (e.def.oscillate) {
        const freq = e.def.oscillate.freq || 2;
        const phase = e.timer * freq * 2 * Math.PI;
        for (const boneName in e.def.oscillate) {
            if (boneName === 'freq') continue;
            if (!anim.offset[boneName]) anim.offset[boneName] = {};
            for (const axis in e.def.oscillate[boneName]) {
                const base = e.def.bones?.[boneName]?.[axis] ?? 0;
                anim.offset[boneName][axis] = base + Math.sin(phase) * e.def.oscillate[boneName][axis];
            }
        }
    }
    if (e.def.position) {
        for (const boneName in e.def.position) {
            if (!anim.posOffset[boneName]) anim.posOffset[boneName] = {};
            for (const axis in e.def.position[boneName]) {
                anim.posOffset[boneName][axis] = e.def.position[boneName][axis];
            }
        }
    }
}

function updateClimbAnimation(dt, moving) {
    anim.time += dt;
    const t = anim.time, sp = 10;
    const lLeg = anim.bones['Left_Leg'],  rLeg = anim.bones['Right_Leg'];
    const lArm = anim.bones['Left_Arm'],  rArm = anim.bones['Right_Arm'];
    const torso = anim.bones['Torso'];
    const grip = moving ? Math.sin(t * 6) * 0.15 : 0;
    setRot(lArm, 'x', -Math.PI*0.75 + grip, sp, dt);
    setRot(rArm, 'x', -Math.PI*0.75 - grip, sp, dt);
    setRot(lArm, 'z',  0.35, sp, dt);
    setRot(rArm, 'z', -0.35, sp, dt);
    const kick = moving ? Math.sin(t * 6) * 0.3 : 0;
    setRot(lLeg, 'x',  0.3 + kick, sp, dt);
    setRot(rLeg, 'x',  0.3 - kick, sp, dt);
    setRot(torso, 'x', -0.15, sp, dt);
    setRot(torso, 'z',  0,    sp, dt);
}

function updateAnimations(dt, moving) {
    anim.time += dt;
    const t = anim.time, sp = 12;
    const lLeg = anim.bones['Left_Leg'],  rLeg = anim.bones['Right_Leg'];
    const lArm = anim.bones['Left_Arm'],  rArm = anim.bones['Right_Arm'];
    const torso = anim.bones['Torso'];

    if (!grounded) {
        setRot(lLeg,  'x',  0,       sp, dt);
        setRot(rLeg,  'x',  0,       sp, dt);
        setRot(lArm,  'x', -Math.PI, sp, dt);
        setRot(rArm,  'x', -Math.PI, sp, dt);
        setRot(lArm,  'z',  0,       sp, dt);
        setRot(rArm,  'z',  0,       sp, dt);
        setRot(torso, 'x',  0,       sp, dt);
    } else if (moving) {
        const swing = Math.sin(t * 2.8 * Math.PI);
        setRot(lLeg,  'x',  swing * 1.0,  sp, dt);
        setRot(rLeg,  'x', -swing * 1.0,  sp, dt);
        setRot(lArm,  'x', -swing * 0.8,  sp, dt);
        setRot(rArm,  'x',  swing * 0.8,  sp, dt);
        setRot(lArm,  'z',  0.05,         sp, dt);
        setRot(rArm,  'z', -0.05,         sp, dt);
        setRot(torso, 'x',  0.03,         sp, dt);
        setRot(torso, 'z',  0,            sp, dt);
    } else {
        const breathe = Math.sin(t * 1.2) * 0.015;
        setRot(lLeg,  'x',  0,             sp, dt);
        setRot(rLeg,  'x',  0,             sp, dt);
        setRot(lArm,  'x',  0,             sp, dt);
        setRot(rArm,  'x',  0,             sp, dt);
        setRot(lArm,  'z',  0.1 + breathe, sp, dt);
        setRot(rArm,  'z', -0.1 - breathe, sp, dt);
        setRot(torso, 'x',  breathe,       sp, dt);
        setRot(torso, 'z',  0,             sp, dt);
    }
}

function updateOtherPlayers(dt) {
    otherPlayers.forEach((p, userId) => {
        if (!p.mesh) return;
        p.mesh.position.lerp(new THREE.Vector3(p.targetX, p.targetY, p.targetZ), Math.min(1, dt * 10));
        p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, p.targetRy, Math.min(1, dt * 10));

        if (p._emote) { _applyRemoteEmote(p, p._emote, dt); return; }

        p.animTime = (p.animTime || 0) + dt;
        const t = p.animTime, sp = 12;
        const lLeg = p.bones['Left_Leg'],  rLeg = p.bones['Right_Leg'];
        const lArm = p.bones['Left_Arm'],  rArm = p.bones['Right_Arm'];
        const torso = p.bones['Torso'];

        if (p.climbState > 0) {
            const grip = p.moving ? Math.sin(p.animTime * 6) * 0.15 : 0;
            if (lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x || 0) - Math.PI*0.75 + grip, Math.min(1, sp*dt));
            if (rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x || 0) - Math.PI*0.75 - grip, Math.min(1, sp*dt));
            if (lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z || 0) + 0.35, Math.min(1, sp*dt));
            if (rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z || 0) - 0.35, Math.min(1, sp*dt));
            const kick = p.moving ? Math.sin(p.animTime * 6) * 0.3 : 0;
            if (lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x || 0) + 0.3 + kick, Math.min(1, sp*dt));
            if (rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x || 0) + 0.3 - kick, Math.min(1, sp*dt));
            if (torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x || 0) - 0.15, Math.min(1, sp*dt));
            if (torso) torso.rotation.z = THREE.MathUtils.lerp(torso.rotation.z, (p.rest['Torso']?.z || 0), Math.min(1, sp*dt));
        } else if (p.grounded === false) {
            if (lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x || 0), Math.min(1, sp*dt));
            if (rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x || 0), Math.min(1, sp*dt));
            if (lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x || 0) - Math.PI, Math.min(1, sp*dt));
            if (rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x || 0) - Math.PI, Math.min(1, sp*dt));
            if (lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z || 0), Math.min(1, sp*dt));
            if (rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z || 0), Math.min(1, sp*dt));
            if (torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x || 0), Math.min(1, sp*dt));
        } else if (p.moving) {
            const swing = Math.sin(t * 2.8 * Math.PI);
            if (lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x || 0) + swing * 1.0, Math.min(1, sp*dt));
            if (rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x || 0) - swing * 1.0, Math.min(1, sp*dt));
            if (lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x || 0) - swing * 0.8, Math.min(1, sp*dt));
            if (rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x || 0) + swing * 0.8, Math.min(1, sp*dt));
            if (lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z || 0) + 0.05, Math.min(1, sp*dt));
            if (rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z || 0) - 0.05, Math.min(1, sp*dt));
            if (torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x || 0) + 0.03, Math.min(1, sp*dt));
            if (torso) torso.rotation.z = THREE.MathUtils.lerp(torso.rotation.z, (p.rest['Torso']?.z || 0), Math.min(1, sp*dt));
        } else {
            const breathe = Math.sin(t * 1.2) * 0.015;
            if (lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x || 0), Math.min(1, sp*dt));
            if (rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x || 0), Math.min(1, sp*dt));
            if (lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x || 0), Math.min(1, sp*dt));
            if (rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x || 0), Math.min(1, sp*dt));
            if (lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z || 0) + 0.1 + breathe, Math.min(1, sp*dt));
            if (rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z || 0) - 0.1 - breathe, Math.min(1, sp*dt));
            if (torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x || 0) + breathe, Math.min(1, sp*dt));
            if (torso) torso.rotation.z = THREE.MathUtils.lerp(torso.rotation.z, (p.rest['Torso']?.z || 0), Math.min(1, sp*dt));
        }
    });
}

function finishClimbUpdate(dt, anyInput) {
    updateClimbAnimation(dt, anyInput);
    updateOtherPlayers(dt);
    return true;
}

// ─── Character model load ─────────────────────────────────────────────────────
let character = null;
let _spawnPoint = { x: 0, y: null, z: 0, ry: Math.PI };
const otherPlayers = new Map();
const _playerAvatarData = new Map(); // userId -> { colors, clothing, accessories, face }
const _playerAccessoryInstances = new Map();
const _playerAccessoryCancel = new Map();
const _playerVisualTop = new Map(); // userId -> world Y of highest point including accessories

function _getAccessoryMap(userId) {
    if (!_playerAccessoryInstances.has(userId)) {
        _playerAccessoryInstances.set(userId, new Map());
    }
    return _playerAccessoryInstances.get(userId);
}

function _findHighestBone(obj) {
    let highest = null;
    let highestY = -Infinity;
    obj.traverse(child => {
        if (child.isBone || child.type === 'Bone') {
            const worldPos = new THREE.Vector3();
            child.getWorldPosition(worldPos);
            if (worldPos.y > highestY) {
                highestY = worldPos.y;
                highest = child;
            }
        }
    });
    return highest;
}

function _findHeadAttachment(avatarObj) {
    let headBone = null;
    let headMesh = null;
    avatarObj.traverse(child => {
        if ((child.isBone || child.type === 'Bone') && child.name.toLowerCase().includes('head') && !child.name.toLowerCase().includes('_end')) {
            headBone = child;
        }
        if (child.isMesh && (child.name.toLowerCase().includes('head') || ((Array.isArray(child.material) ? child.material[0] : child.material)?.name || '').toLowerCase().includes('head'))) {
            headMesh = child;
        }
    });
    if (headBone && headMesh) return { object: headBone, type: 'bone', headMesh };
    if (headMesh) return { object: headMesh, type: 'mesh', headMesh };
    if (headBone) return { object: headBone, type: 'bone' };
    const highestBone = _findHighestBone(avatarObj);
    if (highestBone) return { object: highestBone, type: 'bone', fallback: true };
    const torso = _findBone(avatarObj, 'Torso');
    if (torso) return { object: torso, type: 'bone', fallback: true };
    return null;
}

// ─── Remote player emote ─────────────────────────────────────────────────────
function _resetRemoteBonesToRest(p) {
    for (const name in p.bones) {
        const rest = p.rest[name];
        const bone = p.bones[name];
        if (rest && bone) {
            bone.rotation.set(rest.x || 0, rest.y || 0, rest.z || 0);
            bone.position.set(rest.px ?? 0, rest.py ?? 0, rest.pz ?? 0);
        }
    }
}

function _applyRemoteEmote(p, emote, dt) {
    const def = emote.def;
    emote.time += dt;

    // Cancel on movement (matches local player behavior)
    if (p.moving) {
        _resetRemoteBonesToRest(p);
        p._emote = null;
        return;
    }

    if (!def.keyframes || def.keyframes.length === 0) return;

    const kfs = def.keyframes;
    const duration = def.duration || 1;
    const looping = def.looping || false;

    let elapsed = emote.time;
    if (looping) {
        if (elapsed >= duration) elapsed = elapsed % duration;
    } else {
        if (elapsed >= duration) {
            _resetRemoteBonesToRest(p);
            p._emote = null;
            return;
        }
    }

    // Find surrounding keyframes
    let prevKF = kfs[0];
    let nextKF = kfs[kfs.length - 1];
    if (kfs.length > 1) {
        if (elapsed <= kfs[0].time) {
            prevKF = nextKF = kfs[0];
        } else if (elapsed >= kfs[kfs.length - 1].time) {
            prevKF = nextKF = kfs[kfs.length - 1];
        } else {
            for (let i = 0; i < kfs.length - 1; i++) {
                if (elapsed >= kfs[i].time && elapsed <= kfs[i + 1].time) {
                    prevKF = kfs[i];
                    nextKF = kfs[i + 1];
                    break;
                }
            }
        }
    }
    const range = nextKF.time - prevKF.time;
    const t = range === 0 ? 0 : (elapsed - prevKF.time) / range;

    // Collect animated bone names
    const allBones = new Set();
    const allPosBones = new Set();
    for (const kf of [prevKF, nextKF]) {
        if (kf.bones) for (const b in kf.bones) allBones.add(b);
        if (kf.position) for (const b in kf.position) allPosBones.add(b);
    }

    // Reset non-animated bones to rest
    for (const name in p.bones) {
        const rest = p.rest[name];
        const bone = p.bones[name];
        if (!rest || !bone) continue;
        if (!allBones.has(name)) {
            bone.rotation.x = rest.x || 0;
            bone.rotation.y = rest.y || 0;
            bone.rotation.z = rest.z || 0;
        }
        if (!allPosBones.has(name)) {
            bone.position.x = rest.px ?? 0;
            bone.position.y = rest.py ?? 0;
            bone.position.z = rest.pz ?? 0;
        }
    }

    // Apply rotation offsets for animated bones
    for (const name of allBones) {
        const bone = p.bones[name];
        if (!bone) continue;
        const rest = p.rest[name] || { x: 0, y: 0, z: 0 };
        const prev = prevKF.bones?.[name] || {};
        const next = nextKF.bones?.[name] || {};
        const axes = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const axis of axes) {
            const pv = prev[axis] ?? 0;
            const nv = next[axis] ?? 0;
            const offset = pv + (nv - pv) * t;
            bone.rotation[axis] = rest[axis] + offset;
        }
    }

    // Apply position offsets for animated bones
    for (const name of allPosBones) {
        const bone = p.bones[name];
        if (!bone) continue;
        const rest = p.rest[name] || { px: 0, py: 0, pz: 0 };
        const prev = prevKF.position?.[name] || {};
        const next = nextKF.position?.[name] || {};
        const axes = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const axis of axes) {
            const pv = prev[axis] ?? 0;
            const nv = next[axis] ?? 0;
            const offset = pv + (nv - pv) * t;
            const posAxis = axis[1];
            bone.position[posAxis] = (rest[axis] ?? 0) + offset;
        }
    }
}
// ─── End remote player emote ─────────────────────────────────────────────────

function _findBone(obj, name) {
    let found = null;
    obj.traverse(child => {
        if ((child.isBone || child.type === 'Bone') && child.name === name) {
            found = child;
        }
    });
    return found;
}

function _clearPlayerAccessories(userId) {
    _playerAccessoryCancel.set(userId, true);
    const map = _playerAccessoryInstances.get(userId);
    if (!map) return;
    for (const entry of map.values()) {
        if (entry.wrapper && entry.wrapper.parent) {
            entry.wrapper.removeFromParent();
        }
    }
    map.clear();
    _playerVisualTop.delete(userId);
}

function _recalcVisualTop(userId) {
    let topY = null;
    let footY = null;
    if (userId === currentUserId && character) {
        const ht = _getHeadTopWorldPosition(character);
        if (ht) topY = ht.y;
        footY = character.position.y;
    } else {
        const p = otherPlayers.get(userId);
        if (p && p.mesh) {
            const ht = _getHeadTopWorldPosition(p.mesh);
            if (ht) topY = ht.y;
            footY = p.mesh.position.y;
        }
    }
    const map = _playerAccessoryInstances.get(userId);
    if (map) {
        for (const entry of map.values()) {
            if (!entry.wrapper) continue;
            const bbox = new THREE.Box3().setFromObject(entry.wrapper);
            if (!bbox.isEmpty() && (topY === null || bbox.max.y > topY)) {
                topY = bbox.max.y;
            }
        }
    }
    if (topY !== null && footY !== null) {
        _playerVisualTop.set(userId, topY - footY);
    }
}

function _loadAccessoryForUser(userId, accessoryId, avatarObj) {
    if (!avatarObj) return;
    const accDef = findAccessory(accessoryId);
    if (!accDef) return;

    const texLoader = new THREE.TextureLoader();
    const path = accDef.meshPath;
    const isGLB = typeof path === 'string' && (path.endsWith('.glb') || path.endsWith('.gltf'));

    const onLoad = (root) => {
        if (_playerAccessoryCancel.get(userId) || !avatarObj.parent) return;
        const headPt = _findHeadAttachment(avatarObj);
        if (!headPt) {
            console.warn('No head attachment found for accessory', accessoryId);
            return;
        }
        avatarObj.updateMatrixWorld(true);

        root.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of mats) {
                    if (!mat) continue;
                    if (accDef.textures?.map) {
                        const diffuse = texLoader.load(accDef.textures.map);
                        diffuse.colorSpace = THREE.SRGBColorSpace;
                        mat.map = diffuse;
                    }
                    if (accDef.textures?.normalMap) {
                        mat.normalMap = texLoader.load(accDef.textures.normalMap);
                        mat.normalScale = new THREE.Vector2(1, 1);
                    }
                    if (accDef.textures?.displacementMap) {
                        mat.displacementMap = texLoader.load(accDef.textures.displacementMap);
                        mat.displacementScale = 0.01;
                    }
                    mat.needsUpdate = true;
                }
            }
        });

        const o = accDef.offset || {};
        const scale = o.scale !== undefined ? o.scale : 1;
        root.position.set(0, 0, 0);
        root.rotation.set(0, 0, 0);
        root.scale.setScalar(scale);
        root.updateMatrixWorld(true);

        const bbox = new THREE.Box3().setFromObject(root);
        const center = bbox.getCenter(new THREE.Vector3());
        root.position.x -= center.x;
        root.position.y -= bbox.min.y;
        root.position.z -= center.z;

        const wrapper = new THREE.Group();
        wrapper.add(root);
        wrapper.userData.isAccessory = true;
        wrapper.traverse(node => {
            node.userData = node.userData || {};
            node.userData.isAccessory = true;
        });
        const attachment = headPt.object;
        const localRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'));
        scene.add(wrapper);

        if (_playerAccessoryCancel.get(userId)) {
            wrapper.removeFromParent();
            return;
        }

        const headTopWorld = (headPt.headMesh ? _getMeshTopWorldPosition(headPt.headMesh) : _getAttachmentTopWorldPosition(attachment)) || attachment.getWorldPosition(new THREE.Vector3());
        const attachmentQuat = attachment.getWorldQuaternion(new THREE.Quaternion());
        const offsetWorld = new THREE.Vector3(o.x || 0, o.y !== undefined ? o.y : 0, o.z || 0).applyQuaternion(attachmentQuat);
        wrapper.position.copy(headTopWorld.clone().add(offsetWorld));
        wrapper.quaternion.copy(attachmentQuat).multiply(localRot);

        const update = () => {
            if (!wrapper.parent) return;
            const headTop = (headPt.headMesh ? _getMeshTopWorldPosition(headPt.headMesh) : _getAttachmentTopWorldPosition(attachment)) || attachment.getWorldPosition(new THREE.Vector3());
            const attachmentQ = attachment.getWorldQuaternion(new THREE.Quaternion());
            const targetWorld = headTop.clone().add(new THREE.Vector3(o.x || 0, o.y !== undefined ? o.y : 0, o.z || 0).applyQuaternion(attachmentQ));
            wrapper.position.copy(targetWorld);
            wrapper.quaternion.copy(attachmentQ).multiply(localRot);
        };

        const map = _getAccessoryMap(userId);
        if (_playerAccessoryCancel.get(userId)) {
            wrapper.removeFromParent();
            return;
        }
        map.set(accessoryId, { wrapper, update });
        _recalcVisualTop(userId);
    };

    if (isGLB) {
        const loader = new GLTFLoader();
        loader.load(path, (gltf) => onLoad(gltf.scene), undefined, () => {});
    } else {
        const loader = new FBXLoader();
        loader.load(path, onLoad, undefined, () => {});
    }
}

function _isAccessoryNode(obj) {
    return obj?.userData?.isAccessory === true;
}

function _getMeshTopWorldPosition(mesh) {
    if (!mesh || !mesh.geometry) return null;
    if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
    }
    const bbox = mesh.geometry.boundingBox;
    const topLocal = new THREE.Vector3((bbox.min.x + bbox.max.x) / 2, bbox.max.y, (bbox.min.z + bbox.max.z) / 2);
    const worldPos = topLocal.clone();
    mesh.localToWorld(worldPos);
    return worldPos;
}

function _getAttachmentTopWorldPosition(attachment) {
    if (!attachment) return null;
    if (attachment.isMesh) return _getMeshTopWorldPosition(attachment);

    const ownMeshes = [];
    attachment.children.forEach(child => {
        if (!child.isMesh) return;
        if (child.userData?.isFaceOverlay) return;
        ownMeshes.push(child);
    });

    if (ownMeshes.length > 0) {
        const bbox = new THREE.Box3();
        ownMeshes.forEach(mesh => bbox.expandByObject(mesh));
        if (!bbox.isEmpty()) {
            const topLocal = new THREE.Vector3(
                (bbox.min.x + bbox.max.x) / 2,
                bbox.max.y,
                (bbox.min.z + bbox.max.z) / 2
            );
            return topLocal; // already world space from expandByObject
        }
    }

    return attachment.getWorldPosition(new THREE.Vector3());
}

function _getHeadTopWorldPosition(avatarObj, userId) {
    const headBone = avatarObj.getObjectByName('Head');
    let topY = null;
    let basePos = null;

    if (headBone) {
        headBone.updateWorldMatrix(true, false);
        const headPos = new THREE.Vector3();
        headBone.getWorldPosition(headPos);
        basePos = headPos;

        let headTopLocalY = 0;
        avatarObj.traverse(child => {
            if (!child.isMesh) return;
            const matName = (Array.isArray(child.material) ? child.material[0] : child.material)?.name || '';
            if (!child.name.toLowerCase().includes('head') && !matName.toLowerCase().includes('head')) return;
            if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
            const bbox = child.geometry.boundingBox;
            const localPt = new THREE.Vector3(0, bbox.max.y, 0);
            child.localToWorld(localPt);
            const localY = localPt.y - headPos.y;
            if (localY > headTopLocalY) headTopLocalY = localY;
        });

        if (headTopLocalY > 0) {
            topY = headPos.y + headTopLocalY;
        } else {
            const headSize = Math.min(CHAR_HEIGHT * 0.3, 1.2);
            topY = headPos.y + headSize;
        }
    } else {
        avatarObj.traverse(child => {
            if (child.isMesh) {
                if (!child.geometry.boundingBox) {
                    child.geometry.computeBoundingBox();
                }
                const bbox = child.geometry.boundingBox;
                const worldPos = new THREE.Vector3(0, bbox.max.y, 0);
                child.localToWorld(worldPos);
                if (topY === null || worldPos.y > topY) {
                    topY = worldPos.y;
                }
                if (!basePos) {
                    basePos = new THREE.Vector3();
                    child.getWorldPosition(basePos);
                }
            }
        });
    }

    const accMap = userId ? _playerAccessoryInstances.get(userId) : null;
    if (accMap) {
        for (const entry of accMap.values()) {
            if (!entry.wrapper) continue;
            const bbox = new THREE.Box3().setFromObject(entry.wrapper);
            if (!bbox.isEmpty() && (topY === null || bbox.max.y > topY)) {
                topY = bbox.max.y;
            }
        }
    }

    if (topY !== null && basePos) {
        return new THREE.Vector3(basePos.x, topY, basePos.z);
    }
    return null;
}

function _applyAccessoriesToModel(userId, model, accessoryIds) {
    if (!model) return;
    _clearPlayerAccessories(userId);
    _playerAccessoryCancel.delete(userId);
    if (!Array.isArray(accessoryIds) || accessoryIds.length === 0) return;
    for (const id of accessoryIds) {
        _loadAccessoryForUser(userId, id, model);
    }
}

function _applyClothingToModel(model, clothingId) {
    if (!model) return;
    if (clothingId) {
        applyAvatarClothing(model, clothingId);
    } else {
        removeAvatarClothing(model);
    }
}

function _updateAccessoryWrappers() {
    for (const map of _playerAccessoryInstances.values()) {
        for (const entry of map.values()) {
            entry.update();
        }
    }
}

function _renderGuiElement(inst, parentEl) {
    if (inst.ClassName === 'Frame' || inst.ClassName === 'TextLabel' || inst.ClassName === 'TextButton') {
        // Clean up old _engineRef (from previous code version)
        if (inst._engineRef && !inst._sgEngineRef) {
            inst._engineRef.style.display = 'none';
        }
        if (!inst._sgEngineRef) {
            const tag = inst.ClassName === 'TextButton' ? 'button' : 'div';
            const el = document.createElement(tag);
            el.style.cssText = 'position:absolute;box-sizing:border-box;border:none;outline:none;';
            if (inst.ClassName === 'TextButton') {
                el.style.cursor = 'pointer';
                el.onclick = () => { if (inst.MouseButton1Click) inst.MouseButton1Click.Fire(); };
            }
            parentEl.appendChild(el);
            inst._sgEngineRef = el;
        }
        const el = inst._sgEngineRef;
        el.style.display = (inst.Visible !== false) ? 'block' : 'none';
        
        const bgAlpha = 1 - (inst.BackgroundTransparency || 0);
        if (bgAlpha <= 0) {
            el.style.backgroundColor = 'transparent';
        } else if (bgAlpha >= 1) {
            el.style.backgroundColor = inst.BackgroundColor ? '#' + inst.BackgroundColor.getHexString() : '#333';
        } else {
            const c = inst.BackgroundColor;
            if (c) {
                el.style.backgroundColor = 'rgba(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ',' + bgAlpha + ')';
            } else {
                el.style.backgroundColor = 'transparent';
            }
        }
        
        if (inst.ClassName !== 'Frame') {
            el.textContent = inst.Text || '';
            const tc = inst.TextColor;
            const tAlpha = 1 - (inst.TextTransparency || 0);
            if (tc && tAlpha < 1 && tAlpha > 0) {
                el.style.color = 'rgba(' + Math.round(tc.r * 255) + ',' + Math.round(tc.g * 255) + ',' + Math.round(tc.b * 255) + ',' + tAlpha + ')';
            } else if (tAlpha <= 0) {
                el.style.color = 'transparent';
            } else {
                el.style.color = tc ? '#' + tc.getHexString() : '#fff';
            }
            el.style.fontSize = (inst.FontSize || 14) + 'px';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'center';
        }
        
        const px = inst.Position ? inst.Position[0] : 0;
        const py = inst.Position ? inst.Position[1] : 0;
        const sx = inst.Size ? inst.Size[0] : 100;
        const sy = inst.Size ? inst.Size[1] : 50;
        el.style.left = (px >= 0 && px <= 1) ? (px * 100 + '%') : (px + 'px');
        el.style.top = (py >= 0 && py <= 1) ? (py * 100 + '%') : (py + 'px');
        el.style.width = (sx >= 0 && sx <= 1) ? (sx * 100 + '%') : (sx + 'px');
        el.style.height = (sy >= 0 && sy <= 1) ? (sy * 100 + '%') : (sy + 'px');
    }
    inst.Children.forEach(c => _renderGuiElement(c, parentEl));
}

function _updateSurfaceGuiProjections() {
    if (!camera) return;
    if (!_gameRef) return;
    // Clean up orphaned _engineRef divs from previous code versions
    document.querySelectorAll('div[id^="sg-orphan-"]').forEach(el => el.remove());
    
    if (!window._surfaceGuis) window._surfaceGuis = new Map();
    function _scanSurface(node) {
        if (node.ClassName === 'SurfaceGui') {
            if (!node._surfaceGuiId) node._surfaceGuiId = 'sg-' + Math.random().toString(36).slice(2);
            window._surfaceGuis.set(node._surfaceGuiId, node);
            // Clean up old _engineRef div (previous code) — hide it so it doesn't show
            if (node._engineRef && !node._sgContainer) {
                node._engineRef.style.display = 'none';
            }
        }
        node.Children.forEach(_scanSurface);
    }
    _gameRef.Children.forEach(_scanSurface);
    
    const w = window.innerWidth;
    const h = window.innerHeight;
    window._surfaceGuis.forEach((sg) => {
        const part = sg.Adornee || sg.Parent;
        if (!part || part.ClassName !== 'Part' || !part.mesh) {
            if (sg._sgContainer) { sg._sgContainer.style.display = 'none'; }
            return;
        }
        
        if (!sg._sgContainer) {
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed;pointer-events:auto;overflow:hidden;transform:translate(-50%,-50%);z-index:999;display:none;';
            document.body.appendChild(container);
            sg._sgContainer = container;
        }
        const container = sg._sgContainer;
        
        if (sg.SizingMode === 'FixedSize' || !sg.SizingMode) {
            container.style.width = (sg.CanvasSize?.[0] || 200) + 'px';
            container.style.height = (sg.CanvasSize?.[1] || 200) + 'px';
        }
        
        // Render children into the container
        _renderGuiElement(sg, container);
        
        // Position via 3D projection
        const size = part.Size || [4, 4, 4];
        const face = sg.Face || 'Front';
        const pos = part.mesh.position;
        
        let lx = 0, ly = 0, lz = 0;
        const hw = size[0] / 2, hh = size[1] / 2, hd = size[2] / 2;
        switch (face) {
            case 'Right':  lx = hw; break;
            case 'Left':   lx = -hw; break;
            case 'Top':    ly = hh; break;
            case 'Bottom': ly = -hh; break;
            case 'Back':   lz = -hd; break;
            case 'Front': default: lz = hd; break;
        }
        
        const worldPos = new THREE.Vector3(lx, ly, lz);
        worldPos.applyQuaternion(part.mesh.quaternion);
        worldPos.add(pos);
        
        const projected = worldPos.clone().project(camera);
        const sx = (projected.x * 0.5 + 0.5) * w;
        const sy = (-projected.y * 0.5 + 0.5) * h;
        
        if (projected.z > 1) {
            container.style.display = 'none';
            return;
        }
        
        container.style.left = sx + 'px';
        container.style.top = sy + 'px';
        container.style.display = (sg.Enabled !== false) ? 'block' : 'none';
    });
}

let _gameRef = null;
let _leaderboardEl = null;
let _lastLeaderstatsHash = '';

function _updateLeaderstats(game) {
    if (!game) return;
    const playersService = game.Children.find(c => c.ClassName === 'Players');
    if (!playersService) return;
    
    const entries = [];
    for (const player of playersService.Children) {
        if (player.ClassName !== 'Player') continue;
        const ls = player.Children.find(c => c.Name === 'leaderstats');
        if (!ls) continue;
        const stats = ls.Children.filter(c =>
            c.ClassName === 'IntValue' || c.ClassName === 'StringValue' ||
            c.ClassName === 'NumberValue' || c.ClassName === 'BoolValue'
        );
        if (stats.length === 0) continue;
        entries.push({ name: player.Name, stats: stats.map(s => ({ name: s.Name, value: s.Value, type: s.ClassName })) });
    }
    
    if (entries.length === 0) {
        if (_leaderboardEl) { _leaderboardEl.style.display = 'none'; }
        _lastLeaderstatsHash = '';
        return;
    }
    
    const hash = JSON.stringify(entries);
    if (hash === _lastLeaderstatsHash && _leaderboardEl) {
        _leaderboardEl.style.display = 'block';
        return;
    }
    _lastLeaderstatsHash = hash;
    
    if (!_leaderboardEl) {
        _leaderboardEl = document.createElement('div');
        _leaderboardEl.id = 'leaderstats-board';
        _leaderboardEl.style.cssText = 'position:fixed;top:80px;right:12px;z-index:999;background:rgba(10,10,20,0.85);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 14px;font-family:system-ui,sans-serif;color:#e0e0e0;font-size:13px;min-width:180px;pointer-events:none;backdrop-filter:blur(4px);';
        document.body.appendChild(_leaderboardEl);
    }
    _leaderboardEl.style.display = 'block';
    
    const statNames = entries[0].stats.map(s => s.name);
    
    let html = '<div style="font-weight:600;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.1);">Leaderboard</div>';
    html += '<table style="width:100%;border-collapse:collapse;">';
    html += '<thead><tr>';
    html += '<th style="text-align:left;padding:2px 6px;color:#aaa;font-weight:400;font-size:11px;">Player</th>';
    for (const sn of statNames) {
        html += '<th style="text-align:right;padding:2px 6px;color:#aaa;font-weight:400;font-size:11px;">' + sn + '</th>';
    }
    html += '</tr></thead><tbody>';
    for (const entry of entries) {
        html += '<tr>';
        html += '<td style="padding:2px 6px;color:#fff;">' + entry.name + '</td>';
        for (const st of entry.stats) {
            let displayVal = st.value;
            if (st.type === 'BoolValue') displayVal = st.value ? '✅' : '❌';
            html += '<td style="text-align:right;padding:2px 6px;color:#7c5cfc;">' + displayVal + '</td>';
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    _leaderboardEl.innerHTML = html;
}

function _applyColorsToModel(model, colors) {
    if (!model || !colors) return;
    model.traverse(child => {
        if (child.isMesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
                if (!mat) continue;
                // Never tint the face/head texture slot — it's a decal with its
                // own texture and tinting it washes out or hides the face entirely.
                if (mat.userData?.isFace) continue;
                const matNameLower = (mat.name || child.name || '').toLowerCase();
                if (matNameLower.includes('face')) continue;
                const name = mat.name || child.name || 'Body';
                if (colors[name]) {
                    mat.vertexColors = false;
                    mat.emissive && mat.emissive.setHex(0);
                    mat.emissiveIntensity = 0;
                    mat.toneMapped = false;
                    mat.transparent = false;
                    mat.opacity = 1;
                    mat.color.setStyle(colors[name], THREE.SRGBColorSpace);
                    mat.needsUpdate = true;
                }
            }
        }
    });
}

function _applyFaceToModel(mesh, faceId) {
    const headBone = mesh.getObjectByName('Head');
    if (!headBone) return;

    // Remove existing face overlay
    const toRemove = [];
    headBone.children.forEach(child => {
        if (child.userData?.isFaceOverlay) toRemove.push(child);
    });
    for (const overlay of toRemove) {
        overlay.removeFromParent();
        overlay.geometry?.dispose();
        if (overlay.material) {
            if (overlay.material.map) overlay.material.map.dispose();
            overlay.material.dispose();
        }
    }

    const id = faceId || 'smile';
    const def = findFace(id);
    if (!def) return;

    const headSize = Math.min(CHAR_HEIGHT * 0.3, 1.2);
    const texLoader = new THREE.TextureLoader();
    texLoader.load(def.texturePath, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshStandardMaterial({
            map: tex, transparent: true, alphaTest: 0.05,
            depthWrite: false, color: 0xffffff,
        });
        const faceSize = headSize * 0.85;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(faceSize, faceSize), mat);
        m.position.set(0, headSize * 0.42, headSize * 0.51);
        m.renderOrder = 3;
        m.userData.isFaceOverlay = true;
        headBone.add(m);
    }, undefined, (err) => console.error('FACE TEX LOAD FAILED:', err));
}

const fbxLoader = new FBXLoader();

function _setLocalAvatarVisible(visible) {
    if (!character) return;
    const accMap = _playerAccessoryInstances.get(currentUserId);
    if (accMap) {
        for (const entry of accMap.values()) {
            if (entry.wrapper) entry.wrapper.visible = visible;
        }
    }
    character.traverse(child => {
        if (child.userData?.isClothingOverlay) child.visible = visible;
    });
    const headBone = character.getObjectByName('Head');
    if (headBone) {
        headBone.traverse(child => {
            if (child.userData?.isFaceOverlay) child.visible = visible;
        });
    }
}

function _setLocalAvatarOpacity(opacity) {
    if (!character) return;
    const setMatOpacity = (mat) => {
        mat.transparent = true;
        mat.opacity = opacity;
    };
    character.traverse(child => {
        if (child.isMesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) setMatOpacity(mat);
        }
    });
    const accMap = _playerAccessoryInstances.get(currentUserId);
    if (accMap) {
        for (const entry of accMap.values()) {
            if (entry.wrapper) {
                entry.wrapper.traverse(child => {
                    if (child.isMesh) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        for (const mat of mats) setMatOpacity(mat);
                    }
                });
            }
        }
    }
}
fbxLoader.setResourcePath(''); // Prevent FBXLoader from auto-loading external textures

fbxLoader.load(playerModelUrl, (fbx) => {
    fbx.position.set(0, 0, 0);
    fbx.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(fbx);
    CHAR_FOOT_OFFSET = -box.min.y;
    CHAR_HEIGHT      = box.max.y - box.min.y;
    CHAR_STAND_Y     = G_LEVEL + CHAR_FOOT_OFFSET;

    console.log('char foot offset:', CHAR_FOOT_OFFSET.toFixed(3), '| height:', CHAR_HEIGHT.toFixed(3));

    const spawnY = _spawnPoint.y !== null
        ? _spawnPoint.y + CHAR_FOOT_OFFSET
        : CHAR_STAND_Y;

    fbx.position.set(_spawnPoint.x, spawnY, _spawnPoint.z);
    fbx.rotation.y = _spawnPoint.ry;

    const faceMats = [];

    fbx.traverse(child => {
        if (child.isBone || child.type === 'Bone') {
            anim.bones[child.name] = child;
            anim.rest[child.name] = {
                x: child.rotation.x, y: child.rotation.y, z: child.rotation.z,
                px: child.position.x, py: child.position.y, pz: child.position.z,
            };
        }
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            if (child.geometry) {
                for (const key of Object.keys(child.geometry.attributes)) {
                    if (key.toLowerCase().includes('color')) {
                        child.geometry.deleteAttribute(key);
                    }
                }
                if (child.geometry.morphAttributes) {
                    for (const key of Object.keys(child.geometry.morphAttributes)) {
                        if (key.toLowerCase().includes('color')) {
                            delete child.geometry.morphAttributes[key];
                        }
                    }
                }
            }

            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (let i = 0; i < mats.length; i++) {
                let mat = mats[i];
                if (!mat) continue;

                const originalColor = mat.color ? mat.color.getHex() : 0xcccccc;
                const newMat = new THREE.MeshStandardMaterial({
                    color: originalColor,
                    map: mat.map,
                    transparent: false,
                    opacity: 1,
                    toneMapped: false,
                    vertexColors: false,
                    emissive: 0,
                    emissiveIntensity: 0,
                    roughness: 0.8,
                    metalness: 0.1,
                });
                
                // Copy name and userData so that applyColors can find it
                newMat.name = mat.name;
                if (mat.userData) {
                    newMat.userData = JSON.parse(JSON.stringify(mat.userData));
                }
                
                mats[i] = newMat;
                mat = newMat;

                const matNameLower = (mat.name || child.name || '').toLowerCase();
                const isFaceMat = matNameLower.includes('head') || matNameLower.includes('face');
                if (isFaceMat) {
                    mat.transparent = true;
                    mat.alphaTest = 0.05;
                    mat.depthWrite = false;
                    mat.userData.isFace = true;
                    mat.color.set(0xff0000);
                    mat.emissive.setHex(0xff0000);
                    mat.emissiveIntensity = 1.0;
                    mat.needsUpdate = true;
                    faceMats.push(mat);
                }

                // Nuke every texture slot FBXLoader may have populated
                for (const key of ['map','normalMap','roughnessMap','metalnessMap',
                    'emissiveMap','bumpMap','alphaMap','aoMap','displacementMap',
                    'specularMap','envMap','lightMap']) {
                    if (mat[key]) { mat[key].dispose(); mat[key] = null; }
                }
                mat.needsUpdate = true;
            }
            if (Array.isArray(child.material)) {
                child.material = mats;
            } else {
                child.material = mats[0];
            }
        }
    });

    scene.add(fbx);
    character = fbx;

    // Apply saved avatar data for local player
    if (currentUserId && _playerAvatarData.has(currentUserId)) {
        const storedData = _playerAvatarData.get(currentUserId);
        if (storedData.colors) _applyColorsToModel(character, storedData.colors);
        _applyClothingToModel(character, storedData.clothing);
        _applyAccessoriesToModel(currentUserId, character, storedData.accessories);
        _applyFaceToModel(character, storedData.face);
    }
    
    // Set initial visual top for local player
    _recalcVisualTop(currentUserId);

    renderer.shadowMap.needsUpdate = true;
});

// ─── Collision resolution helpers ─────────────────────────────────────────────
function obbOverlap(cx, cz, co, si, b) {
    const aco = Math.abs(co), asi = Math.abs(si);
    const bcx = (b.minX+b.maxX)*0.5, bcz = (b.minZ+b.maxZ)*0.5;
    const bhx = (b.maxX-b.minX)*0.5, bhz = (b.maxZ-b.minZ)*0.5;
    const dx = bcx - cx, dz = bcz - cz;
    const ov0 = (CHAR_HALF_W*aco + CHAR_HALF_D*asi) + bhx - Math.abs(dx);
    if (ov0 <= 0) return null;
    const ov1 = (CHAR_HALF_W*asi + CHAR_HALF_D*aco) + bhz - Math.abs(dz);
    if (ov1 <= 0) return null;
    const dp2 = dx*co - dz*si;
    const ov2 = CHAR_HALF_W + (bhx*aco + bhz*asi) - Math.abs(dp2);
    if (ov2 <= 0) return null;
    const dp3 = dx*si + dz*co;
    const ov3 = CHAR_HALF_D + (bhx*asi + bhz*aco) - Math.abs(dp3);
    if (ov3 <= 0) return null;
    return { ov0, ov1, ov2, ov3, dx, dz, dp2, dp3, co, si };
}

function mtvOBBvsChar(obb) {
    const px = character.position.x;
    const py = character.position.y - CHAR_FOOT_OFFSET + CHAR_HEIGHT/2;
    const pz = character.position.z;
    const phx = CHAR_HALF_W, phy = CHAR_HEIGHT/2, phz = CHAR_HALF_D;
    const dx = px - obb.cx, dy = py - obb.cy, dz = pz - obb.cz;
    let minOv = Infinity, nx = 0, ny = 0, nz = 0;

    function testAxis(ax, ay, az) {
        const len = Math.sqrt(ax*ax+ay*ay+az*az);
        if (len < 1e-6) return true;
        ax/=len; ay/=len; az/=len;
        const charR = phx*Math.abs(ax)+phy*Math.abs(ay)+phz*Math.abs(az);
        const obbR  = obb.hx*Math.abs(ax*obb.ux+ay*obb.uy+az*obb.uz)
                    + obb.hy*Math.abs(ax*obb.vx+ay*obb.vy+az*obb.vz)
                    + obb.hz*Math.abs(ax*obb.wx+ay*obb.wy+az*obb.wz);
        const sep = Math.abs(dx*ax+dy*ay+dz*az);
        const ov = charR+obbR-sep;
        if (ov <= 0) return false;
        if (ov < minOv) { minOv=ov; nx=ax; ny=ay; nz=az; }
        return true;
    }

    if (!testAxis(1,0,0)) return null;
    if (!testAxis(0,1,0)) return null;
    if (!testAxis(0,0,1)) return null;
    if (!testAxis(obb.ux,obb.uy,obb.uz)) return null;
    if (!testAxis(obb.vx,obb.vy,obb.vz)) return null;
    if (!testAxis(obb.wx,obb.wy,obb.wz)) return null;

    const wa = [[1,0,0],[0,1,0],[0,0,1]];
    const ob = [[obb.ux,obb.uy,obb.uz],[obb.vx,obb.vy,obb.vz],[obb.wx,obb.wy,obb.wz]];
    for (const [ax,ay,az] of wa) for (const [bx,by,bz] of ob) {
        if (!testAxis(ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx)) return null;
    }

    if (dx*nx+dy*ny+dz*nz < 0) { nx=-nx; ny=-ny; nz=-nz; }
    return { nx, ny, nz, depth: minOv };
}

function resolveOBBH(nearby, pushVx = 0, pushVz = 0, dt = 1/60) {
    for (const b of nearby) {
        if (!b.isOBB) continue;
        const r = mtvOBBvsChar(b);
        if (!r) continue;
        const { nx, ny, nz, depth } = r;
        const absY = Math.abs(ny);
        const horzLen = Math.sqrt(nx*nx+nz*nz);
        if (horzLen <= absY) continue;
        const fy = character.position.y - CHAR_FOOT_OFFSET;
        const stepNeeded = b.maxY - fy;
        if (stepNeeded > 0 && stepNeeded <= STEP_HEIGHT && grounded && velY <= 0) {
            if (b.maxY + CHAR_FOOT_OFFSET > stepUpTarget) stepUpTarget = b.maxY + CHAR_FOOT_OFFSET;
            // continue; // Don't skip Touched even if stepping up
        }
        
        // FIRE TOUCHED EVENT
        if (window._bloxverse._charInstance) {
            const _ti = b._instRef || b._meshRef?._instRef;
            if (_ti && _ti.Touched) _ti.Touched.Fire(window._bloxverse._charInstance);
        }

        character.position.x += nx * depth;
        character.position.z += nz * depth;
        pushedBlocks.add(b);

        // Push dynamic physics bodies away from character along collision normal
        if (b._bodyRef) {
            const m = b._bodyRef.mass || 1;
            const pushSpeed = Math.sqrt(pushVx * pushVx + pushVz * pushVz);
            const horzNorm = Math.sqrt(nx * nx + nz * nz);
            if (horzNorm > 0.001) {
                markLocalPhysicsOwner(b._meshRef);
                const targetVx = (-nx / horzNorm) * pushSpeed;
                const targetVz = (-nz / horzNorm) * pushSpeed;
                const factor = Math.min(1, dt * PUSH_SCALE * depth / m);
                b._bodyRef.velocity.x += (targetVx - b._bodyRef.velocity.x) * factor;
                b._bodyRef.velocity.z += (targetVz - b._bodyRef.velocity.z) * factor;
            }
        }
    }
}

function resolveOBBV(nearby) {
    for (const b of nearby) {
        if (!b.isOBB) continue;
        if (pushedBlocks.has(b)) continue;
        const r = mtvOBBvsChar(b);
        if (!r) continue;
        const { nx, ny, nz, depth } = r;
        const absY = Math.abs(ny);
        const horzLen = Math.sqrt(nx*nx+nz*nz);
        if (horzLen > absY) continue;
        const pushY = absY > 0.001 ? depth/absY : depth;
        if (ny > 0) {
            character.position.y += pushY;
            if (velY < 0) { velY = 0; grounded = true; extraVelX = 0; extraVelZ = 0; }
        } else {
            character.position.y -= pushY;
            if (velY > 0) velY = 0;
        }

        // FIRE TOUCHED EVENT (Vertical OBB)
        if (window._bloxverse._charInstance) {
            const _ti = b._instRef || b._meshRef?._instRef;
            if (_ti && _ti.Touched) _ti.Touched.Fire(window._bloxverse._charInstance);
        }
    }
}

let _dynTouchLastLog = 0;
function checkDynamicTouched() {
    if (!window._bloxverse._charInstance || !character) return;
    const cx = character.position.x, cy = character.position.y, cz = character.position.z;
    const footY = cy - CHAR_FOOT_OFFSET;
    const headY = footY + CHAR_HEIGHT;

    physicsBodies.forEach(({ body, anchored, mesh }) => {
        if (anchored) return;
        if (!mesh._instRef || !mesh._instRef.Touched) return;

        const bx = mesh.position.x, by = mesh.position.y, bz = mesh.position.z;
        const hs = mesh.userData.halfSize || { sw: 2, sh: 2, sd: 2 };
        const hw = hs.sw / 2 + CHAR_HALF_W + 0.5;
        const hd = hs.sd / 2 + CHAR_HALF_D + 0.5;
        const bMinY = by - hs.sh / 2;
        const bMaxY = by + hs.sh / 2;

        if (Math.abs(cx - bx) < hw && Math.abs(cz - bz) < hd && footY < bMaxY + 0.5 && headY > bMinY - 0.5) {
            mesh._instRef.Touched.Fire(window._bloxverse._charInstance);
        }
    });
}

function resolveBlocksH(nearby) {
    stepUpTarget = -Infinity;
    pushedBlocks.clear();
    const cx = character.position.x, cz = character.position.z;
    const θ = character.rotation.y;
    const co = Math.cos(θ), si = Math.sin(θ);

    for (const b of nearby) {
        if (b.isOBB) continue;
        const fy = character.position.y - CHAR_FOOT_OFFSET;
        if (b.maxY <= fy || b.minY >= fy + CHAR_HEIGHT) continue;
        const r = obbOverlap(cx, cz, co, si, b);
        if (!r) continue;
        const stepNeeded = b.maxY - fy;
        if (stepNeeded > 0 && stepNeeded <= STEP_HEIGHT && grounded && velY <= 0) {
            stepUpTarget = b.maxY + CHAR_FOOT_OFFSET;
            continue;
        }
        const yLo = Math.max(fy, b.minY), yHi = Math.min(fy + CHAR_HEIGHT, b.maxY);
        if (yHi - yLo < 0.02) continue;
        const { ov0, ov1, dx, dz } = r;
        // If BOTH horizontal overlaps exceed the character's full dimensions the player
        // is deeply inside a very large block (e.g. the 320×320 baseplate catching them
        // slightly underground, or a big map part at spawn). Pushing sideways would
        // teleport them to the block's edge — skip and let resolveBlocksV snap them up.
        if (ov0 > CHAR_HALF_W * 2 && ov1 > CHAR_HALF_D * 2) continue;
        if (ov0 <= ov1) character.position.x -= Math.sign(dx) * ov0;
        else            character.position.z -= Math.sign(dz) * ov1;
        pushedBlocks.add(b);

        // FIRE TOUCHED EVENT (Horizontal Block)
        if (window._bloxverse._charInstance) {
            const _ti = b._instRef || b._meshRef?._instRef;
            if (_ti && _ti.Touched) _ti.Touched.Fire(window._bloxverse._charInstance);
        }
    }
}

function resolveBlocksV(nearby) {
    const cx = character.position.x, cz = character.position.z;
    const θ = character.rotation.y;
    const co = Math.cos(θ), si = Math.sin(θ);

    for (const b of nearby) {
        if (b.isOBB) continue;
        if (pushedBlocks.has(b)) continue;
        const fy = character.position.y - CHAR_FOOT_OFFSET;
        if (!obbOverlap(cx, cz, co, si, b)) continue;
        const oyU = b.maxY - fy;
        const oyD = fy + CHAR_HEIGHT - b.minY;
        if (oyU <= 0 || oyD <= 0) continue;
        if (oyU <= oyD) {
            if (stepUpTarget > -Infinity && Math.abs(b.maxY + CHAR_FOOT_OFFSET - stepUpTarget) < 0.1) {
                velY = 0; grounded = true; extraVelX = 0; extraVelZ = 0;
            } else {
                character.position.y = b.maxY + CHAR_FOOT_OFFSET;
                if (velY < 0) { velY = 0; grounded = true; extraVelX = 0; extraVelZ = 0; }
            }
        } else {
            if (fy < b.minY) {
                character.position.y = b.minY - CHAR_HEIGHT + CHAR_FOOT_OFFSET;
                if (velY > 0) velY = 0;
            }
        }

        // FIRE TOUCHED EVENT (Vertical Block)
        if (window._bloxverse._charInstance) {
            const _ti = b._instRef || b._meshRef?._instRef;
            if (_ti && _ti.Touched) _ti.Touched.Fire(window._bloxverse._charInstance);
        }
    }
}

// ─── Climb helpers ────────────────────────────────────────────────────────────
function findClimbableBlock(px, pz, footY, fwdX, fwdZ) {
    if (climbBlock) {
        const b = climbBlock;
        if (b.maxY - b.minY <= CLIMB_MAX_PART_H &&
            b.maxY >= footY - HANG_DEPTH - 0.1 &&
            b.minY <= footY + CHAR_HEIGHT) {
            const cpx = Math.max(b.minX, Math.min(px, b.maxX));
            const cpz = Math.max(b.minZ, Math.min(pz, b.maxZ));
            const dx = cpx-px, dz = cpz-pz;
            if (Math.sqrt(dx*dx+dz*dz) <= CHAR_HALF_W + CLIMB_REACH + 0.4) return b;
        }
    }
    const nearby = getNearbyColliders(px, footY + CHAR_FOOT_OFFSET, pz);
    let best = null, bestScore = Infinity;
    for (const b of nearby) {
        if (b.maxY - b.minY > CLIMB_MAX_PART_H) continue;
        if (b.maxY < footY - HANG_DEPTH - 0.1) continue;
        if (b.minY > footY + CHAR_HEIGHT) continue;
        const cpx = Math.max(b.minX, Math.min(px, b.maxX));
        const cpz = Math.max(b.minZ, Math.min(pz, b.maxZ));
        const dx = cpx-px, dz = cpz-pz;
        const dlen = Math.sqrt(dx*dx+dz*dz);
        if (dlen > CHAR_HALF_W + CLIMB_REACH + 0.4) continue;
        if (dlen >= 0.01 && (dx/dlen)*fwdX + (dz/dlen)*fwdZ < -0.5) continue;
        const score = dlen + Math.abs(b.maxY - footY) * 0.1;
        if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
}

function findChainBlockBelow(px, pz, ledgeY) {
    const nearby = getNearbyColliders(px, ledgeY + CHAR_FOOT_OFFSET, pz);
    let best = null, bestY = -Infinity;
    for (const cb of nearby) {
        if (cb.maxY - cb.minY > CLIMB_MAX_PART_H) continue;
        if (cb.maxY >= ledgeY - 0.01 || cb.maxY < ledgeY - CLIMB_WINDOW) continue;
        const cpx = Math.max(cb.minX, Math.min(px, cb.maxX));
        const cpz = Math.max(cb.minZ, Math.min(pz, cb.maxZ));
        const dx = cpx-px, dz = cpz-pz;
        if (Math.sqrt(dx*dx+dz*dz) > CHAR_HALF_W + CLIMB_REACH + 0.4) continue;
        if (cb.maxY > bestY) { best = cb; bestY = cb.maxY; }
    }
    return best;
}

function findChainBlockAbove(px, pz, ledgeY) {
    const nearby = getNearbyColliders(px, ledgeY + CHAR_FOOT_OFFSET, pz);
    for (const cb of nearby) {
        if (cb.maxY - cb.minY > CLIMB_MAX_PART_H) continue;
        if (cb.maxY <= ledgeY + 0.01 || cb.maxY > ledgeY + CLIMB_WINDOW) continue;
        const cbcx = (cb.minX+cb.maxX)*0.5 - px;
        const cbcz = (cb.minZ+cb.maxZ)*0.5 - pz;
        const cbcd = Math.sqrt(cbcx*cbcx+cbcz*cbcz);
        if (cbcd > 0.01 && (cbcx/cbcd)*climbFwdX + (cbcz/cbcd)*climbFwdZ < 0.4) continue;
        return cb;
    }
    return null;
}

function tryLedgeGrab(nearby) {
    if (climbCooldown > 0 || climbState !== 'none' || grounded || velY < CLIMB_FALL_CUTOFF) return;
    if ((keys['KeyS'] || keys['ArrowDown']) && !(keys['KeyW'] || keys['ArrowUp'])) return;

    const footY = character.position.y - CHAR_FOOT_OFFSET;
    const px = character.position.x, pz = character.position.z;
    const fwdX = Math.sin(character.rotation.y);
    const fwdZ = Math.cos(character.rotation.y);

    let bestBlock = null, bestApX = 0, bestApZ = 0, bestDist = Infinity;

    for (const b of nearby) {
        if (b.maxY - b.minY > CLIMB_MAX_PART_H) continue;
        const below = b.maxY - footY;
        if (below < 0.3 || below > CLIMB_WINDOW) continue;
        if (b.minY > footY + CHAR_HEIGHT) continue;
        const ox = Math.min(px+CHAR_HALF_W+CLIMB_REACH, b.maxX) - Math.max(px-CHAR_HALF_W-CLIMB_REACH, b.minX);
        const oz = Math.min(pz+CHAR_HALF_D+CLIMB_REACH, b.maxZ) - Math.max(pz-CHAR_HALF_D-CLIMB_REACH, b.minZ);
        if (ox <= 0 || oz <= 0) continue;
        const cpx = Math.max(b.minX, Math.min(px, b.maxX));
        const cpz = Math.max(b.minZ, Math.min(pz, b.maxZ));
        let apX = cpx-px, apZ = cpz-pz;
        const apLen = Math.sqrt(apX*apX+apZ*apZ);
        if (apLen < 0.01) { apX = fwdX; apZ = fwdZ; }
        else {
            apX/=apLen; apZ/=apLen;
            if (apX*fwdX + apZ*fwdZ < -0.9) continue;
        }
        if (apLen < bestDist) { bestDist = apLen; bestBlock = b; bestApX = apX; bestApZ = apZ; }
    }

    if (!bestBlock) return;
    climbLedgeY = bestBlock.maxY;
    climbBlock  = bestBlock;
    climbFwdX   = bestApX;
    climbFwdZ   = bestApZ;
    climbState  = 'hanging';
    velY        = 0;
}

// ─── Main physics update ──────────────────────────────────────────────────────
function lerpAngle(current, target, t) {
    let diff = target - current;
    diff = ((diff + Math.PI) % (2*Math.PI)) - Math.PI;
    return current + diff * t;
}

// ─── Physics Update ────────────────────────────────────────────────────────────
function updatePhysics(dt) {
    // Step the physics world
    physicsWorld.step(1 / 60, dt, 3); // Fixed 60Hz timestep with max 3 iterations
    
    // Sync mesh positions and rotations with physics bodies
    physicsBodies.forEach(({ body, anchored, mesh }) => {
        if (!anchored && body) {
            // Update mesh position from physics body
            mesh.position.copy(body.position);
            mesh.quaternion.copy(body.quaternion);
            
            // Use stored half-size from addStud
            const hs = mesh.userData.halfSize || { sw: 1, sh: 1, sd: 1 };
            const sw = hs.sw, sh = hs.sh, sd = hs.sd;
            
            // Recompute the OBB for this dynamic part
            const cx = mesh.position.x, cy = mesh.position.y, cz = mesh.position.z;
            
            // Build full OBB for collision detection
            const m = new THREE.Matrix4().makeRotationFromQuaternion(mesh.quaternion);
            const e = m.elements;
            const ux = e[0], uy = e[1], uz = e[2];
            const vx = e[4], vy = e[5], vz = e[6];
            const wx = e[8], wy = e[9], wz = e[10];
            const hx = sw/2, hy = sh/2, hz = sd/2;
            const exx = hx*Math.abs(ux)+hy*Math.abs(vx)+hz*Math.abs(wx);
            const eyy = hx*Math.abs(uy)+hy*Math.abs(vy)+hz*Math.abs(wy);
            const ezz = hx*Math.abs(uz)+hy*Math.abs(vz)+hz*Math.abs(wz);
            
            body._obb = {
                isOBB:true, cx,cy,cz, hx,hy,hz, ux,uy,uz, vx,vy,vz, wx,wy,wz,
                minX:cx-exx, maxX:cx+exx, minY:cy-eyy, maxY:cy+eyy, minZ:cz-ezz, maxZ:cz+ezz,
                _bodyRef: body,
                _meshRef: mesh
            };
        }
    });
}


function update(dt) {
    if (!character) return;

    // Update physics simulation
    updatePhysics(dt);

    // Handle dead state (void death)
    if (_dead) {
        _respawnTimer -= dt;
        if (_respawnTimer > 0 && _ragdollParts.length > 0) {
            const p = _ragdollParts[0].mesh;
            character.position.copy(p.position);
            character.position.y += CHAR_FOOT_OFFSET - CHAR_HEIGHT / 2;
            character.quaternion.copy(p.quaternion);
        }
        if (_respawnTimer <= 0) {
            _clearRagdoll();
            character.rotation.set(0, _spawnPoint.ry, 0);
            character.position.set(_spawnPoint.x, _spawnPoint.y + CHAR_FOOT_OFFSET, _spawnPoint.z);
            character.visible = true;
            _setLocalAvatarVisible(true);
            _dead = false;
            for (const fn of _respawnCallbacks) fn();
        }
        return;
    }

    // ── Climbing state ──────────────────────────────────────────────────────
    if (climbState === 'hanging') {
        const px0 = character.position.x, pz0 = character.position.z;
        let footY = character.position.y - CHAR_FOOT_OFFSET;

        const stillValid = findClimbableBlock(px0, pz0, footY, climbFwdX, climbFwdZ);
        if (!stillValid) { climbState = 'none'; climbCooldown = 0.25; if (finishClimbUpdate(dt)) return; }
        climbBlock  = stillValid;
        climbLedgeY = stillValid.maxY;

        if (shiftLock) {
            const grabAngle = Math.atan2(climbFwdX, climbFwdZ);
            const camAngle  = cam.yaw + Math.PI;
            const diff = ((camAngle - grabAngle) % (2*Math.PI) + 3*Math.PI) % (2*Math.PI) - Math.PI;
            if (Math.abs(diff) > Math.PI/4) { climbState = 'none'; climbCooldown = 0.25; velY = 0; if (finishClimbUpdate(dt)) return; }
            character.rotation.y = cam.yaw + Math.PI;
        } else {
            const faceAngle = Math.atan2(climbFwdX, climbFwdZ);
            character.rotation.y = lerpAngle(character.rotation.y, faceAngle, Math.min(1, ROT_SPEED * dt));
        }

        if (jumpBuffer > 0) {
            velY = CLIMB_JUMP_UP;
            extraVelX = -climbFwdX * CLIMB_JUMP_BACK_V;
            extraVelZ = -climbFwdZ * CLIMB_JUMP_BACK_V;
            climbState = 'none'; climbCooldown = 0; jumpBuffer = 0;
            if (finishClimbUpdate(dt)) return;
        }

        const pressW = !!(keys['KeyW'] || keys['ArrowUp']);
        const pressS = !!(keys['KeyS'] || keys['ArrowDown']);
        const rawVert = (pressW ? 1 : 0) - (pressS ? 1 : 0);
        const anyInput = rawVert !== 0;

        if (_worldFloorEnabled && rawVert < -0.1 && footY <= G_LEVEL + 0.15) {
            character.position.y = CHAR_STAND_Y;
            climbState = 'none'; climbCooldown = 0; velY = 0;
            if (finishClimbUpdate(dt)) return;
        }

        velY = 0;
        character.position.y += rawVert * CLIMB_RISE_SPEED * dt;
        footY = character.position.y - CHAR_FOOT_OFFSET;

        if (rawVert < 0 && footY < climbLedgeY - HANG_DEPTH) {
            const belowBlock = findChainBlockBelow(character.position.x, character.position.z, climbLedgeY);
            if (belowBlock) { climbBlock = belowBlock; climbLedgeY = belowBlock.maxY; }
            else { climbState = 'none'; climbCooldown = 0.1; velY = -2; if (finishClimbUpdate(dt)) return; }
        }

        if (_worldFloorEnabled && footY < G_LEVEL) {
            character.position.y = CHAR_STAND_Y;
            climbState = 'none'; climbCooldown = 0; velY = 0;
            if (finishClimbUpdate(dt)) return;
        }

        footY = character.position.y - CHAR_FOOT_OFFSET;
        if (footY >= climbLedgeY) {
            const chainBlock = findChainBlockAbove(character.position.x, character.position.z, climbLedgeY);
            if (chainBlock) { climbBlock = chainBlock; climbLedgeY = chainBlock.maxY; }
            else if (rawVert > 0.3) {
                character.position.x += climbFwdX * 0.4;
                character.position.z += climbFwdZ * 0.4;
                climbState = 'none'; velY = 2;
                if (finishClimbUpdate(dt)) return;
            } else {
                character.position.y = climbLedgeY + CHAR_FOOT_OFFSET;
            }
        }

        if (!anyInput) {
            const hangY = climbLedgeY - HANG_DEPTH + CHAR_FOOT_OFFSET;
            const stillAtTop = !findChainBlockAbove(character.position.x, character.position.z, climbLedgeY);
            if (stillAtTop && character.position.y > hangY) {
                const drop = Math.min(CLIMB_RISE_SPEED * 2 * dt, character.position.y - hangY);
                character.position.y -= drop;
            }
        }

        if (finishClimbUpdate(dt, anyInput)) return;
    }

    // ── Normal movement ─────────────────────────────────────────────────────
    const moveInput = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp'])    moveInput.z -= 1;
    if (keys['KeyS'] || keys['ArrowDown'])  moveInput.z += 1;
    if (keys['KeyA'])  moveInput.x -= 1;
    if (keys['KeyD']) moveInput.x += 1;

    // ── Arrow key camera rotation ──────────────────────────────────────────
    if (keys['ArrowLeft'])  cam.yaw += 0.05;
    if (keys['ArrowRight']) cam.yaw -= 0.05;

    if (joystickActive) {
        moveInput.x += joystickVector.x;
        moveInput.z += joystickVector.y;
    }

    _charMoving = moveInput.lengthSq() > 0;
    let velX = 0, velZ = 0;

    if (_charMoving) {
        moveInput.normalize();
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), cam.yaw);
        moveInput.applyQuaternion(yawQuat);
        velX = moveInput.x * WALK_SPEED;
        velZ = moveInput.z * WALK_SPEED;
        if (!shiftLock) {
            const targetAngle = Math.atan2(moveInput.x, moveInput.z);
            character.rotation.y = lerpAngle(character.rotation.y, targetAngle, Math.min(1, ROT_SPEED * dt));
        }
    }

    velX += extraVelX;
    velZ += extraVelZ;

    const sp2 = velX*velX + velZ*velZ;
    if (sp2 > WALK_SPEED*WALK_SPEED) {
        const sc = WALK_SPEED / Math.sqrt(sp2);
        velX *= sc; velZ *= sc;
    }

    // Axis-separated movement with per-axis wall blocking.
    // SWEEP_MARGIN contracts the cross-axis overlap test: a block must genuinely
    // overlap the character's side by more than this amount before it blocks
    // movement in the perpendicular axis. Without this, grazing a corner by
    // even 1 pixel would kill all movement in that direction (the "magnetic
    // wall edge" snap feel). The value is tuned to be invisible in gameplay
    // while still catching real collisions.
    const SWEEP_MARGIN = 0.06;
    {
        const fy0 = character.position.y - CHAR_FOOT_OFFSET;
        const acos = Math.abs(Math.cos(character.rotation.y));
        const asin = Math.abs(Math.sin(character.rotation.y));
        const halfX = CHAR_HALF_W*acos + CHAR_HALF_D*asin;
        const halfZ = CHAR_HALF_W*asin + CHAR_HALF_D*acos;
        const swNearby = getNearbyColliders(character.position.x, character.position.y, character.position.z);

        let dx = velX * dt;
        for (const b of swNearby) {
            if (b.maxY <= fy0+0.05 || b.minY >= fy0+CHAR_HEIGHT) continue;
            const stepNeeded = b.maxY - fy0;
            if (stepNeeded > 0 && stepNeeded <= STEP_HEIGHT && grounded && velY <= 0) continue;
            // Shrink cross-axis check by SWEEP_MARGIN to avoid corner-graze sticking
            if (character.position.z+halfZ <= b.minZ+SWEEP_MARGIN || character.position.z-halfZ >= b.maxZ-SWEEP_MARGIN) continue;
            if (dx > 0) {
                const edge = character.position.x + halfX;
                if (edge > b.minX) continue;
                const allow = b.minX - edge;
                if (allow < dx) dx = Math.max(0, allow);
            } else if (dx < 0) {
                const edge = character.position.x - halfX;
                if (edge < b.maxX) continue;
                const allow = b.maxX - edge;
                if (allow > dx) dx = Math.min(0, allow);
            }
        }
        character.position.x += dx;

        let dz = velZ * dt;
        for (const b of swNearby) {
            if (b.maxY <= fy0+0.05 || b.minY >= fy0+CHAR_HEIGHT) continue;
            const stepNeeded = b.maxY - fy0;
            if (stepNeeded > 0 && stepNeeded <= STEP_HEIGHT && grounded && velY <= 0) continue;
            // Shrink cross-axis check by SWEEP_MARGIN to avoid corner-graze sticking
            if (character.position.x+halfX <= b.minX+SWEEP_MARGIN || character.position.x-halfX >= b.maxX-SWEEP_MARGIN) continue;
            if (dz > 0) {
                const edge = character.position.z + halfZ;
                if (edge > b.minZ) continue;
                const allow = b.minZ - edge;
                if (allow < dz) dz = Math.max(0, allow);
            } else if (dz < 0) {
                const edge = character.position.z - halfZ;
                if (edge < b.maxZ) continue;
                const allow = b.maxZ - edge;
                if (allow > dz) dz = Math.min(0, allow);
            }
        }
        character.position.z += dz;
    }

    if (extraVelX !== 0 || extraVelZ !== 0) {
        const decay = Math.max(0, 1 - 2.5 * dt);
        extraVelX *= decay; extraVelZ *= decay;
        if (Math.abs(extraVelX) < 0.3) extraVelX = 0;
        if (Math.abs(extraVelZ) < 0.3) extraVelZ = 0;
    }

    if (shiftLock || _firstPerson) character.rotation.y = cam.yaw + Math.PI;

    climbCooldown = Math.max(0, climbCooldown - dt);

    const nearby = getNearbyColliders(character.position.x, character.position.y, character.position.z);

    resolveBlocksH(nearby);
    resolveOBBH(nearby, velX, velZ, dt);
    tryLedgeGrab(nearby);

    if (stepUpTarget > character.position.y) {
        const rise = Math.min(stepUpTarget - character.position.y, STEP_CLIMB_SPEED * dt);
        character.position.y += rise;
        velY = 0;
        grounded = true;
    }

    if (grounded) coyoteTimer = COYOTE_TIME;
    else          coyoteTimer = Math.max(0, coyoteTimer - dt);

    if (keys['Space']) jumpBuffer = JUMP_BUFFER_T;
    jumpBuffer = Math.max(0, jumpBuffer - dt);

    velY += GRAVITY * dt;
    character.position.y += velY * dt;

    grounded = false;
    if (_worldFloorEnabled && character.position.y <= CHAR_STAND_Y) {
        character.position.y = CHAR_STAND_Y;
        velY = 0;
        grounded = true;
        extraVelX = 0; extraVelZ = 0;
    }

    // Recompute nearby after Y changes from step-up and gravity
    const nearbyV = getNearbyColliders(character.position.x, character.position.y, character.position.z);
    resolveBlocksV(nearbyV);
    resolveOBBV(nearbyV);
    checkDynamicTouched();

    if (jumpBuffer > 0 && (grounded || coyoteTimer > 0)) {
        velY = JUMP_POWER;
        grounded = false;
        coyoteTimer = 0;
        jumpBuffer  = 0;
    }

    // Respawn if fallen off
    if (character.position.y < _respawnY) {
        _die();
    }

    updateEmote(dt);
    updateAnimations(dt, _charMoving);

    // Apply emote rotation offsets directly so axes not covered by setRot still work,
    // and to bypass lerp smoothing for frame-accurate keyframe playback
    for (const bName in anim.offset) {
        const bone = anim.bones[bName];
        if (!bone) continue;
        const rest = anim.rest[bName] || {};
        for (const axis in anim.offset[bName]) {
            bone.rotation[axis] = rest[axis] + anim.offset[bName][axis];
        }
    }
    // Apply emote position offsets
    for (const bName in anim.posOffset) {
        const bone = anim.bones[bName];
        if (!bone) continue;
        const rest = anim.rest[bName] || {};
        const off = anim.posOffset[bName];
        if (off.px != null) bone.position.x = rest.px + off.px;
        if (off.py != null) bone.position.y = rest.py + off.py;
        if (off.pz != null) bone.position.z = rest.pz + off.pz;
    }
}

// ─── Camera update ────────────────────────────────────────────────────────────
function updateCamera(fpDt) {
    if (!character) return;

    const sinYaw   = Math.sin(cam.yaw);
    const cosYaw   = Math.cos(cam.yaw);
    const sinPitch = Math.sin(cam.pitch);
    const cosPitch = Math.cos(cam.pitch);

    // Continuous blend: 0 at normal zoom, 1 when fully zoomed into head
    // Uses cam.distance (the actual lerped value) so blend and orbit position stay in sync
    const fpBlendTarget = THREE.MathUtils.clamp(
        1 - (cam.distance - cam.minDist) / FIRST_PERSON_RANGE,
        0, 1
    );
    _firstPersonBlend = THREE.MathUtils.lerp(_firstPersonBlend, fpBlendTarget, Math.min(1, FP_BLEND_SPEED * fpDt));

    // Orbit position (normal third person)
    const pivot = new THREE.Vector3(
        character.position.x,
        character.position.y + CAM_PIVOT_Y,
        character.position.z
    );
    if (shiftLock) {
        pivot.x += cosYaw * SHIFT_LOCK_OFFSET;
        pivot.z += -sinYaw * SHIFT_LOCK_OFFSET;
    }
    const orbitPos = new THREE.Vector3(
        pivot.x + cam.distance * cosPitch * sinYaw,
        pivot.y + cam.distance * sinPitch,
        pivot.z + cam.distance * cosPitch * cosYaw
    );

    // Camera collision: raycast from pivot toward orbitPos and push camera in
    const rayOrigin = pivot;
    const rayVec = new THREE.Vector3().copy(orbitPos).sub(pivot);
    const rayLen = rayVec.length();
    let finalPos = orbitPos;
    if (rayLen > 0.01) {
        const rayDir = rayVec.clone().normalize();
        let minHitT = rayLen;
        const candidates = getCollidersAlongRay(pivot.x, pivot.y, pivot.z, orbitPos.x, orbitPos.y, orbitPos.z);
        for (const c of candidates) {
            const t = c.isOBB ? rayVsOBB(rayOrigin, rayDir, c) : rayVsAABB(rayOrigin, rayDir, c);
            if (t !== null && t > 0.3 && t < minHitT) {
                minHitT = t;
            }
        }
        if (minHitT < rayLen) {
            finalPos = rayOrigin.clone().add(rayDir.multiplyScalar(Math.max(minHitT - 0.15, 0)));
        }
    }

    // Head position (only computed when blend is active)
    let headPos = null;
    if (_firstPersonBlend > 0.001) {
        const headAttachment = _findHeadAttachment(character);
        if (headAttachment?.object) {
            headPos = new THREE.Vector3();
            headAttachment.object.getWorldPosition(headPos);
            headPos.y += 0.3;
        }
    }

    // Blend camera position
    if (headPos && _firstPersonBlend > 0.001) {
        camera.position.lerpVectors(finalPos, headPos, _firstPersonBlend);
        // Negate orbit direction so camera looks forward, not backward at pivot
        const lookDir = new THREE.Vector3(
            -cosPitch * sinYaw,
            -sinPitch,
            -cosPitch * cosYaw
        );
        camera.lookAt(camera.position.clone().add(lookDir));
    } else {
        camera.position.copy(finalPos);
        camera.lookAt(pivot);
    }

    // Smooth character opacity fade based on blend amount
    const opacity = 1 - _firstPersonBlend;
    _setLocalAvatarOpacity(opacity);
    character.visible = opacity > 0.0001;
    if (opacity > 0.0001) {
        _setLocalAvatarVisible(true);
    } else {
        _setLocalAvatarVisible(false);
    }

    // Toggle mouse-look state (no right-click needed, cursor hidden)
    if (_firstPersonBlend > 0.99 && !_firstPerson) {
        _firstPerson = true;
        if (!shiftLock) cursorEl.style.display = 'none';
    } else if (_firstPersonBlend < 0.01 && _firstPerson) {
        _firstPerson = false;
        if (!shiftLock) cursorEl.style.display = 'block';
    }
}

function _die() {
    if (_dead || !character) return;
    character.visible = false;
    _setLocalAvatarVisible(false);
    velY = 0; extraVelX = 0; extraVelZ = 0;
    _dead = true;
    _respawnTimer = 5;
    for (const fn of _deathCallbacks) fn();
}

const _ragdollParts = [];

function _clearRagdoll() {
    for (const entry of _ragdollParts) {
        if (entry.body) {
            physicsWorld.removeBody(entry.body);
            physicsBodies.delete(entry.mesh);
        }
        if (entry.mesh.parent) entry.mesh.removeFromParent();
        entry.mesh.geometry?.dispose();
        const mats = Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material];
        for (const m of mats) m?.dispose();
    }
    _ragdollParts.length = 0;
}

// ─── Ragdoll death config ──────────────────────────────────────────────────────
const RAGDOLL_VEL_XZ = 30;        // horizontal velocity
const RAGDOLL_VEL_Y_BASE = 20;    // upward velocity base
const RAGDOLL_VEL_Y_RANDOM = 4;  // upward velocity random add
const RAGDOLL_ANG_VEL_MAX = 30;  // max angular velocity on all axes

function _dieRagdoll() {
    if (_dead || !character) return;
    _clearRagdoll();
    const bb = new THREE.Box3().setFromObject(character);
    const center = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const sw = Math.max(size.x, 0.5), sh = Math.max(size.y, 0.5), sd = Math.max(size.z, 0.5);
    const proxy = new THREE.Mesh(getCachedGeo(sw, sh, sd), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.userData.canCollide = false;
    proxy.position.copy(center);
    proxy.quaternion.copy(character.quaternion);
    scene.add(proxy);
    const cannonShape = new CANNON.Box(new CANNON.Vec3(sw / 2, sh / 2, sd / 2));
    const body = new CANNON.Body({ mass: 0.1, shape: cannonShape });
    body.linearDamping = 0.01;
    body.angularDamping = 0.01;
    body.sleepSpeedLimit = 0;
    body.position.set(center.x, center.y, center.z);
    body.quaternion.set(character.quaternion.x, character.quaternion.y, character.quaternion.z, character.quaternion.w);
    const angle = Math.random() * 2 * Math.PI;
    body.velocity.set(Math.cos(angle) * RAGDOLL_VEL_XZ, RAGDOLL_VEL_Y_BASE + Math.random() * RAGDOLL_VEL_Y_RANDOM, Math.sin(angle) * RAGDOLL_VEL_XZ);
    body.angularVelocity.set((Math.random() - 0.5) * RAGDOLL_ANG_VEL_MAX * 2, (Math.random() - 0.5) * RAGDOLL_ANG_VEL_MAX * 2, (Math.random() - 0.5) * RAGDOLL_ANG_VEL_MAX * 2);
    physicsWorld.addBody(body);
    physicsBodies.set(proxy, { body, anchored: false, mesh: proxy });
    _ragdollParts.push({ mesh: proxy, body });
    velY = 0; extraVelX = 0; extraVelZ = 0;
    _dead = true;
    _respawnTimer = 5;
    for (const fn of _deathCallbacks) fn();
}

// ─── Public API ───────────────────────────────────────────────────────────────
window._mapParts = [];

window._bloxverse = {
    scene,
    getCharacter:  () => character,
    cloneCharacter(name, x, y, z) {
        if (!character) return null;
        const clone = SkeletonUtils.clone(character);
        clone.traverse(child => {
            if ((child.isBone || child.type === 'Bone') && anim.rest[child.name]) {
                const r = anim.rest[child.name];
                child.rotation.set(r.x, r.y, r.z);
                child.position.set(r.px, r.py, r.pz);
            }
            if (child.isMesh) {
                child.geometry = child.geometry.clone();
                child.frustumCulled = false;
                child.castShadow = true;
                child.receiveShadow = true;
                if (Array.isArray(child.material)) {
                    child.material = child.material.map(m => m.clone());
                } else if (child.material) {
                    child.material = child.material.clone();
                }
            }
        });
        clone.position.set(x, y ?? 0, z ?? 0);
        clone.name = name || 'CharacterClone';
        clone.visible = true;
        const cloneId = 'clone_' + (name || 'bot');
        clone.userData.cloneUserId = cloneId;
        const storedData = _playerAvatarData.get(currentUserId);
        if (storedData) {
            _applyColorsToModel(clone, storedData.colors);
            _applyClothingToModel(clone, storedData.clothing);
            _applyAccessoriesToModel(cloneId, clone, storedData.accessories);
            _applyFaceToModel(clone, storedData.face);
        }
        scene.add(clone);
        if (!window._characterClones) window._characterClones = [];
        window._characterClones.push(clone);
        return clone;
    },
    removeCharacterClone(clone) {
        if (!clone) return;
        if (clone.userData?.cloneUserId) {
            _clearPlayerAccessories(clone.userData.cloneUserId);
        }
        scene.remove(clone);
        if (window._characterClones) {
            const idx = window._characterClones.indexOf(clone);
            if (idx !== -1) window._characterClones.splice(idx, 1);
        }
        clone.traverse(child => {
            if (child.isMesh) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else if (child.material) child.material.dispose();
            }
        });
    },
    rotateCharacterClone(clone, ry) {
        if (clone) clone.rotation.y = ry;
    },
    moveCharacterClone(clone, x, y, z) {
        if (clone) clone.position.set(x, y, z);
    },
    checkCollision(x, y, z, w, h, d) {
        const halfW = w / 2, halfH = h / 2, halfD = d / 2;
        const nearby = getNearbyColliders(x, y, z);
        for (const c of nearby) {
            if (c._bodyRef) continue;
            if (c.isOBB) {
                const dx = x - c.cx, dy = y - c.cy, dz = z - c.cz;
                const lx = Math.abs(dx * c.ux + dy * c.uy + dz * c.uz);
                const ly = Math.abs(dx * c.vx + dy * c.vy + dz * c.vz);
                const lz = Math.abs(dx * c.wx + dy * c.wy + dz * c.wz);
                if (lx <= c.hx + halfW && ly <= c.hy + halfH && lz <= c.hz + halfD) return true;
            } else {
                if (c.minX <= x + halfW && c.maxX >= x - halfW &&
                    c.minY <= y + halfH && c.maxY >= y - halfH &&
                    c.minZ <= z + halfD && c.maxZ >= z - halfD) {
                    return true;
                }
            }
        }
        return false;
    },
    getCameraYaw() { return cam.yaw; },
    getGrounded:   () => grounded,
    getVelY:       () => velY,
    getClimbState: () => climbState,
    playEmote(id) {
        const def = findEmote(id);
        if (!def) return false;
        if (anim.emote) {
            clearEmoteOffsets(anim.emote.def);
        }
        anim.emote = { def, timer: 0 };
        return true;
    },
    stopEmote() {
        if (!anim.emote) return;
        clearEmoteOffsets(anim.emote.def);
        anim.emote = null;
    },
    playOtherPlayerEmote(userId, def) {
        const p = otherPlayers.get(userId);
        if (!p) return;
        if (p._emote) _resetRemoteBonesToRest(p);
        p._emote = { def, time: 0 };
    },
    setFlingVelocity(vx, vy, vz) {
        extraVelX = vx;
        extraVelZ = vz;
        velY = vy;
        grounded = false;
    },
    _setPartBounciness(mesh, restitution) {
        const entry = physicsBodies.get(mesh);
        if (entry && entry.body) {
            entry.body._bounciness = restitution;
        }
    },
    _setPartTexture(mesh, url) {
        if (!mesh) return;
        const loader = new THREE.TextureLoader();
        loader.load(url, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            mesh.traverse(child => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(mat => {
                        mat.map = tex;
                        mat.color.set(0xffffff); // reset tint so texture shows true colors
                        mat.needsUpdate = true;
                    });
                }
            });
        }, undefined, (err) => console.warn('[SetTexture] Failed to load texture:', url, err));
    },
    keys,
    setSens(mult) {
        CAM_H_SENS = 0.002 * Math.PI * mult;
        CAM_V_SENS = 0.0015 * Math.PI * mult;
    },
    setWalkSpeed(speed) { WALK_SPEED = speed; },
    getWalkSpeed() { return WALK_SPEED; },
    requestLock() { renderer.domElement.requestPointerLock(); },
    async _renderThumbnail() {
      if (!character) return null;
      const clone = SkeletonUtils.clone(character);
      const tempScene = new THREE.Scene();
      tempScene.background = new THREE.Color(0x000000);
      const ambient = new THREE.AmbientLight(0xffffff, 0.8);
      tempScene.add(ambient);
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
      dirLight.position.set(4, 6, 8);
      tempScene.add(dirLight);
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
      fillLight.position.set(-3, 2, -4);
      tempScene.add(fillLight);
      clone.position.set(0, 0, 0);
      tempScene.add(clone);
      clone.updateMatrixWorld(true);

      const target = new THREE.WebGLRenderTarget(256, 256, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

      const thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      thumbCam.position.set(5, 5, 11);
      thumbCam.lookAt(0, 2.8, 0);

      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(tempScene, thumbCam);

      const pixels = new Uint8Array(256 * 256 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
      renderer.setRenderTarget(prevTarget);

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(256, 256);
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const srcIdx = (y * 256 + x) * 4;
          const dstIdx = ((255 - y) * 256 + x) * 4;
          imageData.data[dstIdx]     = pixels[srcIdx];
          imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
          imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
          imageData.data[dstIdx + 3] = pixels[srcIdx + 3];
        }
      }
      ctx.putImageData(imageData, 0, 0);

      target.dispose();
      tempScene.remove(clone);
      clone.traverse(child => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material?.dispose();
        }
      });

      return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    },
    _disableShiftLock() {
        if (shiftLock) {
            shiftLock = false;
            shiftLockIndicator?.classList.remove('visible');
            cursorEl.style.display = 'block';
            cursorX = window.innerWidth / 2;
            cursorY = window.innerHeight / 2;
            updateCursorPos();
            if (character) {
                character.rotation.y = ((character.rotation.y % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
                if (character.rotation.y > Math.PI) character.rotation.y -= 2*Math.PI;
            }
        }
    },
    addStud(sw, sh, sd, color, x, y, z, rx = 0, ry = 0, rz = 0, anchored = true, shape = 'Block', bodyMass) {
        const mesh = addStud(sw, sh, sd, color, x, y, z, rx, ry, rz, anchored, shape, bodyMass);
        if (mesh) {
            window._mapParts.push({ name: '', mesh });
        }
        return mesh;
    },
    removePart(name) {
        for (let i = window._mapParts.length - 1; i >= 0; i--) {
            if (window._mapParts[i].name === name) {
                const entry = window._mapParts[i];
                const mesh = entry.mesh;
                const phys = physicsBodies.get(mesh);
                if (phys) {
                    physicsWorld.removeBody(phys.body);
                    physicsBodies.delete(mesh);
                }
                // Remove collider from colliders array and chunkMap
                for (let ci = colliders.length - 1; ci >= 0; ci--) {
                    if (colliders[ci]._meshRef === mesh) {
                        const b = colliders[ci];
                        colliders.splice(ci, 1);
                        const x0 = worldToChunk(b.minX), x1 = worldToChunk(b.maxX);
                        const y0 = worldToChunk(b.minY), y1 = worldToChunk(b.maxY);
                        const z0 = worldToChunk(b.minZ), z1 = worldToChunk(b.maxZ);
                        for (let cx = x0; cx <= x1; cx++)
                            for (let cy = y0; cy <= y1; cy++)
                                for (let cz = z0; cz <= z1; cz++) {
                                    const key = chunkKey(cx, cy, cz);
                                    const bucket = chunkMap.get(key);
                                    if (bucket) { bucket.delete(b); if (bucket.size === 0) chunkMap.delete(key); }
                                }
                    }
                }
                scene.remove(mesh);
                mesh.geometry?.dispose();
                if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                else mesh.material?.dispose();
                window._mapParts.splice(i, 1);
            }
        }
    },
    async loadMap(path, tx = 0, ty = 0, tz = 0) {
        const data = await fetch(path).then(r => r.json());
        // Handle both old format (array) and new format (object with parts/scripts)
        const parts = Array.isArray(data) ? data : (data.parts || []);
        const scripts = (!Array.isArray(data) && data.scripts) ? data.scripts : [];
        
        const valid = parts.filter(p => p.Type === 'Part' && (p.Shape === 'Block' || p.Shape === 'Ball'));
        if (!valid.length) return;
        let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
        for (const p of valid) {
            const [px,py,pz] = p.Position, [sw,sh,sd] = p.Size;
            minX=Math.min(minX,px-sw/2); maxX=Math.max(maxX,px+sw/2);
            minY=Math.min(minY,py-sh/2); maxY=Math.max(maxY,py+sh/2);
            minZ=Math.min(minZ,pz-sd/2); maxZ=Math.max(maxZ,pz+sd/2);
        }
        const ox=tx-(minX+maxX)/2, oy=G_LEVEL-minY, oz=tz-(minZ+maxZ)/2;
        
        // Remove previously loaded parts' colliders from chunkMap and colliders
        const oldMeshes = new Set((window._mapParts || []).map(e => e.mesh).filter(Boolean));
        if (oldMeshes.size > 0) {
            for (let i = colliders.length - 1; i >= 0; i--) {
                const b = colliders[i];
                if (b._meshRef && oldMeshes.has(b._meshRef)) {
                    colliders.splice(i, 1);
                    const x0 = worldToChunk(b.minX), x1 = worldToChunk(b.maxX);
                    const y0 = worldToChunk(b.minY), y1 = worldToChunk(b.maxY);
                    const z0 = worldToChunk(b.minZ), z1 = worldToChunk(b.maxZ);
                    for (let cx = x0; cx <= x1; cx++)
                        for (let cy = y0; cy <= y1; cy++)
                            for (let cz = z0; cz <= z1; cz++) {
                                const key = chunkKey(cx, cy, cz);
                                const bucket = chunkMap.get(key);
                                if (bucket) { bucket.delete(b); if (bucket.size === 0) chunkMap.delete(key); }
                            }
                }
            }
        }

        // Remove any previously loaded point lights
        if (window._mapPointLights) {
            for (const pl of window._mapPointLights) {
                scene.remove(pl.light);
            }
            window._mapPointLights = null;
        }

        // Remove any previously loaded parts from the scene
        for (const entry of window._mapParts || []) {
            if (entry.mesh) {
                scene.remove(entry.mesh);
                const pb = physicsBodies.get(entry.mesh);
                if (pb) { physicsWorld.removeBody(pb.body); physicsBodies.delete(entry.mesh); }
                if (Array.isArray(entry.mesh.material)) entry.mesh.material.forEach(m => m.dispose());
                else entry.mesh.material?.dispose();
                entry.mesh.geometry?.dispose();
            }
        }
        // Store part info for later physics reference
        const partMap = new Map();
        window._mapParts = [];
        
        for (const p of valid) {
            const [sw,sh,sd]=p.Size, [px,py,pz]=p.Position, [rx,ry,rz]=p.Rotation;
            const color = resolvePartColor(p.Color);
            const anchored = p.Anchored !== false;
            const shape = p.Shape || 'Block';
            const canCollide = p.CanCollide !== false;
            const partMass = p.Mass != null ? p.Mass : computeMass(sw, sh, sd, shape);
            const mesh = addStud(sw,sh,sd,color,px+ox,(py-sh/2)+oy,pz+oz,rx*DEG2RAD,ry*DEG2RAD,rz*DEG2RAD,anchored,shape,partMass,canCollide);
            const partName = p.Name || `Part_${px}_${py}_${pz}`;
            mesh.userData.physicsId = partName;
            mesh.name = partName;
            mesh.userData.partName = partName;
            window._mapParts.push({ name: partName, mesh });

            // Create a PartInstance and register it in the workspace instance hierarchy
            // so Lua scripts can find it by name via workspace:WaitForChild() / workspace.PartName
            const workspaceInst = _gameRef?.Children?.find(c => c.ClassName === 'Workspace');
            if (workspaceInst) {
                const partInst = Instance.new('Part', partName);
                partInst.mesh = mesh;
                mesh._instRef = partInst;
                partInst.setParent(workspaceInst);
            } else {
                // _gameRef not set yet — defer wiring until it is
                mesh._pendingInstName = partName;
            }

            applyMeshTransparency(mesh, p.Transparency || 0);
            partMap.set(partName, { mesh, anchored, canCollide, size: [sw,sh,sd], worldPos: [px+ox,py+oy,pz+oz], rotation: [rx,ry,rz] });
        }

        // Create PointLights attached to parts (capped to avoid shader uniform overflow)
        const MAX_POINT_LIGHTS = 16;
        const pointLights = [];
        for (const p of valid) {
            if (p.PointLight && pointLights.length < MAX_POINT_LIGHTS) {
                const name = p.Name || `Part_${p.Position[0]}_${p.Position[1]}_${p.Position[2]}`;
                const entry = partMap.get(name);
                if (entry) {
                    const pl = p.PointLight;
                    const light = new THREE.PointLight(
                        pl.Color ? new THREE.Color(pl.Color[0], pl.Color[1], pl.Color[2]) : 0xffffff,
                        pl.Brightness != null ? pl.Brightness : 1,
                        pl.Range != null ? pl.Range : 16
                    );
                    light.position.copy(entry.mesh.position);
                    light.castShadow = false; // point light shadows are expensive
                    light.visible = pl.Enabled !== false;
                    scene.add(light);
                    pointLights.push({ parentMesh: entry.mesh, light });
                }
            }
        }
        // Store for cleanup
        window._mapPointLights = pointLights;

        // Apply lighting data (Sky/Atmosphere) if present
        if (data.lighting) {
            if (data.lighting.Sky) {
                const s = data.lighting.Sky;
                if (s.SkyboxColor) scene.background = new THREE.Color(s.SkyboxColor[0], s.SkyboxColor[1], s.SkyboxColor[2]);
                if (s.SunColor) {
                    const sun = scene.children.find(c => c.isDirectionalLight && c.position.y > 50);
                    if (sun) sun.color.setRGB(s.SunColor[0], s.SunColor[1], s.SunColor[2]);
                }
                if (s.Brightness != null) {
                    const sun = scene.children.find(c => c.isDirectionalLight && c.position.y > 50);
                    if (sun) sun.intensity = s.Brightness * 2;
                }
            }
            if (data.lighting.Atmosphere) {
                const a = data.lighting.Atmosphere;
                if (scene.fog && a.FogColor) scene.fog.color.setRGB(a.FogColor[0], a.FogColor[1], a.FogColor[2]);
                if (scene.fog && a.Density != null) scene.fog.far = 600 - a.Density * 500;
            }
        }

        // Store scripts for execution (in game context, they would be executed server-side or client-side as appropriate)
        if (scripts.length > 0) {
            console.log(`[BloxVerse] Loaded ${scripts.length} scripts from map. Scripts execution requires server-side support.`);
            // Store scripts in a map for potential future use
            window._mapScripts = scripts;
        }
        
        // Prefer explicit spawn metadata exported at the top of the JSON.
        const spawnData = !Array.isArray(data) ? (data.SpawnLocation || data.spawnLocation || data.spawn) : null;
        let spawnFound = false;
        if (spawnData) {
            const spawnPos = spawnData.Position || spawnData.position;
            const spawnRot = spawnData.Rotation || spawnData.rotation;
            if (Array.isArray(spawnPos) && spawnPos.length >= 3) {
                const spawnPart = partMap.get('SpawnLocation');
                const topOffset = spawnPart?.size?.[1] ? spawnPart.size[1] / 2 : 0;
                const spawnRy = Array.isArray(spawnRot) && spawnRot.length >= 2 ? spawnRot[1] * DEG2RAD : Math.PI;
                _spawnPoint = { x: spawnPos[0] + ox, y: spawnPos[1] + oy + topOffset, z: spawnPos[2] + oz, ry: spawnRy };
                spawnFound = true;
            }
        }
        if (!spawnFound) {
            // Backward compatibility for older exports where SpawnLocation was only a named part.
            for (const [name, entry] of partMap) {
                if (name === 'SpawnLocation') {
                    const spawnRy = entry.rotation ? entry.rotation[1] * DEG2RAD : Math.PI;
                    _spawnPoint = { x: entry.worldPos[0], y: entry.worldPos[1] + entry.size[1] / 2, z: entry.worldPos[2], ry: spawnRy };
                    spawnFound = true;
                    break;
                }
            }
        }
        if (!spawnFound) {
            // Spawn above the map so gravity drops the character cleanly onto the
            // surface — avoids initial overlap with blocks whose minY = G_LEVEL.
            _spawnPoint = { x: tx, y: G_LEVEL + CHAR_HEIGHT + 2, z: tz + 4, ry: Math.PI };
        }
        if (character) {
            character.position.set(_spawnPoint.x, _spawnPoint.y + CHAR_FOOT_OFFSET, _spawnPoint.z);
            character.rotation.y = _spawnPoint.ry;
        }
    },
    async loadJSMap(path) {
        const resp = await fetch(path);
        const jsCode = await resp.text();
        const config = {
            character: { position: { x: 0, y: 0, z: 0, ry: Math.PI } },
            worldFloor: true,
            respawnY: null,
            effects: {},
            loadMap: async (mapPath, ox, oy, oz) => {
                await this.loadMap(mapPath, ox ?? 0, oy ?? 0, oz ?? 0);
            },
        };
        const fn = new Function('character', 'loadMap', 'worldFloor', 'respawnY', 'effects', 'addStud', 'G', 'THREE', 'scene', jsCode);
        fn(config.character, config.loadMap, config.worldFloor, config.respawnY, config.effects, addStud, G_LEVEL, THREE, scene);
        if (config.character.position.x !== 0 || config.character.position.y !== 0 || config.character.position.z !== 0 || config.character.position.ry !== Math.PI) {
            this.setSpawn(config.character.position.x, config.character.position.y, config.character.position.z, config.character.position.ry);
        }
        if (config.worldFloor !== true) this.setWorldFloorEnabled(config.worldFloor);
        if (config.respawnY != null) this.setRespawnY(config.respawnY);
        window._mapConfig = config;
    },
    getCamera: () => camera,
    getCharHeight:     () => CHAR_HEIGHT,
    getCharFootOffset: () => CHAR_FOOT_OFFSET,
    getCharBubbleBase: () => CHAR_HEIGHT - CHAR_FOOT_OFFSET + 0.4,
    showBubble: (id, text) => _showBubble(id, text),
    setCurrentUserId: (id) => { currentUserId = id; },
    getCurrentUserId: () => currentUserId,
    setSpawn(x, y, z, ry = Math.PI) {
        _spawnPoint = { x, y, z, ry };
        if (character) {
            character.position.set(x, y + CHAR_FOOT_OFFSET, z);
            character.rotation.y = ry;
        }
    },
    setWorldFloorEnabled(enabled) {
        _worldFloorEnabled = enabled !== false;
    },
    setRespawnY(y) {
        if (Number.isFinite(y)) _respawnY = y;
    },
    isDead: () => _dead,
    killPlayer: () => _dieRagdoll(),
    onRespawn(fn) { _respawnCallbacks.push(fn); },
    onDeath(fn) { _deathCallbacks.push(fn); },
    _charInstance: null,
    setCharInstance: (inst) => { window._bloxverse._charInstance = inst; },
    
    _updateNonMeshInstances: (game) => {
        const audioListener = camera.children.find(c => c instanceof THREE.AudioListener) || new THREE.AudioListener();
        if (!audioListener.parent) camera.add(audioListener);

        const workspace = game.Children.find(c => c.ClassName === 'Workspace');
        if (!workspace) return;

        function traverse(inst) {
            if (inst.ClassName === 'PointLight') {
                const inWorkspace = true; // since we start traverse from workspace below
                if (!inst._engineRef) {
                    inst._engineRef = new THREE.PointLight(inst.Color, inst.Brightness, inst.Range);
                    inst._engineRef.castShadow = inst.Shadows;
                    scene.add(inst._engineRef);
                }
                inst._engineRef.visible = inst.Enabled !== false;
                inst._engineRef.color.copy(inst.Color);
                inst._engineRef.intensity = inst.Brightness;
                inst._engineRef.distance = inst.Range;
                // Inherit position from parent if parent is a part
                if (inst.Parent && inst.Parent.ClassName === 'Part' && inst.Parent.mesh) {
                    inst._engineRef.position.copy(inst.Parent.mesh.position);
                }
            } else if (inst.ClassName === 'Sound') {
                if (!inst._engineRef) {
                    const sound = new THREE.PositionalAudio(audioListener);
                    inst._engineRef = sound;
                    scene.add(sound);
                    
                    // Hook into instance methods
                    inst.onPlay = () => {
                        if (inst.SoundId) {
                            const loader = new THREE.AudioLoader();
                            loader.load(inst.SoundId, (buffer) => {
                                sound.setBuffer(buffer);
                                sound.setRefDistance(20);
                                sound.setLoop(inst.Looped);
                                sound.setVolume(inst.Volume);
                                sound.play();
                            });
                        }
                    };
                    inst.onStop = () => { if (sound.isPlaying) sound.stop(); };
                }
                if (inst.Parent && inst.Parent.ClassName === 'Part' && inst.Parent.mesh) {
                    inst._engineRef.position.copy(inst.Parent.mesh.position);
                }
            }
            inst.Children.forEach(traverse);
        }
        traverse(workspace);
    },

    _updateGuiInstances: (game) => {
        _gameRef = game;

        // Wire up any parts created by loadMap before _gameRef was set
        const workspaceInst = game.Children.find(c => c.ClassName === 'Workspace');
        if (workspaceInst) {
            for (const entry of window._mapParts || []) {
                const mesh = entry.mesh;
                if (mesh && mesh._pendingInstName && !mesh._instRef) {
                    const partInst = Instance.new('Part', mesh._pendingInstName);
                    partInst.mesh = mesh;
                    mesh._instRef = partInst;
                    partInst.setParent(workspaceInst);
                    delete mesh._pendingInstName;
                }
            }
        }

        const starterGui = game.Children.find(c => c.ClassName === 'StarterGui');
        if (!starterGui) return;

        function traverse(inst, parentEl) {
            if (inst.ClassName === 'ScreenGui') {
                if (!inst._engineRef) {
                    const el = document.createElement('div');
                    el.id = 'gui-' + inst.Name;
                    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1000;';
                    document.body.appendChild(el);
                    inst._engineRef = el;
                }
                inst._engineRef.style.display = (inst.Enabled !== false) ? 'block' : 'none';
                parentEl = inst._engineRef;
            } else if (inst.ClassName === 'SurfaceGui') {
                if (!window._surfaceGuis) window._surfaceGuis = new Map();
                window._surfaceGuis.set(inst._surfaceGuiId || (inst._surfaceGuiId = 'sg-' + Math.random().toString(36).slice(2)), inst);
                parentEl = null;
            } else if (inst.ClassName === 'Frame' || inst.ClassName === 'TextLabel' || inst.ClassName === 'TextButton') {
                if (!inst._engineRef && parentEl && parentEl !== document.body) {
                    const tag = (inst.ClassName === 'TextButton') ? 'button' : 'div';
                    const el = document.createElement(tag);
                    el.style.cssText = 'position:absolute;box-sizing:border-box;border:none;outline:none;';
                    if (inst.ClassName === 'TextButton') {
                        el.style.cursor = 'pointer';
                        el.onclick = () => { if (inst.MouseButton1Click) inst.MouseButton1Click.Fire(); };
                    }
                    parentEl.appendChild(el);
                    inst._engineRef = el;
                }
                if (inst._engineRef) {
                    const el = inst._engineRef;
                    el.style.display = (inst.Visible !== false) ? 'block' : 'none';
                    
                    const bgAlpha = 1 - (inst.BackgroundTransparency || 0);
                    if (bgAlpha <= 0) {
                        el.style.backgroundColor = 'transparent';
                    } else if (bgAlpha >= 1) {
                        el.style.backgroundColor = inst.BackgroundColor ? '#' + inst.BackgroundColor.getHexString() : (inst.ClassName === 'Frame' ? '#333' : 'transparent');
                    } else {
                        const c = inst.BackgroundColor;
                        if (c) {
                            el.style.backgroundColor = 'rgba(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ',' + bgAlpha + ')';
                        } else {
                            el.style.backgroundColor = 'transparent';
                        }
                    }
                    
                    if (inst.ClassName !== 'Frame') {
                        el.textContent = inst.Text || '';
                        const tc = inst.TextColor;
                        const tAlpha = 1 - (inst.TextTransparency || 0);
                        if (tc && tAlpha < 1 && tAlpha > 0) {
                            el.style.color = 'rgba(' + Math.round(tc.r * 255) + ',' + Math.round(tc.g * 255) + ',' + Math.round(tc.b * 255) + ',' + tAlpha + ')';
                        } else if (tAlpha <= 0) {
                            el.style.color = 'transparent';
                        } else {
                            el.style.color = tc ? '#' + tc.getHexString() : '#fff';
                        }
                        el.style.fontSize = (inst.FontSize || 14) + 'px';
                        el.style.display = 'flex';
                        el.style.alignItems = 'center';
                        el.style.justifyContent = 'center';
                    }

                    const px = inst.Position ? inst.Position[0] : 0;
                    const py = inst.Position ? inst.Position[1] : 0;
                    const sx = inst.Size ? inst.Size[0] : 100;
                    const sy = inst.Size ? inst.Size[1] : 50;

                    el.style.left = (px >= 0 && px <= 1) ? (px * 100 + '%') : (px + 'px');
                    el.style.top = (py >= 0 && py <= 1) ? (py * 100 + '%') : (py + 'px');
                    el.style.width = (sx >= 0 && sx <= 1) ? (sx * 100 + '%') : (sx + 'px');
                    el.style.height = (sy >= 0 && sy <= 1) ? (sy * 100 + '%') : (sy + 'px');
                }
            }
            inst.Children.forEach(c => traverse(c, parentEl));
        }
        traverse(starterGui, document.body);
    },
    // Part manipulation helpers for the scripting proxy
    _getPartEntry(mesh) { return physicsBodies.get(mesh) || null; },
    _setPartPos(mesh, x, y, z, skipCollision) {
        mesh.position.set(x, y, z);
        const entry = physicsBodies.get(mesh);
        if (entry) entry.body.position.set(x, y, z);
        if (!skipCollision) this._activatePartCollider(mesh);
    },
    _setPartRotation(mesh, ry) {
        mesh.rotation.y = ry;
        const entry = physicsBodies.get(mesh);
        if (entry) {
            const quat = new CANNON.Quaternion();
            quat.setFromEuler(0, ry, 0);
            entry.body.quaternion = quat;
        }
        this._activatePartCollider(mesh);
    },
    _setPartRotationOnly(mesh, ry) {
        mesh.rotation.y = ry;
        const entry = physicsBodies.get(mesh);
        if (entry) {
            const quat = new CANNON.Quaternion();
            quat.setFromEuler(0, ry, 0);
            entry.body.quaternion = quat;
        }
    },
    _deactivatePartCollider(mesh) {
        for (let i = colliders.length - 1; i >= 0; i--) {
            if (colliders[i]._meshRef === mesh) {
                const old = colliders[i];
                const x0 = worldToChunk(old.minX), x1 = worldToChunk(old.maxX);
                const y0 = worldToChunk(old.minY), y1 = worldToChunk(old.maxY);
                const z0 = worldToChunk(old.minZ), z1 = worldToChunk(old.maxZ);
                for (let cx = x0; cx <= x1; cx++)
                    for (let cy = y0; cy <= y1; cy++)
                        for (let cz = z0; cz <= z1; cz++) {
                            const key = chunkKey(cx, cy, cz);
                            const bucket = chunkMap.get(key);
                            if (bucket) { bucket.delete(old); if (bucket.size === 0) chunkMap.delete(key); }
                        }
                colliders.splice(i, 1);
            }
        }
    },
    _activatePartCollider(mesh) {
        this._deactivatePartCollider(mesh);
        const hs = mesh.userData?.halfSize;
        if (!hs) return;
        if (mesh.userData?.canCollide === false) return;
        const sw = hs.sw, sh = hs.sh, sd = hs.sd;
        const pos = mesh.position;
        const rx = mesh.rotation.x || 0, ry = mesh.rotation.y || 0, rz = mesh.rotation.z || 0;
        let b;
        if (rx === 0 && ry === 0 && rz === 0) {
            b = {
                minX: pos.x - sw / 2, maxX: pos.x + sw / 2,
                minY: pos.y - sh / 2, maxY: pos.y + sh / 2,
                minZ: pos.z - sd / 2, maxZ: pos.z + sd / 2,
                _meshRef: mesh
            };
        } else {
            b = buildOBB(sw, sh, sd, pos.x, pos.y, pos.z, rx, ry, rz);
            b._meshRef = mesh;
        }
        for (let i = colliders.length - 1; i >= 0; i--) {
            if (colliders[i]._meshRef === mesh) {
                const old = colliders[i];
                const x0 = worldToChunk(old.minX), x1 = worldToChunk(old.maxX);
                const y0 = worldToChunk(old.minY), y1 = worldToChunk(old.maxY);
                const z0 = worldToChunk(old.minZ), z1 = worldToChunk(old.maxZ);
                for (let cx = x0; cx <= x1; cx++)
                    for (let cy = y0; cy <= y1; cy++)
                        for (let cz = z0; cz <= z1; cz++) {
                            const key = chunkKey(cx, cy, cz);
                            const bucket = chunkMap.get(key);
                            if (bucket) { bucket.delete(old); if (bucket.size === 0) chunkMap.delete(key); }
                        }
                Object.assign(old, b);
                insertToChunks(old);
                return;
            }
        }
        colliders.push(b);
        insertToChunks(b);
    },
    _setPartVelocity(mesh, vx, vy, vz) {
        const entry = physicsBodies.get(mesh);
        if (entry && entry.body) {
            markLocalPhysicsOwner(mesh, PHYSICS_OWNER_LEASE_MS * 2);
            entry.body.velocity.set(vx, vy, vz);
        }
    },
    _getPartVelocity(mesh) {
        const entry = physicsBodies.get(mesh);
        if (entry && entry.body) {
            return { x: entry.body.velocity.x, y: entry.body.velocity.y, z: entry.body.velocity.z };
        }
        return { x: 0, y: 0, z: 0 };
    },
    _setPartColor(mesh, hex) {
        if (Array.isArray(mesh.material)) {
            for (const mat of mesh.material) { mat.color.setHex(hex); mat.needsUpdate = true; }
        } else {
            mesh.material.color.setHex(hex);
            mesh.material.needsUpdate = true;
        }
    },
    _setPartTransparency(mesh, t) {
        applyMeshTransparency(mesh, t);
    },
    _setPartAnchored(mesh, anchored) {
        const entry = physicsBodies.get(mesh);
        if (entry) {
            entry.anchored = anchored;
            entry.body.mass = anchored ? 0 : computeMass(
                mesh.userData.halfSize.sw,
                mesh.userData.halfSize.sh,
                mesh.userData.halfSize.sd,
                entry.body.shapes[0]?.type === CANNON.Shape.types.SPHERE ? 'Ball' : 'Block'
            );
            entry.body.updateMassProperties();
    if (anchored && mesh.userData.canCollide !== false) {
                this._activatePartCollider(mesh);
            }
        }
    },
    _setPartMass(mesh, mass) {
        const entry = physicsBodies.get(mesh);
        if (entry && !entry.anchored) {
            const m = mass === 'auto' || mass == null
                ? computeMass(
                    mesh.userData.halfSize.sw,
                    mesh.userData.halfSize.sh,
                    mesh.userData.halfSize.sd,
                    entry.body.shapes[0]?.type === CANNON.Shape.types.SPHERE ? 'Ball' : 'Block'
                  )
                : Number(mass);
            entry.body.mass = m;
            entry.body.updateMassProperties();
        }
    },
    _resizePart(mesh, sw, sh, sd) {
        const entry = physicsBodies.get(mesh);
        if (entry) {
            const shape = entry.body.shapes[0]?.type === CANNON.Shape.types.SPHERE ? 'Ball' : 'Block';
            if (shape === 'Ball') {
                const r = Math.max(sw, sh, sd) / 2;
                mesh.geometry = getCachedSphereGeo(r);
            } else {
                mesh.geometry = getCachedGeo(sw, sh, sd);
            }
            mesh.userData.halfSize = { sw, sh, sd };
            const body = entry.body;
            body.removeShape(body.shapes[0]);
            if (shape === 'Ball') {
                const r = Math.max(sw, sh, sd) / 2;
                body.addShape(new CANNON.Sphere(r));
            } else {
                body.addShape(new CANNON.Box(new CANNON.Vec3(sw/2, sh/2, sd/2)));
            }
            if (!entry.anchored) {
                body.mass = computeMass(sw, sh, sd, shape);
                body.updateMassProperties();
            }
        }
        this._activatePartCollider(mesh);
    },
    _getPartAnchored(mesh) {
        const entry = physicsBodies.get(mesh);
        return entry ? entry.anchored : true;
    },
    _getPartMass(mesh) {
        const entry = physicsBodies.get(mesh);
        if (!entry) return computeMass(4, 4, 4, 'Block');
        return entry.anchored ? 0 : entry.body.mass;
    },
    getPhysicsState: () => {
        const bodies = [];
        physicsBodies.forEach(({ body, anchored, mesh }) => {
            if (!anchored && body && mesh.userData.physicsId) {
                if (!isLocalPhysicsOwner(mesh)) return;
                const linearSpeed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2 + body.velocity.z ** 2);
                const angularSpeed = Math.sqrt(body.angularVelocity.x ** 2 + body.angularVelocity.y ** 2 + body.angularVelocity.z ** 2);
                if (linearSpeed < 0.01 && angularSpeed < 0.01) return; // only sync moving bodies, lower threshold to allow settling
                mesh.userData.physicsOwnerUntil = performance.now() + PHYSICS_OWNER_SEND_EXTEND_MS;
                bodies.push({
                    id: mesh.userData.physicsId,
                    ownerClaimId: mesh.userData.physicsOwnerClaimId || 0,
                    x: body.position.x,
                    y: body.position.y,
                    z: body.position.z,
                    vx: body.velocity.x,
                    vy: body.velocity.y,
                    vz: body.velocity.z,
                    qx: body.quaternion.x,
                    qy: body.quaternion.y,
                    qz: body.quaternion.z,
                    qw: body.quaternion.w,
                    wx: body.angularVelocity.x,
                    wy: body.angularVelocity.y,
                    wz: body.angularVelocity.z
                });
            }
        });
        return bodies;
    },
    applyPhysicsState: (userId, bodies) => {
        if (!userId || !bodies) return;
        if (userId === currentUserId) return;
        if (performance.now() < _skipPhysicsSyncUntil) return;
        const now = performance.now();
        physicsBodies.forEach(({ body, anchored, mesh }) => {
            if (anchored || !body || !mesh.userData.physicsId) return;
            for (const s of bodies) {
                if (s.id === mesh.userData.physicsId) {
                    if (s.snap) {
                        body.position.set(s.x, s.y, s.z);
                        if (s.qx !== undefined) body.quaternion.set(s.qx, s.qy, s.qz, s.qw);
                        body.velocity.set(s.vx || 0, s.vy || 0, s.vz || 0);
                        body.angularVelocity.set(0, 0, 0);
                        body.force.set(0, 0, 0);
                        body.torque.set(0, 0, 0);
                        delete mesh.userData.physicsOwnerId;
                        delete mesh.userData.physicsOwnerUntil;
                        delete mesh.userData.physicsOwnerClaimId;
                        mesh.position.copy(body.position);
                        mesh.quaternion.copy(body.quaternion);
                        break;
                    }
                    if (shouldKeepLocalPhysicsOwner(mesh, s.ownerClaimId)) break;
                    mesh.userData.physicsOwnerId = userId;
                    mesh.userData.physicsOwnerUntil = now + PHYSICS_OWNER_LEASE_MS;
                    mesh.userData.physicsOwnerClaimId = s.ownerClaimId || 0;
                    
                    // Smooth corrective velocity instead of teleporting
                    const correctionFactor = 10;
                    body.velocity.x = s.vx + (s.x - body.position.x) * correctionFactor;
                    body.velocity.y = s.vy + (s.y - body.position.y) * correctionFactor;
                    body.velocity.z = s.vz + (s.z - body.position.z) * correctionFactor;
                    
                    // Sync rotations if provided
                    if (s.qx !== undefined && s.wx !== undefined) {
                        const targetQuat = new CANNON.Quaternion(s.qx, s.qy, s.qz, s.qw);
                        body.quaternion.slerp(targetQuat, 0.3); // Smooth blend rotation
                        body.angularVelocity.x = s.wx;
                        body.angularVelocity.y = s.wy;
                        body.angularVelocity.z = s.wz;
                    }
                    break;
                }
            }
        });
    },
    resetParts: () => {
        _skipPhysicsSyncUntil = performance.now() + 500;
        const resetState = [];
        physicsBodies.forEach(({ body, anchored, mesh }) => {
            if (anchored || !body || !mesh.userData.initialPos) return;
            const ip = mesh.userData.initialPos;
            const iq = mesh.userData.initialQuat;
            body.position.set(ip.x, ip.y, ip.z);
            body.quaternion.set(iq.x, iq.y, iq.z, iq.w);
            body.velocity.set(0, 0, 0);
            body.angularVelocity.set(0, 0, 0);
            body.force.set(0, 0, 0);
            body.torque.set(0, 0, 0);
            delete mesh.userData.physicsOwnerId;
            delete mesh.userData.physicsOwnerUntil;
            delete mesh.userData.physicsOwnerClaimId;
            mesh.position.copy(ip);
            mesh.quaternion.copy(iq);
            if (mesh.userData.physicsId) {
                resetState.push({
                    id: mesh.userData.physicsId,
                    x: ip.x,
                    y: ip.y,
                    z: ip.z,
                    qx: iq.x,
                    qy: iq.y,
                    qz: iq.z,
                    qw: iq.w,
                    vx: 0,
                    vy: 0,
                    vz: 0,
                    wx: 0,
                    wy: 0,
                    wz: 0,
                    snap: true
                });
            }
        });
        return resetState;
    },
    clearLocalAccessories: () => {
        _clearPlayerAccessories(currentUserId);
        _playerAvatarData.delete(currentUserId);
        if (character) {
            const toRemove = [];
            character.traverse(child => {
                if (child.userData?.isAccessory) toRemove.push(child);
            });
            for (const acc of toRemove) {
                acc.removeFromParent();
            }
        }
    },
    getLocalTransform: () => {
    if (!character) return null;
    let isMoving = !_dead && (!!(keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] || keys['ArrowUp'] || keys['ArrowDown'] || joystickActive));
    const sendGrounded = _dead ? false : grounded;
    const sendClimb = _dead ? 0 : (typeof climbState === 'number' && climbState > 0 ? climbState : (climbState === 'hanging' ? 1 : 0));
    let ry = character.rotation.y % (2 * Math.PI);
    if (ry > Math.PI)  ry -= 2 * Math.PI;
    if (ry < -Math.PI) ry += 2 * Math.PI;
    return { x: character.position.x, y: character.position.y, z: character.position.z, ry, moving: isMoving, grounded: sendGrounded, climbState: sendClimb, dead: _dead, qx: character.quaternion.x, qy: character.quaternion.y, qz: character.quaternion.z, qw: character.quaternion.w };
    },
    updateOtherPlayer: (userId, x, y, z, ry, moving, grounded, climbState, username = null, qx, qy, qz, qw, dead, health) => {
    if (!character) return; // Not fully loaded yet
    // Don't create/update a clone for the local player (same-account multi-device scenario)
    if (userId === currentUserId) return;
    // Normalize received angle to [-π, π] so lerpAngle never takes the long way around
    // and so a freshly spawned clone never starts 180° wrong.
    let correctedRy = ry % (2 * Math.PI);
    if (correctedRy > Math.PI)  correctedRy -= 2 * Math.PI;
    if (correctedRy < -Math.PI) correctedRy += 2 * Math.PI;

    let p = otherPlayers.get(userId);
    if (!p) {
        // Clone character
        const clone = SkeletonUtils.clone(character);
        const bones = {};
        const rest = {};
        // Reset bones to rest pose before capturing, so each remote
        // player's animation starts from the clean bind pose, not the
        // local character's current animated pose.
        clone.traverse(child => {
            if ((child.isBone || child.type === 'Bone') && anim.rest[child.name]) {
                const r = anim.rest[child.name];
                child.rotation.set(r.x, r.y, r.z);
                child.position.set(r.px, r.py, r.pz);
            }
        });
        clone.traverse(child => {
            if (child.isBone || child.type === 'Bone') {
                bones[child.name] = child;
                rest[child.name] = {
                    x: child.rotation.x, y: child.rotation.y, z: child.rotation.z,
                    px: child.position.x, py: child.position.y, pz: child.position.z
                };
            }
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Clone materials so each player has unique instances
                if (Array.isArray(child.material)) {
                    for (let i = 0; i < child.material.length; i++) {
                        child.material[i] = child.material[i].clone();
                    }
                } else if (child.material) {
                    child.material = child.material.clone();
                }
            }
        });
        // Strip any clothing overlays cloned from the local character
        const toRemove = [];
        clone.traverse(child => {
            if (child.userData?.isClothingOverlay) toRemove.push(child);
            if (child.userData?.isFaceOverlay) toRemove.push(child);
        });
        for (const overlay of toRemove) {
            overlay.removeFromParent();
            overlay.geometry?.dispose?.();
            const mats = Array.isArray(overlay.material) ? overlay.material : [overlay.material];
            for (const mat of mats) mat?.dispose?.();
        }

        clone.position.set(x, y, z);
        // Always set rotation directly from the normalized received value —
        // never inherit from the local character's current pose, which would
        // cause the clone to start facing the wrong direction.
        if (qw !== undefined) {
            clone.quaternion.set(qx, qy, qz, qw);
        } else {
            clone.rotation.set(0, correctedRy, 0);
        }
        scene.add(clone);
        const targetQ = new THREE.Quaternion(qx||0, qy||0, qz||0, qw||1);
        p = { mesh: clone, bones, rest, targetX: x, targetY: y, targetZ: z, targetRy: correctedRy, targetQ, moving, grounded, climbState, dead: !!dead, animTime: 0 };
        otherPlayers.set(userId, p);

            // Apply stored avatar data if available
            const storedData = _playerAvatarData.get(userId);
            if (storedData) {
                _applyColorsToModel(clone, storedData.colors);
                _applyClothingToModel(clone, storedData.clothing);
                _applyAccessoriesToModel(userId, clone, storedData.accessories);
                _applyFaceToModel(clone, storedData.face);
            }
            
            // Set initial visual top (accessories may update it later)
            _recalcVisualTop(userId);

            // Create username label if provided
            if (username) {
                if (!_playerNames.has(userId)) {
                    const sprite = _createNameSprite(username);
                    _playerNames.set(userId, { username, sprite });
                }
            }

            // Initialize health bar if health data available
            if (health !== undefined && !isNaN(health)) {
                const bar = _createHealthBarSprite();
                _updateHealthBarSprite(bar, health, 100);
                _playerHealthBars.set(userId, bar);
            }
        } else {
            p.targetX = x; p.targetY = y; p.targetZ = z; p.targetRy = correctedRy; p.moving = moving; p.grounded = grounded; p.climbState = climbState; p.dead = !!dead;
            if (qw !== undefined) {
                p.targetQ.set(qx, qy, qz, qw);
            }
            
            // Update username label if provided and not already set
            if (username && !_playerNames.has(userId)) {
                const sprite = _createNameSprite(username);
                _playerNames.set(userId, { username, sprite });
            }
            
            // Update health bar if health data available
            if (health !== undefined && !isNaN(health)) {
                let bar = _playerHealthBars.get(userId);
                if (!bar) {
                    bar = _createHealthBarSprite();
                    _playerHealthBars.set(userId, bar);
                }
                _updateHealthBarSprite(bar, health, 100);
            }
        }
    },
    _applyAvatarColors(colors) {
        _applyColorsToModel(character, colors);
    },
    _setPlayerAvatarData(userId, data) {
        _playerAvatarData.set(userId, data);
        if (userId === currentUserId && character) {
            if (data.colors) _applyColorsToModel(character, data.colors);
            _applyClothingToModel(character, data.clothing);
            _applyAccessoriesToModel(userId, character, data.accessories);
            _applyFaceToModel(character, data.face);
            _recalcVisualTop(userId);
        }
        const p = otherPlayers.get(userId);
        if (p && p.mesh) {
            if (data.colors) _applyColorsToModel(p.mesh, data.colors);
            _applyClothingToModel(p.mesh, data.clothing);
            _applyAccessoriesToModel(userId, p.mesh, data.accessories);
            _applyFaceToModel(p.mesh, data.face);
            _recalcVisualTop(userId);
        }
    },
    _getPlayerAvatarData(userId) {
        return _playerAvatarData.get(userId) || null;
    },
    setPlayerStreak: (userId, streak) => {
        if (!userId) return;
        const existing = _playerStreaks.get(userId);
        if (!Number.isFinite(streak) || streak <= 0) {
            if (existing && existing.sprite) {
                scene.remove(existing.sprite);
                existing.sprite.material.map?.dispose();
                existing.sprite.material.dispose();
            }
            _playerStreaks.delete(userId);
            return;
        }
        if (existing && existing.sprite) {
            _updateStreakSprite(existing.sprite, streak);
            existing.streak = streak;
        } else {
            const sprite = _createStreakSprite(streak);
            _playerStreaks.set(userId, { streak, sprite });
        }
    },
    removeOtherPlayer: (userId) => {
        if (userId === currentUserId) return;
        const p = otherPlayers.get(userId);
        if (p && p.mesh) {
            scene.remove(p.mesh);
        }
        otherPlayers.delete(userId);
        _playerAvatarData.delete(userId);
        _clearPlayerAccessories(userId);
        
        // Remove username label
        const nameData = _playerNames.get(userId);
        if (nameData && nameData.sprite) {
            scene.remove(nameData.sprite);
            nameData.sprite.material.map?.dispose();
            nameData.sprite.material.dispose();
        }
        _playerNames.delete(userId);
        
        // Remove health bar
        const bar = _playerHealthBars.get(userId);
        if (bar && bar.sprite) {
            scene.remove(bar.sprite);
            bar.sprite.material.map?.dispose();
            bar.sprite.material.dispose();
        }
        _playerHealthBars.delete(userId);
        const streakData = _playerStreaks.get(userId);
        if (streakData && streakData.sprite) {
            scene.remove(streakData.sprite);
            streakData.sprite.material.map?.dispose();
            streakData.sprite.material.dispose();
        }
        _playerStreaks.delete(userId);
    },
    setOtherPlayerHealth: (userId, health) => {
        if (userId === currentUserId) return;
        let bar = _playerHealthBars.get(userId);
        if (!bar) {
            bar = _createHealthBarSprite();
            _playerHealthBars.set(userId, bar);
        }
        _updateHealthBarSprite(bar, health, 100);
    },
    setQuality(level) {
        _graphicsLevel = Math.max(1, Math.min(10, level));
        _applyGraphicsLevel();
        if (_qualityChangeCallback) _qualityChangeCallback(_graphicsLevel);
    },
    setGraphicsAuto(enabled) {
        _graphicsAuto = enabled;
        if (!enabled) {
            _fpsHistory.length = 0;
        }
    },
    getGraphicsLevel() { return _graphicsLevel; },
    onQualityChange(fn) { _qualityChangeCallback = fn; },
    // Mobile key registry — scanned from script IsKeyDown calls
    getJoystick: () => joystickVector,
    _registerMobileKey(key) { _pendingMobileKeys.add(key); },
    _getMobileKeys() { return [..._pendingMobileKeys]; },
    // Physics control
    setPhysicsGravity(y) { physicsWorld.gravity.set(0, y, 0); },
    getPhysicsGravity: () => physicsWorld.gravity.y,
    // Simple billboard text sprite (for game scripts)
    createBillboard(text, hexColor, x, y, z) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const fontSize = 48;
        ctx.font = `bold ${fontSize}px Arial`;
        const metrics = ctx.measureText(text);
        const w = metrics.width + 16;
        const h = fontSize + 16;
        canvas.width = w;
        canvas.height = h;
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 4;
        ctx.strokeText(text, w / 2, h / 2);
        ctx.fillStyle = hexColor || '#ffffff';
        ctx.fillText(text, w / 2, h / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, alphaTest: 0.25, sizeAttenuation: true });
        const sprite = new THREE.Sprite(mat);
        const scale = 0.008;
        sprite.scale.set(w * scale, h * scale, 1);
        sprite.position.set(x || 0, y || 0, z || 0);
        scene.add(sprite);
        return sprite;
    },
    destroyBillboard(sprite) {
        if (!sprite) return;
        scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
    },
};

function _applyGraphicsLevel() {
    const t = (_graphicsLevel - 1) / 9;
    const ratio = 0.5 + t * (Math.min(window.devicePixelRatio, 2) - 0.5);
    renderer.setPixelRatio(ratio);
    // No shadow map resizing to avoid flash from dispose/recreate
    if (t < 0.15) {
        renderer.shadowMap.enabled = false;
    } else {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    scene.fog.near = 96 + t * 96;
    scene.fog.far = 240 + t * 240;
}

// ─── Game loop ────────────────────────────────────────────────────────────────
let lastTime = performance.now();
let _physAccumulator = 0;
const PHYS_DT = 1 / 60;
const MAX_PHYS_STEPS = 5;

function loop(now) {
    requestAnimationFrame(loop);
    const frameDt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    _physAccumulator += frameDt;
    let steps = 0;
    while (_physAccumulator >= PHYS_DT && steps < MAX_PHYS_STEPS) {
        _physAccumulator -= PHYS_DT;
        steps++;
        update(PHYS_DT);
    }

    // Visual-only updates (once per frame, with raw frame delta)
    if (keys['KeyI']) cam.targetDistance = Math.max(cam.minDist, cam.targetDistance - CAM_KEY_ZOOM_SPEED * frameDt);
    if (keys['KeyO']) cam.targetDistance = Math.min(cam.maxDist, cam.targetDistance + CAM_KEY_ZOOM_SPEED * frameDt);
    cam.distance = THREE.MathUtils.lerp(cam.distance, cam.targetDistance, Math.min(1, 10 * frameDt));
    updateCamera(frameDt);

    if (charDebugMesh && character) {
        const fy = character.position.y - CHAR_FOOT_OFFSET;
        charDebugMesh.position.set(character.position.x, fy + CHAR_HEIGHT/2, character.position.z);
        charDebugMesh.rotation.y = character.rotation.y;
    }
    updateDebugMeshes();

    window._mpUpdate?.(frameDt);
    window._scriptUpdate?.(frameDt);

    // Update other players (visual interpolation, once per frame)
    otherPlayers.forEach((p, userId) => {
        if (!p.mesh) return;
        p.mesh.position.lerp(new THREE.Vector3(p.targetX, p.targetY, p.targetZ), Math.min(1, frameDt * 10));
        if (p.targetQ) {
            p.mesh.quaternion.slerp(p.targetQ, Math.min(1, frameDt * 10));
        } else {
            p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, p.targetRy, Math.min(1, frameDt * 10));
        }
        if (p._emote) { _applyRemoteEmote(p, p._emote, frameDt); return; }
        p.animTime = (p.animTime || 0) + frameDt;
        if (p.dead) return;
        const t = p.animTime, sp = 12;
        const lLeg = p.bones['Left_Leg'],  rLeg = p.bones['Right_Leg'];
        const lArm = p.bones['Left_Arm'],  rArm = p.bones['Right_Arm'];
        const torso = p.bones['Torso'];
        const lArmRestY = p.rest['Left_Arm']?.py ?? 0;
        const rArmRestY = p.rest['Right_Arm']?.py ?? 0;

        if (p.climbState > 0) {
            const grip = p.moving ? Math.sin(p.animTime * 6) * 0.15 : 0;
            if(lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x||0) + (p.offset?.['Left_Arm']?.x||0) - Math.PI*0.75 + grip, Math.min(1, sp*frameDt));
            if(rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x||0) + (p.offset?.['Right_Arm']?.x||0) - Math.PI*0.75 - grip, Math.min(1, sp*frameDt));
            if(lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z||0) + (p.offset?.['Left_Arm']?.z||0) + 0.35, Math.min(1, sp*frameDt));
            if(rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z||0) + (p.offset?.['Right_Arm']?.z||0) - 0.35, Math.min(1, sp*frameDt));
            const kick = p.moving ? Math.sin(p.animTime * 6) * 0.3 : 0;
            if(lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x||0) + 0.3 + kick, Math.min(1, sp*frameDt));
            if(rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x||0) + 0.3 - kick, Math.min(1, sp*frameDt));
            if(torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x||0) - 0.15, Math.min(1, sp*frameDt));
            if(torso) torso.rotation.z = THREE.MathUtils.lerp(torso.rotation.z, (p.rest['Torso']?.z||0), Math.min(1, sp*frameDt));
            if(lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY + 0.5, Math.min(1, sp*frameDt));
            if(rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY + 0.5, Math.min(1, sp*frameDt));
        } else if (p.grounded === false) {
            if(lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x||0), Math.min(1, sp*frameDt));
            if(rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x||0), Math.min(1, sp*frameDt));
            if(lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x||0) + (p.offset?.['Left_Arm']?.x||0) - Math.PI, Math.min(1, sp*frameDt));
            if(rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x||0) + (p.offset?.['Right_Arm']?.x||0) - Math.PI, Math.min(1, sp*frameDt));
            if(lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z||0) + (p.offset?.['Left_Arm']?.z||0), Math.min(1, sp*frameDt));
            if(rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z||0) + (p.offset?.['Right_Arm']?.z||0), Math.min(1, sp*frameDt));
            if(torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x||0), Math.min(1, sp*frameDt));
            if(lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*frameDt));
            if(rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*frameDt));
        } else if (p.moving) {
            const swing = Math.sin(t * 2.8 * Math.PI);
            if(lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x||0) + swing * 1.0, Math.min(1, sp*frameDt));
            if(rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x||0) - swing * 1.0, Math.min(1, sp*frameDt));
            if(lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x||0) + (p.offset?.['Left_Arm']?.x||0) - swing * 0.8, Math.min(1, sp*frameDt));
            if(rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x||0) + (p.offset?.['Right_Arm']?.x||0) + swing * 0.8, Math.min(1, sp*frameDt));
            if(lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z||0) + (p.offset?.['Left_Arm']?.z||0) + 0.05, Math.min(1, sp*frameDt));
            if(rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z||0) + (p.offset?.['Right_Arm']?.z||0) - 0.05, Math.min(1, sp*frameDt));
            if(torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x||0) + 0.03, Math.min(1, sp*frameDt));
            if(lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*frameDt));
            if(rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*frameDt));
        } else {
            const breathe = Math.sin(t * 1.2) * 0.015;
            if(lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x||0), Math.min(1, sp*frameDt));
            if(rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x||0), Math.min(1, sp*frameDt));
            if(lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x||0) + (p.offset?.['Left_Arm']?.x||0), Math.min(1, sp*frameDt));
            if(rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x||0) + (p.offset?.['Right_Arm']?.x||0), Math.min(1, sp*frameDt));
            if(lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z||0) + (p.offset?.['Left_Arm']?.z||0) + 0.1 + breathe, Math.min(1, sp*frameDt));
            if(rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z||0) + (p.offset?.['Right_Arm']?.z||0) - 0.1 - breathe, Math.min(1, sp*frameDt));
            if(torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x||0) + breathe, Math.min(1, sp*frameDt));
            if(lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*frameDt));
            if(rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*frameDt));
        }
    });

    _updateBubblePositions();
    _updateNameLabelPositions();
    _updateAccessoryWrappers();
    _updateSurfaceGuiProjections();
    _updateLeaderstats(_gameRef);

    renderer.render(scene, camera);

    // FPS-based auto quality adjust
    if (_graphicsAuto) {
        const fps = 1 / Math.max(frameDt, 0.001);
        _fpsHistory.push(fps);
        if (_fpsHistory.length > _fpsWindow) _fpsHistory.shift();
        _autoAdjustCooldown -= frameDt;
        if (_fpsHistory.length >= _fpsWindow && _autoAdjustCooldown <= 0) {
            const avg = _fpsHistory.reduce((a, b) => a + b, 0) / _fpsHistory.length;
            let newLevel = _graphicsLevel;
            if (avg < 20) {
                newLevel = Math.max(1, _graphicsLevel - 2);
            } else if (avg < 30) {
                newLevel = Math.max(1, _graphicsLevel - 1);
            } else if (avg > 55) {
                newLevel = Math.min(10, _graphicsLevel + 1);
            }
            if (newLevel !== _graphicsLevel) {
                _graphicsLevel = newLevel;
                _applyGraphicsLevel();
                if (_qualityChangeCallback) _qualityChangeCallback(_graphicsLevel);
            }
            _autoAdjustCooldown = 10;
        }
    }
}

requestAnimationFrame(loop);