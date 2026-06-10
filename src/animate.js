import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const playerModelUrl = new URL('../assets/models/player.fbx', import.meta.url).href;

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
    model: null,
    bones: {},           // name -> THREE.Bone
    restPose: {},        // name -> { x, y, z }
    selectedBone: null,
    keyframes: [],       // { time, bones: { name: { x, y, z } } }
    duration: 3,
    currentTime: 0,
    isPlaying: false,
    selectedKF: -1,      // index into keyframes, -1 = none
    copiedKeyframe: null,
    modelLoaded: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
    container: $('viewport-container'),
    loading: $('loading'),
    boneItems: $('bone-items'),
    selectedBoneLabel: $('selected-bone-label'),
    rotX: $('rot-x'), rotY: $('rot-y'), rotZ: $('rot-z'),
    rotXVal: $('rot-x-val'), rotYVal: $('rot-y-val'), rotZVal: $('rot-z-val'),
    rotXDeg: $('rot-x-deg'), rotYDeg: $('rot-y-deg'), rotZDeg: $('rot-z-deg'),
    btnResetBone: $('btn-reset-bone'),
    posX: $('pos-x'), posY: $('pos-y'), posZ: $('pos-z'),
    posXVal: $('pos-x-val'), posYVal: $('pos-y-val'), posZVal: $('pos-z-val'),
    btnResetPos: $('btn-reset-pos'),
    btnPlay: $('btn-play'),
    btnAddKF: $('btn-add-kf'),
    btnDelKF: $('btn-del-kf'),
    btnExport: $('btn-export'),
    btnImport: $('btn-import'),
    fileInput: $('file-input'),
    timelineTrack: $('timeline-track'),
    playhead: $('playhead'),
    kfCount: $('kf-count'),
    kfInfo: $('kf-info'),
    timeCurrent: $('time-current'),
    timeTotal: $('time-total'),
    emoteId: $('emote-id'),
    emoteName: $('emote-name'),
    emoteDuration: $('emote-duration'),
};

// ─── Three.js setup ───────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x222222, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

dom.container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x222222, 20, 40);

