import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import './style.css';
import playerModelUrl from '../assets/models/player.fbx?url';
import headTextureUrl from '../assets/models/Head1_diff.png';
import studTextureUrl from '../assets/textures/stud.jpeg';

// ─── Constants ───────────────────────────────────────────────────────────────
const STUDS_PER_TILE = 4;
const G_LEVEL = 0; // world ground Y (top of baseplate)
const DEG2RAD = Math.PI / 180;

const WALK_SPEED       = 16;
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

const CLIMB_RISE_SPEED  = 11.2;
const CLIMB_REACH       = 0.1;
const CLIMB_FALL_CUTOFF = -200;
const CLIMB_MAX_PART_H  = 1.5;
const CLIMB_WINDOW      = 2.2;
const CLIMB_JUMP_UP     = 38;
const CLIMB_JUMP_BACK_V = 14;
const HANG_DEPTH        = 1.2;

const CHUNK_SIZE = 4;

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
scene.add(sun);

// ─── Geometry / Material caches ──────────────────────────────────────────────
const tlLoader = new THREE.TextureLoader();
const geoCache = new Map();
const matCache = new Map();

// Load stud texture once, clone+repeat per face to avoid reloading
const _studTexBase = tlLoader.load(studTextureUrl);
_studTexBase.wrapS = _studTexBase.wrapT = THREE.RepeatWrapping;
_studTexBase.colorSpace = THREE.SRGBColorSpace;

function studTex(rx, ry) {
    const t = _studTexBase.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
}