const camera = new THREE.PerspectiveCamera(45, dom.container.clientWidth / dom.container.clientHeight, 0.1, 100);
camera.position.set(5, 4, 7);
camera.lookAt(0, 1.5, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.update();

const xformControls = new TransformControls(camera, renderer.domElement);
xformControls.setMode('rotate');
xformControls.setSize(0.8);
const xformHelper = xformControls.getHelper();
if (xformHelper) scene.add(xformHelper);
xformControls.addEventListener('dragging-changed', (event) => {
    controls.enabled = !event.value;
});
xformControls.addEventListener('change', () => {
    if (state.selectedBone) updateSliderValues();
});

// Lights
const ambient = new THREE.AmbientLight(0x404060, 0.6);
scene.add(ambient);

const hemi = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.8);
scene.add(hemi);

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.8);
dirLight.position.set(8, 12, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near = 0.1;
dirLight.shadow.camera.far = 25;
dirLight.shadow.camera.left = -8;
dirLight.shadow.camera.right = 8;
dirLight.shadow.camera.top = 8;
dirLight.shadow.camera.bottom = -8;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
fillLight.position.set(-4, 3, -4);
scene.add(fillLight);

// Ground
const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
gridHelper.position.y = -0.01;
scene.add(gridHelper);

// ─── Render loop ──────────────────────────────────────────────────────────────
function animateScene() {
    requestAnimationFrame(animateScene);
    controls.update();
    renderer.render(scene, camera);
}
animateScene();

function resize() {
    const w = dom.container.clientWidth;
    const h = dom.container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(dom.container);
resize();

// ─── Model loading ────────────────────────────────────────────────────────────
const KNOWN_BONES = ['Head', 'Torso', 'Left_Arm', 'Right_Arm', 'Left_Leg', 'Right_Leg'];

const fbxLoader = new FBXLoader();
fbxLoader.load(playerModelUrl, (fbx) => {
    fbx.position.set(0, -0.01, 0);
    fbx.updateMatrixWorld(true);
    scene.add(fbx);
    state.model = fbx;

    fbx.traverse(child => {
        if (child.isBone || child.type === 'Bone') {
            state.bones[child.name] = child;
            state.restPose[child.name] = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z, px: child.position.x, py: child.position.y, pz: child.position.z };
        }
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    dom.loading.style.display = 'none';
    state.modelLoaded = true;
    buildBoneList();
    applyPose();
}, undefined, (err) => {
    dom.loading.textContent = 'Failed to load model. Check console.';
    console.error('FBX load error:', err);
});

// ─── Bone list ────────────────────────────────────────────────────────────────
function buildBoneList() {
    const ordered = KNOWN_BONES.filter(n => state.bones[n]);
    const extra = Object.keys(state.bones).filter(n => !KNOWN_BONES.includes(n));
    const all = [...ordered, ...extra.sort()];
    dom.boneItems.innerHTML = '';
    for (const name of all) {
        const li = document.createElement('li');
        li.dataset.bone = name;
        const badge = document.createElement('span');
        badge.className = 'badge idle';
        li.appendChild(badge);
        li.append(name);
        li.addEventListener('click', () => selectBone(name));
        dom.boneItems.appendChild(li);
    }
}

function selectBone(name) {
    state.selectedBone = name;
    dom.boneItems.querySelectorAll('li').forEach(li => li.classList.toggle('selected', li.dataset.bone === name));
    dom.selectedBoneLabel.textContent = name;
    document.getElementById('selected-bone-label-pos').textContent = name;
    if (!state.isPlaying && state.bones[name]) {
        xformControls.attach(state.bones[name]);
    } else {
        xformControls.detach();
    }
    updateSliderValues();
}

function updateSliderValues() {
    const bone = state.selectedBone ? state.bones[state.selectedBone] : null;
    if (!bone) {
        dom.rotX.value = 0; dom.rotY.value = 0; dom.rotZ.value = 0;
        dom.rotXVal.textContent = '0.00'; dom.rotYVal.textContent = '0.00'; dom.rotZVal.textContent = '0.00';
        dom.rotXDeg.textContent = '0°'; dom.rotYDeg.textContent = '0°'; dom.rotZDeg.textContent = '0°';
        dom.rotX.disabled = dom.rotY.disabled = dom.rotZ.disabled = true;
        dom.btnResetBone.disabled = true;
        dom.posXVal.textContent = '0.00'; dom.posYVal.textContent = '0.00'; dom.posZVal.textContent = '0.00';
        dom.posX.disabled = dom.posY.disabled = dom.posZ.disabled = true;
        dom.btnResetPos.disabled = true;
        return;
    }
    dom.rotX.disabled = dom.rotY.disabled = dom.rotZ.disabled = false;
    dom.btnResetBone.disabled = false;
    dom.posX.disabled = dom.posY.disabled = dom.posZ.disabled = false;
    dom.btnResetPos.disabled = false;
    const rest = state.restPose[state.selectedBone] || { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0 };
    const offX = bone.rotation.x - rest.x;
    const offY = bone.rotation.y - rest.y;
    const offZ = bone.rotation.z - rest.z;
    setSlider('rotX', offX);
    setSlider('rotY', offY);
    setSlider('rotZ', offZ);
    const pOffX = bone.position.x - (rest.px ?? 0);
    const pOffY = bone.position.y - (rest.py ?? 0);
    const pOffZ = bone.position.z - (rest.pz ?? 0);
    dom.posX.value = Math.max(parseFloat(dom.posX.min), Math.min(parseFloat(dom.posX.max), pOffX));
    dom.posXVal.textContent = parseFloat(dom.posX.value).toFixed(2);
    dom.posY.value = Math.max(parseFloat(dom.posY.min), Math.min(parseFloat(dom.posY.max), pOffY));
    dom.posYVal.textContent = parseFloat(dom.posY.value).toFixed(2);
    dom.posZ.value = Math.max(parseFloat(dom.posZ.min), Math.min(parseFloat(dom.posZ.max), pOffZ));
    dom.posZVal.textContent = parseFloat(dom.posZ.value).toFixed(2);
}

function setSlider(id, val) {
    const el = dom[id];
    el.value = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), val));
    const v = parseFloat(el.value);
    dom[id + 'Val'].textContent = v.toFixed(2);
    dom[id + 'Deg'].textContent = (v * 180 / Math.PI).toFixed(1) + '°';
}

// ─── Rotation controls ────────────────────────────────────────────────────────
['rotX', 'rotY', 'rotZ'].forEach(id => {
    dom[id].addEventListener('input', () => {
        if (!state.selectedBone) return;
        const axis = id === 'rotX' ? 'x' : id === 'rotY' ? 'y' : 'z';
        const val = parseFloat(dom[id].value);
        dom[id + 'Val'].textContent = val.toFixed(2);
        dom[id + 'Deg'].textContent = (val * 180 / Math.PI).toFixed(1) + '°';
        xformControls.detach();
        poseBone(state.selectedBone, axis, val);
        if (!state.isPlaying) xformControls.attach(state.bones[state.selectedBone]);
        updateBoneBadge(state.selectedBone);
    });
});

function poseBone(name, axis, offset) {
    const bone = state.bones[name];
    if (!bone) return;
    const rest = state.restPose[name] || { x: 0, y: 0, z: 0 };
    bone.rotation[axis] = rest[axis] + offset;
}

function getOffset(name) {
    const bone = state.bones[name];
    if (!bone) return { x: 0, y: 0, z: 0 };
    const rest = state.restPose[name] || { x: 0, y: 0, z: 0 };
    return {
        x: bone.rotation.x - rest.x,
        y: bone.rotation.y - rest.y,
        z: bone.rotation.z - rest.z,
    };
}

// ─── Position controls ────────────────────────────────────────────────────────
['posX', 'posY', 'posZ'].forEach(id => {
    dom[id].addEventListener('input', () => {
        if (!state.selectedBone) return;
        const axis = id === 'posX' ? 'x' : id === 'posY' ? 'y' : 'z';
        const val = parseFloat(dom[id].value);
        dom[id + 'Val'].textContent = val.toFixed(2);
        xformControls.detach();
        poseBonePos(state.selectedBone, axis, val);
        if (!state.isPlaying) xformControls.attach(state.bones[state.selectedBone]);
        updateBoneBadge(state.selectedBone);
    });
});

function poseBonePos(name, axis, offset) {
    const bone = state.bones[name];
    if (!bone) return;
    const rest = state.restPose[name] || { px: 0, py: 0, pz: 0 };
    const restAxis = 'p' + axis;
    bone.position[axis] = (rest[restAxis] ?? 0) + offset;
}

function getPosOffset(name) {
    const bone = state.bones[name];
    if (!bone) return { px: 0, py: 0, pz: 0 };
    const rest = state.restPose[name] || { px: 0, py: 0, pz: 0 };
    return {
        px: bone.position.x - (rest.px ?? 0),
        py: bone.position.y - (rest.py ?? 0),
        pz: bone.position.z - (rest.pz ?? 0),
    };
}

dom.btnResetBone.addEventListener('click', () => {
    if (!state.selectedBone) return;
    xformControls.detach();
    poseBone(state.selectedBone, 'x', 0);
    poseBone(state.selectedBone, 'y', 0);
    poseBone(state.selectedBone, 'z', 0);
    if (!state.isPlaying) xformControls.attach(state.bones[state.selectedBone]);
    updateSliderValues();
    updateBoneBadge(state.selectedBone);
});

dom.btnResetPos.addEventListener('click', () => {
    if (!state.selectedBone) return;
    xformControls.detach();
    poseBonePos(state.selectedBone, 'x', 0);
    poseBonePos(state.selectedBone, 'y', 0);
    poseBonePos(state.selectedBone, 'z', 0);
    if (!state.isPlaying) xformControls.attach(state.bones[state.selectedBone]);
    updateSliderValues();
    updateBoneBadge(state.selectedBone);
});

function updateBoneBadge(name) {
    const off = getOffset(name);
    const pOff = getPosOffset(name);
    const isPosed = Math.abs(off.x) > 0.001 || Math.abs(off.y) > 0.001 || Math.abs(off.z) > 0.001
        || Math.abs(pOff.px) > 0.001 || Math.abs(pOff.py) > 0.001 || Math.abs(pOff.pz) > 0.001;
    const li = dom.boneItems.querySelector(`li[data-bone="${name}"]`);
    if (li) {
        const badge = li.querySelector('.badge');
        badge.className = 'badge ' + (isPosed ? 'posed' : 'idle');
    }
}