function getCachedGeo(sw, sh, sd) {
    const key = `${sw},${sh},${sd}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(sw, sh, sd));
    return geoCache.get(key);
}

function getCachedMats(sw, sh, sd, color) {
    const key = `${sw},${sh},${sd},${color}`;
    if (matCache.has(key)) return matCache.get(key);
    const m = (rx, ry) => new THREE.MeshStandardMaterial({
        color,
        map: studTex(rx, ry),
        roughness: 0.85,
        metalness: 0.0,
    });
    const mats = [
        m(sd / STUDS_PER_TILE, sh / STUDS_PER_TILE), // right
        m(sd / STUDS_PER_TILE, sh / STUDS_PER_TILE), // left
        m(sw / STUDS_PER_TILE, sd / STUDS_PER_TILE), // top
        m(sw / STUDS_PER_TILE, sd / STUDS_PER_TILE), // bottom
        m(sw / STUDS_PER_TILE, sh / STUDS_PER_TILE), // front
        m(sw / STUDS_PER_TILE, sh / STUDS_PER_TILE), // back
    ];
    matCache.set(key, mats);
    return mats;
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

// ─── Map mode ────────────────────────────────────────────────────────────────
const _urlParams = new URLSearchParams(window.location.search);
const _gameMode = _urlParams.get('game') || 'demo';

// ─── World builder ───────────────────────────────────────────────────────────
function addStud(sw, sh, sd, color, x, y, z, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(getCachedGeo(sw, sh, sd), getCachedMats(sw, sh, sd, color));
    const cy = y + sh / 2;
    mesh.position.set(x, cy, z);
    if (rx !== 0 || ry !== 0 || rz !== 0) mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    let b;
    if (rx === 0 && ry === 0 && rz === 0) {
        b = { minX: x-sw/2, maxX: x+sw/2, minY: y, maxY: y+sh, minZ: z-sd/2, maxZ: z+sd/2 };
    } else {
        b = buildOBB(sw, sh, sd, x, cy, z, rx, ry, rz);
    }
    colliders.push(b);
    insertToChunks(b);
    return mesh;
}

// Baseplate (top surface at y=0)
addStud(320, 3.2, 320, 0x4db84b, 0, -3.2, 0);

// ─── Playground parts ────────────────────────────────────────────────────────
if (_gameMode === 'demo') {
{
    const G = G_LEVEL;
    const RED    = 0xc4281c, BLUE   = 0x0d69ac, YELLOW = 0xf2cd37;
    const ORANGE = 0xe2761a, PURPLE = 0x5b3a8b, LIME   = 0x4db84b;
    const WHITE  = 0xf2f3f2, DARK   = 0x1a1a2e, PINK   = 0xe84393, TEAL   = 0x00b4d8;

    addStud(8, 3, 8, BLUE,  0, G,     -20);
    addStud(6, 1, 6, RED,   0, G + 3, -32);

    addStud( 8, 1,  8, BLUE,   17.00,  1.60,   0.00);
    addStud( 6, 1,  6, BLUE,   29.00,  1.60,   0.00);
    addStud( 4, 1,  4, TEAL,   40.00,  1.60,   0.00);
    addStud( 3, 1,  3, TEAL,   50.00,  1.60,   0.00);
    addStud( 2, 1,  2, YELLOW, 59.00,  1.60,   0.00);
    addStud( 2, 1,  2, YELLOW, 68.00,  1.60,   0.00);
    addStud( 2, 1,  2, ORANGE, 77.00,  1.60,   0.00);
    addStud( 2, 1,  2, RED,    86.00,  1.60,   0.00);

    addStud( 2, 1,  2, RED,    95.00,  4.60,   8.00);
    addStud( 2, 1,  2, ORANGE, 103.00, 7.60,   0.00);
    addStud( 2, 1,  2, YELLOW, 112.00, 10.60,  8.00);
    addStud( 2, 1,  2, TEAL,   120.00, 13.60,  0.00);
    addStud( 2, 1,  2, BLUE,   129.00, 16.60,  8.00);
    addStud( 2, 1,  2, PURPLE, 137.00, 19.60,  0.00);
    addStud( 2, 1,  2, PINK,   146.00, 22.60,  8.00);
    addStud( 2, 1,  2, RED,    154.00, 25.60,  0.00);
    addStud( 8, 2,  8, WHITE,  160.00, 25.60,  0.00);

    addStud( 1, 1,  4, TEAL,   160.00, 25.60,  10.00);
    addStud( 1, 1,  4, PINK,   160.00, 25.60,  19.00);
    addStud( 1, 1,  4, TEAL,   160.00, 25.60,  28.00);
    addStud( 1, 1,  4, PINK,   160.00, 25.60,  37.00);
    addStud( 1, 1,  4, TEAL,   160.00, 25.60,  46.00);
    addStud( 1, 1,  4, PINK,   160.00, 25.60,  55.00);
    addStud( 1, 1,  4, TEAL,   160.00, 25.60,  64.00);
    addStud( 1, 1,  4, PINK,   160.00, 25.60,  73.00);
    addStud( 1, 1,  4, TEAL,   160.00, 25.60,  82.00);
    addStud( 1, 1,  4, PINK,   160.00, 25.60,  91.00);
    addStud( 6, 2,  6, WHITE,  160.00, 25.60,  93.00);

    addStud( 2, 1,  2, RED,    173.00, 25.60,  95.00);
    addStud( 2, 1,  2, ORANGE, 171.26, 28.10, 101.50);
    addStud( 2, 1,  2, YELLOW, 166.50, 30.60, 106.26);
    addStud( 2, 1,  2, LIME,   160.00, 33.10, 108.00);
    addStud( 2, 1,  2, TEAL,   153.50, 35.60, 106.26);
    addStud( 2, 1,  2, BLUE,   148.74, 38.10, 101.50);
    addStud( 2, 1,  2, PURPLE, 147.00, 40.60,  95.00);
    addStud( 2, 1,  2, PINK,   148.74, 43.10,  88.50);
    addStud( 2, 1,  2, WHITE,  153.50, 45.60,  83.74);
    addStud( 2, 1,  2, RED,    160.00, 48.10,  82.00);
    addStud( 2, 1,  2, ORANGE, 166.50, 50.60,  83.74);
    addStud( 2, 1,  2, YELLOW, 171.26, 53.10,  88.50);
    addStud( 6, 2,  6, WHITE,  160.00, 53.10,  95.00);

    addStud( 2,  2, 2, DARK,   148.00, 53.10,  95.00);
    addStud( 3,  1, 3, RED,    148.00, 55.10,  95.00);
    addStud( 2,  7, 2, DARK,   137.00, 53.10,  95.00);
    addStud( 3,  1, 3, ORANGE, 137.00, 60.10,  95.00);
    addStud( 2,  2, 2, DARK,   126.00, 53.10,  95.00);
    addStud( 3,  1, 3, RED,    126.00, 55.10,  95.00);
    addStud( 2,  7, 2, DARK,   115.00, 53.10,  95.00);
    addStud( 3,  1, 3, ORANGE, 115.00, 60.10,  95.00);
    addStud( 2,  2, 2, DARK,   104.00, 53.10,  95.00);
    addStud( 3,  1, 3, RED,    104.00, 55.10,  95.00);
    addStud( 2,  7, 2, DARK,    93.00, 53.10,  95.00);
    addStud( 3,  1, 3, ORANGE,  93.00, 60.10,  95.00);
    addStud( 2,  2, 2, DARK,    82.00, 53.10,  95.00);
    addStud( 3,  1, 3, RED,     82.00, 55.10,  95.00);
    addStud( 2,  7, 2, DARK,    71.00, 53.10,  95.00);
    addStud( 3,  1, 3, ORANGE,  71.00, 60.10,  95.00);
    addStud( 2,  2, 2, DARK,    60.00, 53.10,  95.00);
    addStud( 3,  1, 3, RED,     60.00, 55.10,  95.00);
    addStud( 2,  7, 2, DARK,    49.00, 53.10,  95.00);
    addStud( 3,  1, 3, ORANGE,  49.00, 60.10,  95.00);
    addStud( 6,  2, 6, WHITE,   41.00, 58.10,  95.00);

    addStud( 2, 1,  8, BLUE,   41.00, 58.10,  85.00);
    addStud( 8, 1,  2, BLUE,   49.00, 58.10,  79.00);
    addStud( 2, 1,  8, TEAL,   57.00, 58.10,  71.00);
    addStud( 8, 1,  2, TEAL,   49.00, 58.10,  63.00);
    addStud( 2, 1,  8, PURPLE, 41.00, 58.10,  55.00);
    addStud( 8, 1,  2, PURPLE, 33.00, 58.10,  47.00);
    addStud( 2, 1,  8, PINK,   25.00, 58.10,  39.00);
    addStud( 8, 1,  2, PINK,   33.00, 58.10,  31.00);
    addStud( 2, 1,  6, RED,    41.00, 58.10,  23.00);
    addStud( 6, 2,  6, WHITE,  41.00, 58.10,  17.00);

    addStud( 2, 1,  2, ORANGE, 41.00, 58.10,   8.00);
    addStud( 2, 1,  2, RED,    41.00, 60.10,   1.00);
    addStud( 2, 1,  2, YELLOW, 41.00, 58.10,  -6.00);
    addStud( 1, 1,  2, TEAL,   41.00, 58.10, -13.00);
    addStud( 2, 1,  2, PURPLE, 41.00, 61.10, -20.00);
    addStud( 2, 1,  1, BLUE,   41.00, 60.10, -27.00);
    addStud( 1, 1,  1, PINK,   41.00, 62.10, -34.00);
    addStud( 1, 1,  1, RED,    41.00, 62.10, -41.00);
    addStud( 1, 1,  1, ORANGE, 41.00, 62.10, -48.00);
    addStud( 2, 1,  2, LIME,   41.00, 60.10, -55.00);
    addStud( 2, 1,  2, LIME,   41.00, 60.10, -62.00);
    addStud( 6, 2,  6, WHITE,  41.00, 60.10, -65.00);

    addStud( 2, 1,  2, RED,    53.00, 60.10, -61.00);
    addStud( 2, 1,  2, ORANGE, 49.99, 57.90, -68.17);
    addStud( 2, 1,  2, YELLOW, 43.45, 55.70, -71.72);
    addStud( 2, 1,  2, TEAL,   36.44, 53.50, -70.46);
    addStud( 2, 1,  2, BLUE,   31.99, 51.30, -65.34);
    addStud( 2, 1,  2, PURPLE, 31.74, 49.10, -58.89);
    addStud( 2, 1,  2, PINK,   35.39, 46.90, -53.96);
    addStud( 2, 1,  2, WHITE,  41.00, 44.70, -52.50);
    addStud( 2, 1,  2, RED,    45.99, 42.50, -54.75);
    addStud( 2, 1,  2, ORANGE, 48.31, 40.30, -59.33);
    addStud( 2, 1,  2, YELLOW, 47.31, 38.10, -64.04);
    addStud( 2, 1,  2, TEAL,   43.82, 35.90, -66.86);
    addStud( 2, 1,  2, BLUE,   39.66, 33.70, -66.85);
    addStud( 2, 1,  2, PURPLE, 36.70, 31.50, -64.43);
    addStud( 6, 2,  6, WHITE,  41.00, 31.50, -61.00);

    addStud( 2, 1,  2, ORANGE, 50.00, 31.50, -61.00);
    addStud( 2, 1,  2, BLUE,   40.00, 34.50, -61.00);
    addStud( 2, 1,  2, ORANGE, 50.00, 37.50, -61.00);
    addStud( 2, 1,  2, BLUE,   40.00, 40.50, -61.00);
    addStud( 2, 1,  2, YELLOW, 50.00, 43.50, -61.00);
    addStud( 2, 1,  2, PURPLE, 40.00, 46.50, -61.00);
    addStud( 2, 1,  2, YELLOW, 50.00, 49.50, -61.00);
    addStud( 2, 1,  2, PURPLE, 40.00, 52.50, -61.00);
    addStud( 2, 1,  2, RED,    50.00, 55.50, -61.00);
    addStud( 2, 1,  2, TEAL,   40.00, 58.50, -61.00);
    addStud( 2, 1,  2, RED,    50.00, 61.50, -61.00);
    addStud( 2, 1,  2, TEAL,   40.00, 64.50, -61.00);
    addStud( 6, 2,  6, WHITE,  45.00, 64.50, -61.00);

    addStud(12, 1,  1, TEAL,    61.00, 64.50, -61.00);
    addStud( 1, 1, 12, ORANGE,  61.00, 64.50, -61.00);
    addStud(12, 1,  1, TEAL,    71.00, 67.50, -61.00);
    addStud( 1, 1, 12, ORANGE,  71.00, 67.50, -61.00);
    addStud(12, 1,  1, TEAL,    81.00, 64.50, -61.00);
    addStud( 1, 1, 12, ORANGE,  81.00, 64.50, -61.00);
    addStud(12, 1,  1, TEAL,    91.00, 61.50, -61.00);
    addStud( 1, 1, 12, ORANGE,  91.00, 61.50, -61.00);
    addStud(12, 1,  1, TEAL,   101.00, 64.50, -61.00);
    addStud( 1, 1, 12, ORANGE, 101.00, 64.50, -61.00);
    addStud(12, 1,  1, TEAL,   111.00, 67.50, -61.00);
    addStud( 1, 1, 12, ORANGE, 111.00, 67.50, -61.00);
    addStud(12, 1,  1, TEAL,   121.00, 64.50, -61.00);
    addStud( 1, 1, 12, ORANGE, 121.00, 64.50, -61.00);
    addStud( 6, 2,  6, WHITE,  125.00, 64.50, -61.00);

    addStud( 2, 1,  2, RED,    125.00, 64.50, -52.00);
    addStud( 2, 1,  2, ORANGE, 125.00, 59.50, -43.00);
    addStud( 2, 1,  2, YELLOW, 125.00, 54.50, -34.00);
    addStud( 2, 1,  2, PINK,   125.00, 49.50, -25.00);
    addStud( 2, 1,  2, TEAL,   125.00, 44.50, -16.00);
    addStud( 2, 1,  2, BLUE,   125.00, 39.50,  -7.00);
    addStud( 2, 1,  2, PURPLE, 125.00, 34.50,   2.00);
    addStud( 2, 1,  2, LIME,   125.00, 29.50,  11.00);
    addStud( 6, 2,  6, WHITE,  125.00, 29.50,  15.00);

    addStud( 2, 1,  2, PINK,   134.00, 30.50,  19.00);
    addStud( 2, 1,  2, TEAL,   143.00, 29.50,  15.00);
    addStud( 2, 1,  2, RED,    152.00, 31.50,  19.00);
    addStud( 2, 1,  2, ORANGE, 161.00, 29.50,  15.00);
    addStud( 2, 1,  2, PURPLE, 170.00, 30.50,  21.00);
    addStud( 2, 1,  2, BLUE,   179.00, 29.50,  15.00);
    addStud( 2, 1,  2, YELLOW, 188.00, 31.50,  15.00);
    addStud( 2, 1,  2, PINK,   197.00, 29.50,  21.00);
    addStud( 2, 1,  2, TEAL,   206.00, 29.50,  15.00);
    addStud( 2, 1,  2, LIME,   215.00, 30.50,  15.00);
    addStud( 6, 2,  6, WHITE,  221.00, 30.50,  15.00);

    addStud( 1, 1,  1, RED,    231.00, 30.50,  15.00);
    addStud( 1, 1,  1, ORANGE, 228.07, 32.50,  22.07);
    addStud( 1, 1,  1, YELLOW, 221.00, 34.50,  25.00);
    addStud( 1, 1,  1, LIME,   213.93, 36.50,  22.07);
    addStud( 1, 1,  1, TEAL,   211.00, 38.50,  15.00);
    addStud( 1, 1,  1, BLUE,   213.93, 40.50,   7.93);
    addStud( 1, 1,  1, PURPLE, 221.00, 42.50,   5.00);
    addStud( 1, 1,  1, PINK,   228.07, 44.50,   7.93);
    addStud( 1, 1,  1, WHITE,  231.00, 46.50,  15.00);
    addStud( 1, 1,  1, RED,    228.07, 48.50,  22.07);
    addStud( 1, 1,  1, ORANGE, 221.00, 50.50,  25.00);
    addStud( 1, 1,  1, YELLOW, 213.93, 52.50,  22.07);
    addStud( 1, 1,  1, LIME,   211.00, 54.50,  15.00);
    addStud( 1, 1,  1, TEAL,   213.93, 56.50,   7.93);
    addStud( 1, 1,  1, BLUE,   221.00, 58.50,   5.00);
    addStud( 1, 1,  1, PURPLE, 228.07, 60.50,   7.93);
    addStud( 8, 1,  8, ORANGE, 221.00, 60.50,  15.00);
    addStud(14, 3, 14, LIME,   221.00, 61.50,  15.00);

    const STAIR_COLORS = [BLUE, RED, YELLOW, ORANGE, PURPLE, LIME];
    for (let n = 1; n <= 10; n++) {
        addStud(6, n, 1, STAIR_COLORS[(n-1) % STAIR_COLORS.length], -15, G, -(5+n));
    }

    addStud(6, 1, 6, PURPLE, -25, G,      -6);
    addStud(6, 1, 6, PURPLE, -25, G + 2,  -6);
    addStud(6, 1, 6, PURPLE, -25, G + 4,  -6);
    addStud(6, 1, 6, PURPLE, -25, G + 6,  -6);
    addStud(6, 1, 6, PURPLE, -25, G + 8,  -6);
    addStud(6, 1, 6, PURPLE, -25, G + 10, -6);
    addStud(6, 1, 6, PURPLE, -25, G + 12, -6);
    addStud(6, 1, 6, PURPLE, -25, G + 14, -6);
    addStud(6, 1, 6, PURPLE, -25, G + 16, -6);
    addStud(6, 1, 6, PURPLE, -25, G + 18, -6);
    addStud(6, 1, 6, PURPLE, -25, G + 20, -6);
    addStud(6, 1, 6, PURPLE, -25, G + 22, -6);

    // Sign
    {
        const canvas = document.createElement('canvas');
        canvas.width = 4096; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 72px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgb(0,0,0)';
        ctx.fillText('climbing logic still work in progress. please report all bugs to the discord server!!', 2048, 64);
        const tex = new THREE.CanvasTexture(canvas);
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(128, 4),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = -Math.PI / 2;
        mesh.position.set(10, 1.62, 8);
        scene.add(mesh);
    }

    // Angled / rotated blocks
    {
        const DEG = Math.PI / 180;
        addStud(8, 1,  8, ORANGE, -40, G,          0);
        addStud(8, 1, 16, RED,    -40, G + 2.74, -12, 20*DEG, 0, 0);
        addStud(8, 1,  8, LIME,   -40, G + 5.5,  -24);
        addStud(6, 1,  8, BLUE,   -40, G + 8,    -38, 45*DEG, 0, 0);
        addStud(8, 2,  8, WHITE,  -40, G + 11.5, -50);
        addStud(6, 1,  6, YELLOW, -40, G + 13.5, -62, 0, 45*DEG, 0);
        addStud(8, 1,  8, PURPLE, -40, G + 14,   -75, 0, 0, 20*DEG);
    }

    // Climb test walls
    addStud(1,  1,  2, 0x808080, -1, G + 3,  0);
    addStud(1, 20, 10, 0x808080,  0, G,       0);
    addStud(1, 20, 10, 0x808080,  0, G,      13);
    addStud(1, 20, 14, 0x808080,  3, G,       0);
    addStud(1, 20,  6, 0x808080,  3, G,      13);
}

// Obby section
addStud(16, 0.5, 16, 0xb7b7b7, 24, 0, 24);
addStud(10, 0.2, 10, 0xff7b55, 24, 6.4, 68);
addStud( 4, 0.5,  4, 0xbdbdbd, 15, 7.3, 78);
addStud( 4, 0.5,  4, 0xbdbdbd, 24, 8.1, 84);
addStud( 4, 0.5,  4, 0xbdbdbd, 33, 9.1, 90);
addStud( 6, 0.5,  6, 0xbdbdbd, 24, 10.1, 98);
addStud( 3, 0.35,22, 0x8d8d8d, 24, 10.75, 110);
addStud(3.5, 0.5,3.5,0xbdbdbd, 16, 11.5, 124);
addStud(3.5, 0.5,3.5,0xbdbdbd, 32, 12.25, 136);
addStud( 5, 0.5,  5, 0xbdbdbd, 24, 13, 148);
addStud(18, 0.5, 18, 0xb8bdc2, 24, 2.5, 170);
}

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

// ─── Camera state ─────────────────────────────────────────────────────────────
const cam = { yaw: 0, pitch: 0.35, distance: 25.6, targetDistance: 25.6,
    minPitch: -0.5, maxPitch: 1.35, minDist: 3.2, maxDist: 128 };

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

function makeWireOBB(b) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.hx*2, b.hy*2, b.hz*2));
    const mat = new THREE.LineBasicMaterial({ color: 0xff8800, depthTest: false });
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
        const m = b.isOBB ? makeWireOBB(b) : makeWireBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0xffff00);
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

let mobileUIInjected = false;
window.addEventListener('touchstart', (e) => {
    if (mobileUIInjected) return;
    mobileUIInjected = true;
    locked = true; // Auto-lock camera for mobile
    const uiContainer = document.createElement('div');
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
        shiftLock = !shiftLock;
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
                cam.pitch -= dy * CAM_V_SENS * 1.5;
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
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
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

renderer.domElement.addEventListener('mousedown', e => { if (e.button === 2) rmb = true; });
document.addEventListener('mouseup', e => { if (e.button === 2) rmb = false; });

document.addEventListener('mousemove', e => {
    if (!locked) return;
    if (shiftLock || rmb) {
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
const anim = { time: 0, bones: {}, rest: {} };

function setRot(bone, axis, target, speed, dt) {
    if (!bone) return;
    const rest = anim.rest[bone.name]?.[axis] ?? 0;
    bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], rest + target, Math.min(1, speed * dt));
}

function updateClimbAnimation(dt, moving) {
    anim.time += dt;
    const t = anim.time, sp = 10;
    const lLeg = anim.bones['Left_Leg'],  rLeg = anim.bones['Right_Leg'];
    const lArm = anim.bones['Left_Arm'],  rArm = anim.bones['Right_Arm'];
    const torso = anim.bones['Torso'];
    const lArmRestY = anim.rest['Left_Arm']?.py  ?? 0;
    const rArmRestY = anim.rest['Right_Arm']?.py ?? 0;
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
    if (lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY + 0.5, Math.min(1, sp*dt));
    if (rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY + 0.5, Math.min(1, sp*dt));
}

function updateAnimations(dt, moving) {
    anim.time += dt;
    const t = anim.time, sp = 12;
    const lLeg = anim.bones['Left_Leg'],  rLeg = anim.bones['Right_Leg'];
    const lArm = anim.bones['Left_Arm'],  rArm = anim.bones['Right_Arm'];
    const torso = anim.bones['Torso'];
    const lArmRestY = anim.rest['Left_Arm']?.py  ?? 0;
    const rArmRestY = anim.rest['Right_Arm']?.py ?? 0;

    if (!grounded) {
        setRot(lLeg,  'x',  0,       sp, dt);
        setRot(rLeg,  'x',  0,       sp, dt);
        setRot(lArm,  'x', -Math.PI, sp, dt);
        setRot(rArm,  'x', -Math.PI, sp, dt);
        setRot(lArm,  'z',  0,       sp, dt);
        setRot(rArm,  'z',  0,       sp, dt);
        setRot(torso, 'x',  0,       sp, dt);
        if (lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY - 0.75, Math.min(1, sp*dt));
        if (rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY - 0.75, Math.min(1, sp*dt));
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
        if (lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*dt));
        if (rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*dt));
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
        if (lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*dt));
        if (rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*dt));
    }
}

// ─── Character model load ─────────────────────────────────────────────────────
let character = null;
let _spawnPoint = { x: 0, y: null, z: 0, ry: Math.PI };
const otherPlayers = new Map();

const fbxLoader = new FBXLoader();
const headTexture = tlLoader.load(headTextureUrl);
headTexture.colorSpace = THREE.SRGBColorSpace;

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
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
                if (!mat) continue;
                if (mat.name?.includes('Head')) {
                    mat.map = headTexture;
                    mat.alphaTest = 0.05;
                    mat.needsUpdate = true;
                }
            }
        }
    });

    scene.add(fbx);
    character = fbx;

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

function resolveOBBH(nearby) {
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
            continue;
        }
        character.position.x += nx * depth;
        character.position.z += nz * depth;
        pushedBlocks.add(b);
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
    }
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
        const yLo = Math.max(fy, b.minY), yHi = Math.min(fy+CHAR_HEIGHT, b.maxY);
        if (yHi - yLo < 0.02) continue;
        const { ov0, ov1, dx, dz } = r;
        if (ov0 <= ov1) character.position.x -= Math.sign(dx) * ov0;
        else            character.position.z -= Math.sign(dz) * ov1;
        pushedBlocks.add(b);
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
    const nearby = getNearbyColliders(px, footY + CHAR_HEIGHT/2, pz);
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
    const nearby = getNearbyColliders(px, ledgeY, pz);
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
    const nearby = getNearbyColliders(px, ledgeY, pz);
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

function update(dt) {
    if (!character) return;

    if (keys['KeyI']) cam.targetDistance = Math.max(cam.minDist, cam.targetDistance - CAM_KEY_ZOOM_SPEED * dt);
    if (keys['KeyO']) cam.targetDistance = Math.min(cam.maxDist, cam.targetDistance + CAM_KEY_ZOOM_SPEED * dt);
    cam.distance = THREE.MathUtils.lerp(cam.distance, cam.targetDistance, Math.min(1, 10 * dt));

    // ── Climbing state ──────────────────────────────────────────────────────
    if (climbState === 'hanging') {
        const px0 = character.position.x, pz0 = character.position.z;
        let footY = character.position.y - CHAR_FOOT_OFFSET;

        const stillValid = findClimbableBlock(px0, pz0, footY, climbFwdX, climbFwdZ);
        if (!stillValid) { climbState = 'none'; climbCooldown = 0.25; updateClimbAnimation(dt); return; }
        climbBlock  = stillValid;
        climbLedgeY = stillValid.maxY;

        if (shiftLock) {
            const grabAngle = Math.atan2(climbFwdX, climbFwdZ);
            const camAngle  = cam.yaw + Math.PI;
            const diff = ((camAngle - grabAngle) % (2*Math.PI) + 3*Math.PI) % (2*Math.PI) - Math.PI;
            if (Math.abs(diff) > Math.PI/4) { climbState = 'none'; climbCooldown = 0.25; velY = 0; updateClimbAnimation(dt); return; }
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
            updateClimbAnimation(dt); return;
        }

        const pressW = !!(keys['KeyW'] || keys['ArrowUp']);
        const pressS = !!(keys['KeyS'] || keys['ArrowDown']);
        const rawVert = (pressW ? 1 : 0) - (pressS ? 1 : 0);
        const anyInput = rawVert !== 0;

        if (rawVert < -0.1 && footY <= G_LEVEL + 0.15) {
            character.position.y = CHAR_STAND_Y;
            climbState = 'none'; climbCooldown = 0; velY = 0;
            updateClimbAnimation(dt); return;
        }

        velY = 0;
        character.position.y += rawVert * CLIMB_RISE_SPEED * dt;
        footY = character.position.y - CHAR_FOOT_OFFSET;

        if (rawVert < 0 && footY < climbLedgeY - HANG_DEPTH) {
            const belowBlock = findChainBlockBelow(character.position.x, character.position.z, climbLedgeY);
            if (belowBlock) { climbBlock = belowBlock; climbLedgeY = belowBlock.maxY; }
            else { climbState = 'none'; climbCooldown = 0.1; velY = -2; updateClimbAnimation(dt); return; }
        }

        if (footY < G_LEVEL) {
            character.position.y = CHAR_STAND_Y;
            climbState = 'none'; climbCooldown = 0; velY = 0;
            updateClimbAnimation(dt); return;
        }

        footY = character.position.y - CHAR_FOOT_OFFSET;
        if (footY >= climbLedgeY) {
            const chainBlock = findChainBlockAbove(character.position.x, character.position.z, climbLedgeY);
            if (chainBlock) { climbBlock = chainBlock; climbLedgeY = chainBlock.maxY; }
            else if (rawVert > 0.3) {
                character.position.x += climbFwdX * 0.4;
                character.position.z += climbFwdZ * 0.4;
                climbState = 'none'; velY = 2;
                updateClimbAnimation(dt); return;
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

        updateClimbAnimation(dt, anyInput);
        return;
    }

    // ── Normal movement ─────────────────────────────────────────────────────
    const moveInput = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp'])    moveInput.z -= 1;
    if (keys['KeyS'] || keys['ArrowDown'])  moveInput.z += 1;
    if (keys['KeyA'] || keys['ArrowLeft'])  moveInput.x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveInput.x += 1;

    if (joystickActive) {
        moveInput.x += joystickVector.x;
        moveInput.z += joystickVector.y;
    }

    const moving = moveInput.lengthSq() > 0;
    let velX = 0, velZ = 0;

    if (moving) {
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

    // Axis-separated movement with per-axis wall blocking
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
            if (character.position.z+halfZ <= b.minZ || character.position.z-halfZ >= b.maxZ) continue;
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
            if (character.position.x+halfX <= b.minX || character.position.x-halfX >= b.maxX) continue;
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

    if (shiftLock) character.rotation.y = cam.yaw + Math.PI;

    climbCooldown = Math.max(0, climbCooldown - dt);

    const nearby = getNearbyColliders(character.position.x, character.position.y, character.position.z);

    resolveBlocksH(nearby);
    resolveOBBH(nearby);
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
    if (character.position.y <= CHAR_STAND_Y) {
        character.position.y = CHAR_STAND_Y;
        velY = 0;
        grounded = true;
        extraVelX = 0; extraVelZ = 0;
    }

    resolveBlocksV(nearby);
    resolveOBBV(nearby);

    if (jumpBuffer > 0 && (grounded || coyoteTimer > 0)) {
        velY = JUMP_POWER;
        grounded = false;
        coyoteTimer = 0;
        jumpBuffer  = 0;
    }

    // Respawn if fallen off
    if (character.position.y < -100) {
        character.position.set(_spawnPoint.x, CHAR_STAND_Y, _spawnPoint.z);
        velY = 0; extraVelX = 0; extraVelZ = 0;
    }

    updateAnimations(dt, moving);

    // Update other players
    otherPlayers.forEach((p, userId) => {
        if (!p.mesh) return;
        // Interpolate position and rotation
        p.mesh.position.lerp(new THREE.Vector3(p.targetX, p.targetY, p.targetZ), Math.min(1, dt * 10));
        p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, p.targetRy, Math.min(1, dt * 10));
        
        // Simple animation (reuse logic)
        p.animTime = (p.animTime || 0) + dt;
        const t = p.animTime, sp = 12;
        const lLeg = p.bones['Left_Leg'],  rLeg = p.bones['Right_Leg'];
        const lArm = p.bones['Left_Arm'],  rArm = p.bones['Right_Arm'];
        const torso = p.bones['Torso'];
        const lArmRestY = p.rest['Left_Arm']?.py ?? 0;
        const rArmRestY = p.rest['Right_Arm']?.py ?? 0;

        if (p.climbState > 0) {
            // Match local climb animation: arms up, legs kicking
            const grip = p.moving ? Math.sin(p.animTime * 6) * 0.15 : 0;
            if(lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x||0) - Math.PI*0.75 + grip, Math.min(1, sp*dt));
            if(rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x||0) - Math.PI*0.75 - grip, Math.min(1, sp*dt));
            if(lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z||0) + 0.35, Math.min(1, sp*dt));
            if(rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z||0) - 0.35, Math.min(1, sp*dt));
            const kick = p.moving ? Math.sin(p.animTime * 6) * 0.3 : 0;
            if(lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x||0) + 0.3 + kick, Math.min(1, sp*dt));
            if(rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x||0) + 0.3 - kick, Math.min(1, sp*dt));
            if(torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x||0) - 0.15, Math.min(1, sp*dt));
            if(torso) torso.rotation.z = THREE.MathUtils.lerp(torso.rotation.z, (p.rest['Torso']?.z||0), Math.min(1, sp*dt));
            const lArmRestY = p.rest['Left_Arm']?.py ?? 0;
            const rArmRestY = p.rest['Right_Arm']?.py ?? 0;
            if(lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY + 0.5, Math.min(1, sp*dt));
            if(rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY + 0.5, Math.min(1, sp*dt));
        } else if (p.grounded === false) {
            if(lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x||0), Math.min(1, sp*dt));
            if(rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x||0), Math.min(1, sp*dt));
            if(lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x||0) - Math.PI, Math.min(1, sp*dt));
            if(rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x||0) - Math.PI, Math.min(1, sp*dt));
            if(lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z||0), Math.min(1, sp*dt));
            if(rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z||0), Math.min(1, sp*dt));
            if(torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x||0), Math.min(1, sp*dt));
            const lArmRestY = p.rest['Left_Arm']?.py ?? 0;
            const rArmRestY = p.rest['Right_Arm']?.py ?? 0;
            if(lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*dt));
            if(rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*dt));
        } else if (p.moving) {
            const swing = Math.sin(t * 2.8 * Math.PI);
            const lArmRestY = p.rest['Left_Arm']?.py ?? 0;
            const rArmRestY = p.rest['Right_Arm']?.py ?? 0;
            if(lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x||0) + swing * 1.0, Math.min(1, sp*dt));
            if(rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x||0) - swing * 1.0, Math.min(1, sp*dt));
            if(lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x||0) - swing * 0.8, Math.min(1, sp*dt));
            if(rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x||0) + swing * 0.8, Math.min(1, sp*dt));
            if(lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z||0) + 0.05, Math.min(1, sp*dt));
            if(rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z||0) - 0.05, Math.min(1, sp*dt));
            if(torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x||0) + 0.03, Math.min(1, sp*dt));
            if(lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*dt));
            if(rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*dt));
        } else {
            const breathe = Math.sin(t * 1.2) * 0.015;
            const lArmRestY = p.rest['Left_Arm']?.py ?? 0;
            const rArmRestY = p.rest['Right_Arm']?.py ?? 0;
            if(lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, (p.rest['Left_Leg']?.x||0), Math.min(1, sp*dt));
            if(rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, (p.rest['Right_Leg']?.x||0), Math.min(1, sp*dt));
            if(lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, (p.rest['Left_Arm']?.x||0), Math.min(1, sp*dt));
            if(rArm) rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, (p.rest['Right_Arm']?.x||0), Math.min(1, sp*dt));
            if(lArm) lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, (p.rest['Left_Arm']?.z||0) + 0.1 + breathe, Math.min(1, sp*dt));
            if(rArm) rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, (p.rest['Right_Arm']?.z||0) - 0.1 - breathe, Math.min(1, sp*dt));
            if(torso) torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, (p.rest['Torso']?.x||0) + breathe, Math.min(1, sp*dt));
            if(lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*dt));
            if(rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*dt));
        }
    });
}

// ─── Camera update ────────────────────────────────────────────────────────────
function updateCamera() {
    if (!character) return;

    const sinYaw   = Math.sin(cam.yaw);
    const cosYaw   = Math.cos(cam.yaw);
    const sinPitch = Math.sin(cam.pitch);
    const cosPitch = Math.cos(cam.pitch);

    const pivot = new THREE.Vector3(
        character.position.x,
        character.position.y + CAM_PIVOT_Y,
        character.position.z
    );

    if (shiftLock) {
        pivot.x += cosYaw * SHIFT_LOCK_OFFSET;
        pivot.z += -sinYaw * SHIFT_LOCK_OFFSET;
    }

    camera.position.set(
        pivot.x + cam.distance * cosPitch * sinYaw,
        pivot.y + cam.distance * sinPitch,
        pivot.z + cam.distance * cosPitch * cosYaw
    );
    camera.lookAt(pivot);
}

// ─── Public API ───────────────────────────────────────────────────────────────
window._bloxverse = {
    scene,
    getCharacter:  () => character,
    getGrounded:   () => grounded,
    getVelY:       () => velY,
    getClimbState: () => climbState,
    keys,
    setSens(mult) {
        CAM_H_SENS = 0.002 * Math.PI * mult;
        CAM_V_SENS = 0.0015 * Math.PI * mult;
    },
    requestLock() { renderer.domElement.requestPointerLock(); },
    async loadMap(path, tx = 0, ty = 0, tz = 0) {
        const parts = await fetch(path).then(r => r.json());
        const valid = parts.filter(p => p.Type === 'Part' && p.Shape === 'Block');
        if (!valid.length) return;
        let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
        for (const p of valid) {
            const [px,py,pz] = p.Position, [sw,sh,sd] = p.Size;
            minX=Math.min(minX,px-sw/2); maxX=Math.max(maxX,px+sw/2);
            minY=Math.min(minY,py-sh/2); maxY=Math.max(maxY,py+sh/2);
            minZ=Math.min(minZ,pz-sd/2); maxZ=Math.max(maxZ,pz+sd/2);
        }
        const ox=tx-(minX+maxX)/2, oy=G_LEVEL-minY, oz=tz-(minZ+maxZ)/2;
        for (const p of valid) {
            const [sw,sh,sd]=p.Size, [px,py,pz]=p.Position, [rx,ry,rz]=p.Rotation, [cr,cg,cb]=p.Color;
            const color=(Math.round(cr*255)<<16)|(Math.round(cg*255)<<8)|Math.round(cb*255);
            addStud(sw,sh,sd,color,px+ox,(py-sh/2)+oy,pz+oz,rx*DEG2RAD,ry*DEG2RAD,rz*DEG2RAD);
        }
        _spawnPoint = { x: tx, y: G_LEVEL, z: tz + 4, ry: Math.PI };
        if (character) {
            character.position.set(_spawnPoint.x, _spawnPoint.y + CHAR_FOOT_OFFSET, _spawnPoint.z);
            character.rotation.y = _spawnPoint.ry;
        }
    },
    getCamera: () => camera,
    getCharBubbleBase: () => character ? character.position.y + CHAR_HEIGHT - CHAR_FOOT_OFFSET + 0.4 : 0,
    setSpawn(x, y, z, ry = Math.PI) {
        _spawnPoint = { x, y, z, ry };
        if (character) {
            character.position.set(x, y + CHAR_FOOT_OFFSET, z);
            character.rotation.y = ry;
        }
    },
    getLocalTransform: () => {
        if (!character) return null;
        let isMoving = false;
        if (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] || keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'] || joystickActive) isMoving = true;
        const sendClimb = typeof climbState === 'number' && climbState > 0 ? climbState : (climbState === 'hanging' ? 1 : 0);
        // Add PI so other players see correct forward direction
        return { x: character.position.x, y: character.position.y, z: character.position.z, ry: character.rotation.y + Math.PI, moving: isMoving, grounded: grounded, climbState: sendClimb };
    },
    updateOtherPlayer: (userId, x, y, z, ry, moving, grounded, climbState) => {
        if (!character) return; // Not fully loaded yet
        // Negate rotation to fix forward direction
        const correctedRy = -ry;
        let p = otherPlayers.get(userId);
        if (!p) {
            // Clone character
            const clone = SkeletonUtils.clone(character);
            const bones = {};
            const rest = {};
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
                }
            });
            clone.position.set(x, y, z);
            clone.rotation.y = correctedRy;
            scene.add(clone);
            p = { mesh: clone, bones, rest, targetX: x, targetY: y, targetZ: z, targetRy: correctedRy, moving, grounded, climbState, animTime: 0 };
            otherPlayers.set(userId, p);
        } else {
            p.targetX = x; p.targetY = y; p.targetZ = z; p.targetRy = correctedRy; p.moving = moving; p.grounded = grounded; p.climbState = climbState;
        }
    },
    removeOtherPlayer: (userId) => {
        const p = otherPlayers.get(userId);
        if (p && p.mesh) {
            scene.remove(p.mesh);
        }
        otherPlayers.delete(userId);
    }
};

// ─── Game loop ────────────────────────────────────────────────────────────────
let lastTime = performance.now();

function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    update(dt);
    updateCamera();

    if (charDebugMesh && character) {
        const fy = character.position.y - CHAR_FOOT_OFFSET;
        charDebugMesh.position.set(character.position.x, fy + CHAR_HEIGHT/2, character.position.z);
        charDebugMesh.rotation.y = character.rotation.y;
    }
    updateDebugMeshes();

    window._mpUpdate?.(dt);

    renderer.render(scene, camera);
}

requestAnimationFrame(loop);