// ─── Apply pose from keyframes at a given time ────────────────────────────────
function applyPose(time) {
    if (!state.modelLoaded) return;
    time = time ?? state.currentTime;
    xformControls.detach();
    if (state.keyframes.length === 0) {
        // Reset all bones to rest
        for (const name in state.bones) {
            const rest = state.restPose[name] || { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0 };
            const bone = state.bones[name];
            bone.rotation.x = rest.x;
            bone.rotation.y = rest.y;
            bone.rotation.z = rest.z;
            bone.position.x = rest.px ?? 0;
            bone.position.y = rest.py ?? 0;
            bone.position.z = rest.pz ?? 0;
        }
        if (state.selectedBone) updateSliderValues();
        return;
    }

    const kfs = state.keyframes;
    let prevKF = kfs[0];
    let nextKF = kfs[kfs.length - 1];
    if (kfs.length === 1 || time <= kfs[0].time) {
        prevKF = nextKF = kfs[0];
    } else if (time >= kfs[kfs.length - 1].time) {
        prevKF = nextKF = kfs[kfs.length - 1];
    } else {
        for (let i = 0; i < kfs.length - 1; i++) {
            if (time >= kfs[i].time && time <= kfs[i + 1].time) {
                prevKF = kfs[i];
                nextKF = kfs[i + 1];
                break;
            }
        }
    }
    const range = nextKF.time - prevKF.time;
    const t = range === 0 ? 0 : (time - prevKF.time) / range;

    // Collect all bone and position bone names
    const allNames = new Set();
    const allPosNames = new Set();
    for (const kf of [prevKF, nextKF]) {
        if (kf.bones) for (const n in kf.bones) allNames.add(n);
        if (kf.position) for (const n in kf.position) allPosNames.add(n);
    }

    // Reset non-animated bones to rest (rotation + position)
    for (const name in state.bones) {
        const rest = state.restPose[name] || { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0 };
        const bone = state.bones[name];
        if (!allNames.has(name)) {
            bone.rotation.x = rest.x;
            bone.rotation.y = rest.y;
            bone.rotation.z = rest.z;
        }
        if (!allPosNames.has(name)) {
            bone.position.x = rest.px ?? 0;
            bone.position.y = rest.py ?? 0;
            bone.position.z = rest.pz ?? 0;
        }
    }

    // Interpolate rotation for animated bones
    for (const name of allNames) {
        const bone = state.bones[name];
        if (!bone) continue;
        const rest = state.restPose[name] || { x: 0, y: 0, z: 0 };
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

    // Interpolate position for animated bones
    for (const name of allPosNames) {
        const bone = state.bones[name];
        if (!bone) continue;
        const rest = state.restPose[name] || { px: 0, py: 0, pz: 0 };
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

    // Update bone badges
    for (const name in state.bones) updateBoneBadge(name);

    if (state.selectedBone) updateSliderValues();
}

// ─── Timeline / Playback ──────────────────────────────────────────────────────
function setCurrentTime(time) {
    state.currentTime = Math.max(0, Math.min(state.duration, time));
    dom.playhead.style.left = (state.currentTime / state.duration * 100) + '%';
    dom.timeCurrent.textContent = state.currentTime.toFixed(2) + 's';
    applyPose();
}

let _lastPlayTime = 0;

function togglePlay() {
    state.isPlaying = !state.isPlaying;
    dom.btnPlay.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
    if (state.isPlaying) {
        _lastPlayTime = performance.now();
        xformControls.detach();
    } else if (state.selectedBone && state.bones[state.selectedBone]) {
        xformControls.attach(state.bones[state.selectedBone]);
    }
    if (state.isPlaying && state.currentTime >= state.duration) {
        setCurrentTime(0);
    }
}

function playbackLoop(now) {
    if (state.isPlaying && state.modelLoaded) {
        const realDt = Math.min((now - _lastPlayTime) / 1000, 0.1);
        _lastPlayTime = now;
        let next = state.currentTime + realDt;
        if (next >= state.duration) {
            next = state.duration;
            state.isPlaying = false;
            dom.btnPlay.textContent = '▶ Play';
        }
        setCurrentTime(next);
    }
    requestAnimationFrame(playbackLoop);
}
requestAnimationFrame(playbackLoop);

// ─── Keyframe management ──────────────────────────────────────────────────────
function addKeyframe() {
    if (!state.modelLoaded) return;
    const time = state.currentTime;

    // Save all bone offsets at current time
    const bones = {};
    const position = {};
    for (const name in state.bones) {
        const off = getOffset(name);
        if (Math.abs(off.x) > 0.0001 || Math.abs(off.y) > 0.0001 || Math.abs(off.z) > 0.0001) {
            bones[name] = {};
            if (Math.abs(off.x) > 0.0001) bones[name].x = off.x;
            if (Math.abs(off.y) > 0.0001) bones[name].y = off.y;
            if (Math.abs(off.z) > 0.0001) bones[name].z = off.z;
        }
        const pOff = getPosOffset(name);
        if (Math.abs(pOff.px) > 0.0001 || Math.abs(pOff.py) > 0.0001 || Math.abs(pOff.pz) > 0.0001) {
            position[name] = {};
            if (Math.abs(pOff.px) > 0.0001) position[name].px = pOff.px;
            if (Math.abs(pOff.py) > 0.0001) position[name].py = pOff.py;
            if (Math.abs(pOff.pz) > 0.0001) position[name].pz = pOff.pz;
        }
    }

    // Remove existing keyframe at same time (rounded to 2 decimals)
    const roundedTime = Math.round(time * 100) / 100;
    state.keyframes = state.keyframes.filter(kf => Math.round(kf.time * 100) / 100 !== roundedTime);

    state.keyframes.push({ time: roundedTime, bones, position });
    state.keyframes.sort((a, b) => a.time - b.time);
    state.selectedKF = state.keyframes.findIndex(kf => Math.round(kf.time * 100) / 100 === roundedTime);
    updateTimelineUI();
}

function deleteSelectedKeyframe() {
    if (state.selectedKF < 0 || state.selectedKF >= state.keyframes.length) return;
    state.keyframes.splice(state.selectedKF, 1);
    state.selectedKF = -1;
    updateTimelineUI();
    applyPose();
}

function updateTimelineUI() {
    // Remove old markers
    dom.timelineTrack.querySelectorAll('.kf-marker').forEach(el => el.remove());

    for (let i = 0; i < state.keyframes.length; i++) {
        const kf = state.keyframes[i];
        const marker = document.createElement('div');
        marker.className = 'kf-marker' + (i === state.selectedKF ? ' selected' : '');
        marker.style.left = (kf.time / state.duration * 100) + '%';
        marker.title = `KF ${i}: ${kf.time.toFixed(2)}s`;
        marker.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            state.selectedKF = i;
            updateTimelineUI();
            const rect = dom.timelineTrack.getBoundingClientRect();
            const startX = e.clientX;
            let moved = false;
            function onMove(ev) {
                if (Math.abs(ev.clientX - startX) > 3) moved = true;
                const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                marker.style.left = (pct * 100) + '%';
            }
            function onUp(ev) {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                if (!moved) { setCurrentTime(kf.time); return; }
                const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                const newTime = Math.round(pct * state.duration * 100) / 100;
                kf.time = newTime;
                state.keyframes.sort((a, b) => a.time - b.time);
                state.selectedKF = state.keyframes.indexOf(kf);
                updateTimelineUI();
                applyPose();
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
        dom.timelineTrack.appendChild(marker);
    }

    dom.kfCount.textContent = state.keyframes.length + ' keyframes';
    if (state.selectedKF >= 0 && state.selectedKF < state.keyframes.length) {
        const kf = state.keyframes[state.selectedKF];
        const bones = Object.keys(kf.bones);
        const posBones = Object.keys(kf.position || {});
        const parts = [];
        if (bones.length > 0) parts.push('rot: ' + bones.join(', '));
        if (posBones.length > 0) parts.push('pos: ' + posBones.join(', '));
        dom.kfInfo.textContent = `KF ${state.selectedKF} @ ${kf.time.toFixed(2)}s — ${parts.length > 0 ? parts.join(' | ') : '(rest pose)'}`;
    } else {
        dom.kfInfo.textContent = '';
    }
}

// Drag on timeline to scrub
let _scrubbing = false;

function scrubFromEvent(e) {
    const rect = dom.timelineTrack.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setCurrentTime(pct * state.duration);
}

dom.timelineTrack.addEventListener('mousedown', (e) => {
    _scrubbing = true;
    scrubFromEvent(e);
});
window.addEventListener('mousemove', (e) => {
    if (_scrubbing) scrubFromEvent(e);
});
window.addEventListener('mouseup', () => { _scrubbing = false; });

// ─── Export ────────────────────────────────────────────────────────────────────
function exportJSON() {
    const id = dom.emoteId.value.trim() || 'custom_emote';
    const name = dom.emoteName.value.trim() || 'Custom Emote';
    const duration = parseFloat(dom.emoteDuration.value) || 3;

    const data = {
        id,
        name,
        duration,
        keyframes: state.keyframes.map(kf => ({
            time: kf.time,
            bones: kf.bones,
            position: kf.position,
        })),
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = id + '.json';
    a.click();
    URL.revokeObjectURL(url);

    dom.kfInfo.textContent = 'Exported: ' + a.download;
}

// ─── Import ────────────────────────────────────────────────────────────────────
dom.btnImport.addEventListener('click', () => dom.fileInput.click());

dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!data.keyframes || !Array.isArray(data.keyframes)) {
                dom.kfInfo.textContent = 'Invalid: no keyframes array';
                return;
            }
            state.isPlaying = false;
            dom.btnPlay.textContent = '▶ Play';
            xformControls.detach();
            state.keyframes = data.keyframes.map(kf => ({
                time: kf.time,
                bones: kf.bones || {},
                position: kf.position || {},
            }));
            state.keyframes.sort((a, b) => a.time - b.time);
            state.selectedKF = -1;
            state.currentTime = 0;
            if (data.duration) {
                state.duration = data.duration;
                dom.emoteDuration.value = data.duration;
                dom.timeTotal.textContent = data.duration.toFixed(2) + 's';
            }
            if (data.id) dom.emoteId.value = data.id;
            if (data.name) dom.emoteName.value = data.name;
            dom.playhead.style.left = '0%';
            dom.timeCurrent.textContent = '0.00s';
            updateTimelineUI();
            applyPose(0);
            dom.kfInfo.textContent = 'Imported: ' + file.name + ' (' + state.keyframes.length + ' keyframes)';
        } catch (err) {
            dom.kfInfo.textContent = 'Import error: ' + err.message;
        }
    };
    reader.readAsText(file);
    e.target.value = '';
});

// ─── Duration change ───────────────────────────────────────────────────────────
dom.emoteDuration.addEventListener('input', () => {
    state.duration = Math.max(0.1, parseFloat(dom.emoteDuration.value) || 3);
    dom.timeTotal.textContent = state.duration.toFixed(2) + 's';
    if (state.currentTime > state.duration) setCurrentTime(state.duration);
    updateTimelineUI();
});

// ─── Button wiring ────────────────────────────────────────────────────────────
dom.btnPlay.addEventListener('click', togglePlay);
dom.btnAddKF.addEventListener('click', addKeyframe);
dom.btnDelKF.addEventListener('click', deleteSelectedKeyframe);
dom.btnExport.addEventListener('click', exportJSON);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    const isInput = e.target.tagName === 'INPUT';
    if (!isInput && e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        if (state.selectedKF >= 0 && state.selectedKF < state.keyframes.length) {
            state.copiedKeyframe = JSON.parse(JSON.stringify(state.keyframes[state.selectedKF]));
            dom.kfInfo.textContent = 'Copied KF ' + state.selectedKF + ' @ ' + state.keyframes[state.selectedKF].time.toFixed(2) + 's';
        }
        return;
    }
    if (!isInput && e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        if (state.copiedKeyframe) {
            const kf = JSON.parse(JSON.stringify(state.copiedKeyframe));
            const t = Math.round(state.currentTime * 100) / 100;
            state.keyframes = state.keyframes.filter(k => Math.round(k.time * 100) / 100 !== t);
            kf.time = t;
            state.keyframes.push(kf);
            state.keyframes.sort((a, b) => a.time - b.time);
            state.selectedKF = state.keyframes.findIndex(k => k.time === t);
            updateTimelineUI();
            applyPose();
            dom.kfInfo.textContent = 'Pasted KF @ ' + t.toFixed(2) + 's';
        }
        return;
    }
    if (isInput) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if (e.key === 'k' || e.key === 'K') addKeyframe();
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedKeyframe();
    if (e.key === 'ArrowLeft') setCurrentTime(state.currentTime - 0.1);
    if (e.key === 'ArrowRight') setCurrentTime(state.currentTime + 0.1);
});
