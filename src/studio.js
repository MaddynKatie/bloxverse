import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { 
  Instance, PartInstance, PlayerInstance, ScriptInstance, Folder, Sound, PointLight, Sky, Atmosphere, SurfaceGui, TextLabel,
  ScreenGui, Frame, TextButton,
  initGameHierarchy as createBaseHierarchy 
} from './instances.js';
import { executeScript } from './scriptRuntime.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
let selectedInstance = null;
let _game = null;
let scene, camera, renderer, controls, transformControls;
let explorerList, propsContainer, studioContainer;
let _selectionBox = null;
let _onChangeCallback = null;
let _nextPartId = 1;
let _transformMode = 'select';
let _toolbarContainer = null;
let _isTransforming = false;
let _renamingInstance = null;
let _guiPreviewContainer = null;
let _guiEditorWindow = null;
let _guiEditorVisible = false;
let _draggedInstance = null;
// ── Test mode physics & character constants (matching bloxverse-engine.js) ──
const G_LEVEL         = 0;
const WALK_SPEED      = 16;
const JUMP_POWER      = 50;
const GRAVITY         = -196.2;
const ROT_SPEED       = 14;
const STEP_HEIGHT     = 1.1;
const SWEEP_MARGIN    = 0.06;
const COYOTE_TIME     = 0.12;
const JUMP_BUFFER_T   = 0.15;
const CAM_PIVOT_Y     = 2.56;
const SHIFT_LOCK_OFFSET = 1.75;
const CAM_H_SENS      = 0.002 * Math.PI;
const CAM_V_SENS      = 0.0015 * Math.PI;
const CAM_MIN_PITCH   = -0.5;
const CAM_MAX_PITCH   = 1.35;
const CAM_MIN_DIST    = 3.2;
const CAM_MAX_DIST    = 128;

const CHAR_FOOT_OFFSET = 2.08;
const CHAR_HEIGHT      = 5;
const CHAR_HALF_W      = 1;
const CHAR_HALF_D      = 0.5;
const CHAR_STAND_Y     = G_LEVEL + CHAR_FOOT_OFFSET;

let _isTestMode = false;
let _character = null;
let _charInstance = null;
let _charGrounded = false;
let _charVelY = 0;
let _coyoteTimer = 0;
let _jumpBuffer = 0;
let _shiftLock = false;
let _rmb = false;
let _charMoving = false;
let _keys = {};
let _testCamYaw = 0;
let _testCamPitch = 0.35;
let _testCamDist = 25.6;
let _clock = null;
let _anim = { time: 0, bones: {}, rest: {} };
let _testModeKeyCleanup = null;
let _activeScriptControllers = new Set();

function initGameHierarchy() {
  _game = createBaseHierarchy();
  
  const workspace = _game.Children.find(c => c.ClassName === 'Workspace');
  
  // SpawnLocation
  const spawn = new PartInstance('SpawnLocation');
  spawn.Size = [8, 1, 8];
  spawn.Color = new THREE.Color(0x0d69ad);
  spawn.Anchored = true;
  spawn.setParent(workspace);
  _addPartMesh(spawn, 0, 0.5, 10);
  
  return _game;
}

function isDescendantOf(inst, targetName) {
  let curr = inst;
  while (curr) {
    if (curr.ClassName === targetName || curr.Name === targetName) return true;
    curr = curr.Parent;
  }
  return false;
}

function _updateObjectVisibility(inst) {
  if (!scene) return;
  const shouldVisible = isDescendantOf(inst, 'Workspace');
  
  if (inst.mesh) {
    if (shouldVisible) {
      if (!scene.children.includes(inst.mesh)) scene.add(inst.mesh);
    } else {
      scene.remove(inst.mesh);
    }
  } else if (inst.ClassName === 'PointLight' && shouldVisible) {
    // Create visual icon for PointLight in Studio
    const geo = new THREE.SphereGeometry(0.4, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: inst.Color, wireframe: true });
    inst.mesh = new THREE.Mesh(geo, mat);
    inst.mesh.userData.instance = inst;
    inst.mesh.position.set(0, 5, 0); // Default
    
    const light = new THREE.PointLight(inst.Color, inst.Brightness, inst.Range);
    light.castShadow = inst.Shadows;
    light.visible = inst.Enabled !== false;
    inst._lightRef = light;
    inst.mesh.add(light);
    
    scene.add(inst.mesh);
  }
  
  // Also traverse children to update their visibility if needed
  inst.Children.forEach(_updateObjectVisibility);
}

function _addPartMesh(inst, px, py, pz) {
  const [sw, sh, sd] = inst.Size;
  const geo = createGeometry(inst.Shape, sw, sh, sd);
  const mat = new THREE.MeshStandardMaterial({ color: inst.Color, roughness: 0.6, metalness: 0.0 });
  inst.mesh = new THREE.Mesh(geo, mat);
  inst.mesh.position.set(px, py, pz);
  inst.mesh.castShadow = true;
  inst.mesh.receiveShadow = true;
  inst.mesh.userData.instance = inst;
  
  _updateObjectVisibility(inst);
}

// Undo/redo
let _undoStack = [];
let _redoStack = [];
const MAX_UNDO = 50;

// Callbacks for explorer actions
let _onDeletePart = null;
let _onAddPart = null;
let _onOpenScript = null;
let _onScriptAction = null;

export function setCallbacks(cbs) {
  if (cbs.onDeletePart) _onDeletePart = cbs.onDeletePart;
  if (cbs.onAddPart) _onAddPart = cbs.onAddPart;
  if (cbs.onOpenScript) _onOpenScript = cbs.onOpenScript;
  if (cbs.onScriptAction) _onScriptAction = cbs.onScriptAction;
}

// Scripts shown in explorer
let _explorerScripts = [];

export function setExplorerScripts(scripts) {
  _explorerScripts = Object.entries(scripts).map(([name, data]) => ({
    name,
    code: typeof data === 'string' ? data : (data.code || ''),
  }));
  rebuildExplorer();
}

let _contextMenu = null;
function _showContextMenu(x, y, items) {
  _hideContextMenu();
  _contextMenu = document.createElement('div');
  _contextMenu.style.cssText = `
    position: fixed; z-index: 1000; background: #1a1f2e; border: 1px solid rgba(88,101,242,0.4);
    border-radius: 6px; padding: 4px 0; min-width: 160px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    font-size: 13px;
  `;
  _contextMenu.style.display = 'block';
  _contextMenu.style.left = x + 'px';
  _contextMenu.style.top = y + 'px';
  document.body.appendChild(_contextMenu);

  if (items.some(it => it.submenu)) {
    // Add search bar to submenus if they have many items
    for (const it of items) {
       if (it.submenu && it.submenu.length > 5) {
          it.submenuSearchable = true;
       }
    }
  }

  // Adjust if offscreen
  const rect = _contextMenu.getBoundingClientRect();
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  if (x + rect.width > screenW) {
    _contextMenu.style.left = (screenW - rect.width - 5) + 'px';
  }
  if (y + rect.height > screenH) {
    _contextMenu.style.top = (screenH - rect.height - 5) + 'px';
  }

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 0;';
      _contextMenu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.style.cssText = `
      padding: 6px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px;
      color: ${item.color || '#ccc'};
    `;
    el.textContent = item.label;
    if (item.submenu) el.style.cssText += ';position:relative;';
    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(88,101,242,0.2)'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.action) item.action();
      _hideContextMenu();
    });
    _contextMenu.appendChild(el);

    if (item.submenu) {
      const arrow = document.createElement('span');
      arrow.style.cssText = 'margin-left:auto;color:#666;';
      arrow.textContent = '▸';
      el.appendChild(arrow);

      const subEl = document.createElement('div');
      subEl.style.cssText = `
        position: absolute; left: 100%; top: 0; background: #1a1f2e;
        border: 1px solid rgba(88,101,242,0.4); border-radius: 6px; padding: 4px 0;
        min-width: 160px; max-height: 300px; overflow-y: auto; overflow-x: hidden;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5); display: none;
        font-size: 13px;
      `;
      
      if (item.submenuSearchable) {
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search...';
        searchInput.style.cssText = `
          width: calc(100% - 16px); margin: 4px 8px; background: #111; border: 1px solid #333;
          color: #fff; font-size: 11px; padding: 4px; border-radius: 4px; outline: none;
        `;
        searchInput.addEventListener('input', () => {
          const q = searchInput.value.toLowerCase();
          const subItems = subEl.querySelectorAll('.submenu-item');
          subItems.forEach(si => {
            si.style.display = si.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
          });
        });
        subEl.appendChild(searchInput);
        subEl.addEventListener('mouseenter', () => searchInput.focus());
      }

      for (const sub of item.submenu) {
        const subItem = document.createElement('div');
        subItem.className = 'submenu-item';
        subItem.textContent = sub.label;
        subItem.style.cssText = 'padding: 6px 16px; cursor: pointer; color: #ccc; display: flex; align-items: center;';
        subItem.addEventListener('mouseenter', () => { subItem.style.background = 'rgba(88,101,242,0.2)'; });
        subItem.addEventListener('mouseleave', () => { subItem.style.background = 'transparent'; });
        subItem.addEventListener('click', (e) => {
          e.stopPropagation();
          if (sub.action) sub.action();
          _hideContextMenu();
        });
        subEl.appendChild(subItem);
      }
      el.appendChild(subEl);
      el.style.position = 'relative';
      el.addEventListener('mouseenter', () => { 
        subEl.style.display = 'block';
        // Adjust submenu if offscreen right
        const srect = subEl.getBoundingClientRect();
        if (srect.right > window.innerWidth) subEl.style.left = '-100%';
        // Adjust submenu if offscreen bottom
        if (srect.bottom > window.innerHeight) subEl.style.top = (window.innerHeight - srect.bottom - 10) + 'px';
      });
      el.addEventListener('mouseleave', () => { subEl.style.display = 'none'; subEl.style.top = '0'; subEl.style.left = '100%'; });
    }
  }
  document.body.appendChild(_contextMenu);
  document.addEventListener('click', _hideContextMenu, { once: true });
}

function _hideContextMenu() {
  if (_contextMenu) {
    _contextMenu.remove();
    _contextMenu = null;
  }
}

function _saveUndo() {
  _undoStack.push(JSON.stringify(getPartsData()));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack = [];
}

function makeDefaultMap() {
  return [
    { Name: 'Baseplate', Type: 'Part', Shape: 'Block', Position: [0, -1.6, 0], Size: [320, 3.2, 320], Rotation: [0, 0, 0], Color: [0.3, 0.72, 0.29], Anchored: true, CanCollide: true },
  ];
}

function createGeometry(shape, sw, sh, sd) {
  switch (shape) {
    case 'Sphere':
    case 'Ball': {
      const r = Math.max(sw, sh, sd) / 2;
      return new THREE.SphereGeometry(r, 28, 28);
    }
    case 'Cylinder': {
      const r = Math.max(sw, sd) / 2;
      return new THREE.CylinderGeometry(r, r, sh, 28);
    }
    default:
      return new THREE.BoxGeometry(sw, sh, sd);
  }
}

export function getPartsData() {
  const data = [];
  function collect(node) {
    if (node.ClassName === 'Part') {
      const entry = {
        Name: node.Name,
        Type: 'Part',
        Shape: node.Shape,
        Position: [node.mesh.position.x, node.mesh.position.y, node.mesh.position.z],
        Size: node.Size,
        Rotation: [node.mesh.rotation.x * RAD2DEG, node.mesh.rotation.y * RAD2DEG, node.mesh.rotation.z * RAD2DEG],
        Color: [node.Color.r, node.Color.g, node.Color.b],
        Transparency: node.Transparency || 0,
        Anchored: node.Anchored,
        CanCollide: node.CanCollide !== false,
      };
      const pl = node.Children.find(c => c.ClassName === 'PointLight');
      if (pl) {
        entry.PointLight = {
          Color: [pl.Color.r, pl.Color.g, pl.Color.b],
          Brightness: pl.Brightness,
          Range: pl.Range,
          Shadows: pl.Shadows,
          Enabled: pl.Enabled !== false,
        };
      }
      data.push(entry);
    }
    node.Children.forEach(collect);
  }
  if (_game) collect(_game);
  return data;
}

export function getLightingData() {
  const lighting = _game?.Children?.find(c => c.ClassName === 'Lighting');
  if (!lighting) return null;
  const sky = lighting.Children.find(c => c.ClassName === 'Sky');
  const atmosphere = lighting.Children.find(c => c.ClassName === 'Atmosphere');
  return {
    Sky: sky ? {
      SkyboxColor: [sky.SkyboxColor.r, sky.SkyboxColor.g, sky.SkyboxColor.b],
      SunColor: [sky.SunColor.r, sky.SunColor.g, sky.SunColor.b],
      Brightness: sky.Brightness,
      SunPosition: sky.SunPosition,
    } : null,
    Atmosphere: atmosphere ? {
      Density: atmosphere.Density,
      Offset: atmosphere.Offset,
      FogColor: [atmosphere.FogColor.r, atmosphere.FogColor.g, atmosphere.FogColor.b],
    } : null,
  };
}

export function getGameData() {
  return {
    parts: getPartsData(),
    lighting: getLightingData(),
  };
}

export function getScriptsFromHierarchy() {
  const scripts = {};
  function collect(node) {
    if (node.ClassName === 'Script') {
      scripts[node.Name] = { code: node.Source || '' };
    }
    node.Children.forEach(collect);
  }
  if (_game) collect(_game);
  return scripts;
}

export function addScriptToHierarchy(name, code, parent) {
  // Check if already exists
  const existing = getScriptsFromHierarchy();
  if (existing[name]) {
    updateScriptSource(name, code);
    return null; 
  }
  
  const s = new ScriptInstance(name, code || '-- New Script');
  const targetParent = parent || _game.Children.find(c => c.ClassName === 'Workspace');
  s.setParent(targetParent);
  rebuildExplorer();
  if (_onChangeCallback) _onChangeCallback(getPartsData());
  return s;
}

export function removeScriptFromHierarchy(name) {
  function findAndDestroy(node) {
    if (node.ClassName === 'Script' && node.Name === name) {
      node.Destroy();
      return true;
    }
    for (const child of node.Children) {
      if (findAndDestroy(child)) return true;
    }
    return false;
  }
  const found = findAndDestroy(_game);
  if (found) {
    rebuildExplorer();
    if (_onChangeCallback) _onChangeCallback(getPartsData());
  }
  return found;
}

export function updateScriptSource(name, code) {
  function findAndUpdate(node) {
    if (node.ClassName === 'Script' && node.Name === name) {
      node.Source = code;
      return true;
    }
    for (const child of node.Children) {
      if (findAndUpdate(child)) return true;
    }
    return false;
  }
  return findAndUpdate(_game);
}

export function setChangeCallback(cb) {
  _onChangeCallback = cb;
}

export function getTransformMode() {
  return _transformMode;
}

export function setTransformMode(mode) {
  _transformMode = mode;
  if (!transformControls) return;
  if (mode === 'select') {
    transformControls.detach();
    transformControls.enabled = false;
    renderer.domElement.style.cursor = 'default';
  } else {
    transformControls.setMode(mode);
    transformControls.enabled = true;
    transformControls.setSpace('world');
    renderer.domElement.style.cursor = 'default';
    if (selectedInstance && selectedInstance.mesh) {
      transformControls.attach(selectedInstance.mesh);
    }
  }
  _updateToolbarActive();
}

export function initStudio(container, explorerEl, propsEl, onChange) {
  studioContainer = container;
  explorerList = explorerEl;
  propsContainer = propsEl;
  if (onChange) _onChangeCallback = onChange;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog = new THREE.Fog(0x7ec8e3, 150, 600);

  const w = container.clientWidth;
  const h = container.clientHeight;
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
  camera.position.set(30, 25, 40);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // GUI Preview Container
  _guiPreviewContainer = document.createElement('div');
  _guiPreviewContainer.id = 'studio-gui-preview';
  _guiPreviewContainer.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; overflow: hidden;
  `;
  container.appendChild(_guiPreviewContainer);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 2;
  controls.maxDistance = 400;
  controls.update();

  // TransformControls (r184+ extends Controls, not Object3D)
  try {
    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.enabled = false;
    transformControls.setSize(0.8);
    // In r184+, add getHelper() (the TransformControlsRoot) to scene instead
    const helper = transformControls.getHelper();
    if (helper) scene.add(helper);
    transformControls.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value;
    });
    transformControls.addEventListener('mouseDown', () => {
      _isTransforming = false;
    });
    transformControls.addEventListener('objectChange', () => {
      if (!_isTransforming && selectedInstance && selectedInstance.mesh) {
        _isTransforming = true;
        _saveUndo();
      }
      if (selectedInstance && selectedInstance.mesh) {
        const mesh = selectedInstance.mesh;
        const sz = selectedInstance.Size;
        const geo = mesh.geometry;
        const w = geo.parameters.width !== undefined ? geo.parameters.width :
                  geo.parameters.radiusTop !== undefined ? geo.parameters.radiusTop * 2 : sz[0];
        const h = geo.parameters.height !== undefined ? geo.parameters.height : sz[1];
        const d = geo.parameters.depth !== undefined ? geo.parameters.depth :
                  geo.parameters.radiusTop !== undefined ? geo.parameters.radiusTop * 2 : sz[2];
        if (w) sz[0] = w;
        if (h) sz[1] = h;
        if (d) sz[2] = d;
        _updateSelectionBox();
        updateProps();
      }
    });
    transformControls.addEventListener('mouseUp', () => {
      _isTransforming = false;
      if (_onChangeCallback) _onChangeCallback(getPartsData());
    });
  } catch (e) {
    console.warn('Could not initialize TransformControls:', e.message);
    transformControls = null;
  }

  // Sky dome effect via hemisphere light
  const hemi = new THREE.HemisphereLight(0x87CEEB, 0x3a7d44, 1.0);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x404060, 0.3);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffeedd, 2.0);
  dir.position.set(60, 120, 40);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 300;
  dir.shadow.camera.left = -100;
  dir.shadow.camera.right = 100;
  dir.shadow.camera.top = 100;
  dir.shadow.camera.bottom = -100;
  scene.add(dir);

  const fill = new THREE.DirectionalLight(0x8888ff, 0.5);
  fill.position.set(-40, 30, -40);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(0, -10, 60);
  scene.add(rim);

  // Grid
  const gridHelper = new THREE.Group();
  const grid = new THREE.GridHelper(200, 40, 0x444466, 0x333355);
  grid.position.y = 0;
  gridHelper.add(grid);
  scene.add(gridHelper);

  const axes = new THREE.AxesHelper(5);
  scene.add(axes);

  // Selection highlight
  const selGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const selMat = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false, linewidth: 2 });
  _selectionBox = new THREE.LineSegments(selGeo, selMat);
  _selectionBox.visible = false;
  _selectionBox.renderOrder = 999;
  _selectionBox.userData.isSelectionBox = true;
  scene.add(_selectionBox);

  // Toolbar overlay
  _createToolbar(container);

  // Pointer events
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (_transformMode !== 'select') return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    
    const meshes = [];
    function collectMeshes(node) {
      if (node.mesh) meshes.push(node.mesh);
      node.Children.forEach(collectMeshes);
    }
    collectMeshes(_game);

    const intersects = raycaster.intersectObjects(meshes);
    if (intersects.length > 0) {
      selectInstance(intersects[0].object.userData.instance);
    } else {
      selectInstance(null);
    }
  });

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = _clock ? Math.min((now - _clock) / 1000, 0.05) : 0.016;
    _clock = now;
    
    if (_isTestMode) {
      _updateTestMode(dt);
    } else {
      controls.update();
    }
    
    _updateSelectionBox();
    _updateStudioGuiPreview();
    _updateStudioSurfaceGuis();
    renderer.render(scene, camera);
  }
  animate();

  const resizeObserver = new ResizeObserver(() => {
    const w2 = container.clientWidth;
    const h2 = container.clientHeight;
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
    renderer.setSize(w2, h2);
  });
  resizeObserver.observe(container);

  initGameHierarchy();
  loadMapData(makeDefaultMap());

  // Resizable sidebars
  const explorerSidebar = explorerList.parentElement;
  const propsPanel = propsContainer.parentElement;

  explorerSidebar.style.position = 'relative';

  const expHandle = document.createElement('div');
  expHandle.className = 'sidebar-resize-handle';
  expHandle.style.cssText = 'position:absolute;right:-2px;top:0;bottom:0;z-index:5;';
  explorerSidebar.appendChild(expHandle);

  const propsHandle = document.createElement('div');
  propsHandle.className = 'sidebar-resize-handle';
  propsPanel.appendChild(propsHandle);

  const savedExp = localStorage.getItem('studio_explorer_width');
  if (savedExp) explorerSidebar.style.width = Number(savedExp) + 'px';
  const savedProps = localStorage.getItem('studio_props_width');
  if (savedProps) propsPanel.style.width = Number(savedProps) + 'px';

  let _resizeStartX, _resizeStartW, _resizeTarget;

  function _onResizeMove(e) {
    if (!_resizeTarget) return;
    const delta = e.clientX - _resizeStartX;
    const isExplorer = _resizeTarget === explorerSidebar;
    let newW = isExplorer ? _resizeStartW + delta : _resizeStartW - delta;
    newW = Math.max(180, Math.min(400, newW));
    _resizeTarget.style.width = newW + 'px';
  }

  function _onResizeUp() {
    if (!_resizeTarget) return;
    const key = _resizeTarget === explorerSidebar ? 'studio_explorer_width' : 'studio_props_width';
    localStorage.setItem(key, Math.round(_resizeTarget.getBoundingClientRect().width));
    _resizeTarget = null;
    document.removeEventListener('mousemove', _onResizeMove);
    document.removeEventListener('mouseup', _onResizeUp);
  }

  expHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    _resizeStartX = e.clientX;
    _resizeStartW = explorerSidebar.getBoundingClientRect().width;
    _resizeTarget = explorerSidebar;
    document.addEventListener('mousemove', _onResizeMove);
    document.addEventListener('mouseup', _onResizeUp);
  });

  propsHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    _resizeStartX = e.clientX;
    _resizeStartW = propsPanel.getBoundingClientRect().width;
    _resizeTarget = propsPanel;
    document.addEventListener('mousemove', _onResizeMove);
    document.addEventListener('mouseup', _onResizeUp);
  });
}

function _createToolbar(container) {
  _toolbarContainer = document.createElement('div');
  _toolbarContainer.className = 'studio-viewport-toolbar';
  _toolbarContainer.style.cssText = `
    position: absolute; top: 8px; left: 8px; z-index: 10;
    display: flex; gap: 2px; background: rgba(10,16,30,0.85);
    border-radius: 6px; padding: 2px; border: 1px solid rgba(88,101,242,0.3);
  `;
  const tools = [
    { mode: 'select', label: 'Select', icon: '⬚' },
    { mode: 'translate', label: 'Move', icon: '✛' },
    { mode: 'rotate', label: 'Rotate', icon: '⟳' },
    { mode: 'scale', label: 'Scale', icon: '⤡' },
  ];
  for (const t of tools) {
    const btn = document.createElement('button');
    btn.className = `studio-tool-btn${t.mode === 'select' ? ' active' : ''}`;
    btn.dataset.mode = t.mode;
    btn.title = t.label;
    btn.innerHTML = t.icon;
    btn.style.cssText = `
      background: transparent; border: none; color: rgba(200,200,200,0.6);
      width: 30px; height: 28px; border-radius: 4px; cursor: pointer;
      font-size: 15px; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    `;
    btn.addEventListener('mouseenter', () => {
      if (!btn.classList.contains('active')) btn.style.background = 'rgba(88,101,242,0.15)';
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.classList.contains('active')) btn.style.background = 'transparent';
    });
    btn.addEventListener('click', () => {
      setTransformMode(t.mode);
    });
    _toolbarContainer.appendChild(btn);
  }
  
  // GUI Editor toggle
  const sep = document.createElement('div');
  sep.style.cssText = 'width:1px;height:20px;background:rgba(200,200,200,0.15);margin:0 4px;';
  _toolbarContainer.appendChild(sep);
  
  const guiBtn = document.createElement('button');
  guiBtn.className = 'studio-tool-btn';
  guiBtn.title = 'Toggle 2D GUI Editor';
  guiBtn.innerHTML = '☰';
  guiBtn.style.cssText = `
    background: transparent; border: none; color: rgba(200,200,200,0.6);
    width: 30px; height: 28px; border-radius: 4px; cursor: pointer;
    font-size: 13px; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  `;
  guiBtn.addEventListener('click', () => {
    _guiEditorVisible = !_guiEditorVisible;
    if (_guiEditorVisible) {
      _openGuiEditorWindow();
    } else {
      _closeGuiEditorWindow();
    }
    guiBtn.style.background = _guiEditorVisible ? 'rgba(88,101,242,0.35)' : 'transparent';
    guiBtn.style.color = _guiEditorVisible ? '#fff' : 'rgba(200,200,200,0.6)';
  });
  _toolbarContainer.appendChild(guiBtn);
  container.appendChild(_toolbarContainer);
}

function _updateToolbarActive() {
  if (!_toolbarContainer) return;
  const btns = _toolbarContainer.querySelectorAll('.studio-tool-btn');
  for (const btn of btns) {
    const isActive = btn.dataset.mode === _transformMode;
    btn.classList.toggle('active', isActive);
    btn.style.background = isActive ? 'rgba(88,101,242,0.35)' : 'transparent';
    btn.style.color = isActive ? '#fff' : 'rgba(200,200,200,0.6)';
  }
}

function _updateSelectionBox() {
  if (!_selectionBox) return;
  const inWorkspace = selectedInstance && isDescendantOf(selectedInstance, 'Workspace');
  if (selectedInstance && selectedInstance.mesh && _selectionBox.visible && inWorkspace) {
    const mesh = selectedInstance.mesh;
    _selectionBox.position.copy(mesh.position);
    _selectionBox.rotation.copy(mesh.rotation);
    const sz = selectedInstance.Size || [4, 4, 4];
    _selectionBox.scale.set(sz[0], sz[1], sz[2]);
  } else {
    _selectionBox.visible = false;
    if (transformControls) transformControls.detach();
  }
}

function _frameCamera() {
  const parts = [];
  function collect(node) {
    if (node.ClassName === 'Part' && node.mesh) parts.push(node);
    node.Children.forEach(collect);
  }
  collect(_game);

  if (parts.length === 0) {
    controls.target.set(0, 0, 0);
    camera.position.set(30, 25, 40);
    controls.update();
    return;
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const hs = p.Size;
    const pos = p.mesh.position;
    const hw = hs[0] / 2, hh = hs[1] / 2, hd = hs[2] / 2;
    minX = Math.min(minX, pos.x - hw); maxX = Math.max(maxX, pos.x + hw);
    minY = Math.min(minY, pos.y - hh); maxY = Math.max(maxY, pos.y + hh);
    minZ = Math.min(minZ, pos.z - hd); maxZ = Math.max(maxZ, pos.z + hd);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 10);
  const dist = size * 1.5;
  controls.target.set(cx, cy, cz);
  camera.position.set(cx + dist * 0.7, cy + dist * 0.5, cz + dist);
  controls.update();
}

export function loadMapData(data) {
  _saveUndo();
  clearAllParts();
  const workspace = _game.Children.find(c => c.ClassName === 'Workspace');
  const parts = Array.isArray(data) ? data : (data.parts || []);

  for (const p of parts) {
    if (p.Type !== 'Part') continue;
    const inst = addPart(p.Name, p.Size[0], p.Size[1], p.Size[2], p.Color ? new THREE.Color(p.Color[0], p.Color[1], p.Color[2]) : 0x808080, p.Position[0], p.Position[1], p.Position[2], p.Anchored, p.Shape, workspace, p.Rotation, p.CanCollide);
    if (p.Transparency != null && p.Transparency > 0) {
      inst.Transparency = Math.max(0, Math.min(1, p.Transparency));
      if (inst.mesh) {
        inst.mesh.material.transparent = true;
        inst.mesh.material.opacity = Math.max(0, 1 - inst.Transparency);
        inst.mesh.material.needsUpdate = true;
      }
    }
  }

  // Load PointLights attached to parts
  for (const p of parts) {
    if (p.PointLight) {
      const partInst = workspace.Children.find(c => c.ClassName === 'Part' && c.Name === p.Name);
      if (partInst) {
        const pl = p.PointLight;
        const plInst = new PointLight(p.Name + 'Light');
        plInst.Color = new THREE.Color(pl.Color ? pl.Color[0] : 1, pl.Color ? pl.Color[1] : 1, pl.Color ? pl.Color[2] : 1);
        plInst.Brightness = pl.Brightness != null ? pl.Brightness : 1;
        plInst.Range = pl.Range != null ? pl.Range : 16;
        plInst.Shadows = pl.Shadows === true;
        plInst.Enabled = pl.Enabled !== false;
        plInst.setParent(partInst);
      }
    }
  }

  // Apply lighting data
  const lightingData = !Array.isArray(data) ? data.lighting : null;
  if (lightingData) {
    const lighting = _game?.Children?.find(c => c.ClassName === 'Lighting');
    if (lighting) {
      if (lightingData.Sky) {
        const s = lightingData.Sky;
        const sky = lighting.Children.find(c => c.ClassName === 'Sky');
        if (sky) {
          if (s.SkyboxColor) sky.SkyboxColor.setRGB(s.SkyboxColor[0], s.SkyboxColor[1], s.SkyboxColor[2]);
          if (s.SunColor) sky.SunColor.setRGB(s.SunColor[0], s.SunColor[1], s.SunColor[2]);
          if (s.Brightness != null) sky.Brightness = s.Brightness;
          if (s.SunPosition) sky.SunPosition = s.SunPosition;
        }
        // Apply to scene
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
      if (lightingData.Atmosphere) {
        const a = lightingData.Atmosphere;
        const atmos = lighting.Children.find(c => c.ClassName === 'Atmosphere');
        if (atmos) {
          if (a.Density != null) atmos.Density = a.Density;
          if (a.Offset != null) atmos.Offset = a.Offset;
          if (a.FogColor) atmos.FogColor.setRGB(a.FogColor[0], a.FogColor[1], a.FogColor[2]);
        }
        // Apply to scene
        if (a.FogColor && scene.fog) scene.fog.color.setRGB(a.FogColor[0], a.FogColor[1], a.FogColor[2]);
        if (a.Density != null && scene.fog) scene.fog.far = 600 - a.Density * 500;
      }
    }
  }

  rebuildExplorer();
  updateProps();
  if (_onChangeCallback) _onChangeCallback(getPartsData());
  _frameCamera();
}

function clearParts() {
  function collect(node) {
    if (node.mesh) {
      scene.remove(node.mesh);
      node.mesh.geometry.dispose();
      node.mesh.material.dispose();
      node.mesh = null;
    }
    node.Children.forEach(collect);
  }
  if (_game) collect(_game);
  selectedInstance = null;
  if (_selectionBox) _selectionBox.visible = false;
  if (transformControls) transformControls.detach();
}

export function clearAllParts() {
  clearParts();
  initGameHierarchy();
  rebuildExplorer();
  updateProps();
}

export function addPart(name, sw, sh, sd, colorHex, px, py, pz, anchored, shape, parent, rotation, canCollide) {
  _saveUndo();
  const inst = new PartInstance(name || 'Part');
  inst.Size = [sw, sh, sd];
  inst.Color = new THREE.Color(colorHex);
  inst.Anchored = anchored;
  inst.CanCollide = canCollide !== undefined ? canCollide : true;
  inst.Shape = shape || 'Block';

  const geo = createGeometry(inst.Shape, sw, sh, sd);
  const mat = new THREE.MeshStandardMaterial({ color: inst.Color, roughness: 0.6, metalness: 0.0 });
  inst.mesh = new THREE.Mesh(geo, mat);
  inst.mesh.position.set(px, py, pz);
  if (rotation) {
    const RAD = Math.PI / 180;
    inst.mesh.rotation.set(rotation[0] * RAD, rotation[1] * RAD, rotation[2] * RAD);
    inst.Rotation = rotation.slice();
  }
  inst.mesh.castShadow = true;
  inst.mesh.receiveShadow = true;
  inst.mesh.userData.instance = inst;
  scene.add(inst.mesh);

  const targetParent = parent || _game.Children.find(c => c.ClassName === 'Workspace');
  inst.setParent(targetParent);

  selectInstance(inst);
  rebuildExplorer();
  updateProps();
  if (_onChangeCallback) _onChangeCallback(getPartsData());
  return inst;
}

export function deleteSelectedPart() {
  if (!selectedInstance || (selectedInstance.ClassName !== 'Part' && selectedInstance.ClassName !== 'Script')) return;
  _saveUndo();
  if (selectedInstance.mesh) {
    scene.remove(selectedInstance.mesh);
    selectedInstance.mesh.geometry.dispose();
    selectedInstance.mesh.material.dispose();
  }
  selectedInstance.Destroy();
  selectedInstance = null;
  if (_selectionBox) _selectionBox.visible = false;
  if (transformControls) transformControls.detach();
  rebuildExplorer();
  updateProps();
  if (_onChangeCallback) _onChangeCallback(getPartsData());
}

function findEntryByMesh(mesh) {
  return mesh?.userData?.instance || null;
}

export function selectInstance(inst) {
  if (!inst) {
    selectedInstance = null;
    if (_selectionBox) _selectionBox.visible = false;
    if (transformControls) transformControls.detach();
    rebuildExplorer();
    updateProps();
    return;
  }
  selectedInstance = inst;
  if (inst.mesh) {
    if (_selectionBox) {
      _selectionBox.visible = true;
      _selectionBox.position.copy(inst.mesh.position);
      _selectionBox.rotation.copy(inst.mesh.rotation);
      const sz = inst.Size || [4, 4, 4];
      _selectionBox.scale.set(sz[0], sz[1], sz[2]);
    }
    if (_transformMode !== 'select' && transformControls) {
      transformControls.attach(inst.mesh);
    }
  } else {
    if (_selectionBox) _selectionBox.visible = false;
    if (transformControls) transformControls.detach();
  }
  rebuildExplorer();
  updateProps();
}

export function loadMapFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const arr = Array.isArray(data) ? data : (data.parts || []);
      loadMapData(arr);
    } catch (err) {
      alert('Failed to parse JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

export function exportMapJSON() {
  const data = getGameData();
  const output = JSON.stringify(data, null, 2);
  const blob = new Blob([output], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function undo() {
  if (_undoStack.length === 0) return;
  _redoStack.push(JSON.stringify(getPartsData()));
  const snapshot = JSON.parse(_undoStack.pop());
  _loadSnapshot(snapshot);
}

export function redo() {
  if (_redoStack.length === 0) return;
  _undoStack.push(JSON.stringify(getPartsData()));
  const snapshot = JSON.parse(_redoStack.pop());
  _loadSnapshot(snapshot);
}

function _loadSnapshot(data) {
  clearAllParts();
  const workspace = _game.Children.find(c => c.ClassName === 'Workspace');
  for (const p of data) {
    const inst = addPart(p.Name || 'Part', p.Size[0], p.Size[1], p.Size[2], p.Color ? new THREE.Color(p.Color[0], p.Color[1], p.Color[2]) : 0x808080, p.Position[0], p.Position[1], p.Position[2], p.Anchored !== false, p.Shape || 'Block', workspace, p.Rotation);
    if (p.Transparency != null && p.Transparency > 0) {
      inst.Transparency = Math.max(0, Math.min(1, p.Transparency));
      if (inst.mesh) {
        inst.mesh.material.transparent = true;
        inst.mesh.material.opacity = Math.max(0, 1 - inst.Transparency);
        inst.mesh.material.needsUpdate = true;
      }
    }
  }
  selectInstance(null);
  rebuildExplorer();
  updateProps();
  if (_onChangeCallback) _onChangeCallback(getPartsData());
}

function rebuildExplorer() {
  explorerList.innerHTML = '';
  if (!_game) return;

  function renderInstance(inst, depth = 0) {
    const item = document.createElement('div');
    item.className = `studio-explorer-item ${inst === selectedInstance ? 'selected' : ''}`;
    item.style.cssText = `
      padding: 4px 12px; padding-left: ${depth * 14 + 12}px;
      cursor: pointer; display: flex; align-items: center; gap: 4px;
      font-size: 13px; color: #ccc; border-bottom: 1px solid rgba(255,255,255,0.02);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    `;
    
    if (inst === selectedInstance) {
      item.style.background = 'rgba(88,101,242,0.3)';
      item.style.color = '#fff';
    }

    // Drag and Drop
    item.draggable = !['Workspace', 'Lighting', 'ReplicatedStorage', 'Players', 'StarterGui', 'game'].includes(inst.Name);
    item.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      _draggedInstance = inst;
      item.style.opacity = '0.5';
    });
    item.addEventListener('dragend', () => {
      item.style.opacity = '1';
      _draggedInstance = null;
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (_draggedInstance && _draggedInstance !== inst) {
        item.style.background = 'rgba(88,101,242,0.2)';
      }
    });
    item.addEventListener('dragleave', () => {
      item.style.background = (inst === selectedInstance) ? 'rgba(88,101,242,0.3)' : 'transparent';
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.style.background = (inst === selectedInstance) ? 'rgba(88,101,242,0.3)' : 'transparent';
      
      if (_draggedInstance && _draggedInstance !== inst) {
        const canReparent = (parent, child) => {
          if (child.Name === parent.Name) return false;
          // Check for circular reference
          let curr = parent;
          while (curr) {
            if (curr === child) return false;
            curr = curr.Parent;
          }
          // Folder can contain anything
          if (parent.ClassName === 'Folder') return true;
          // Services
          if (parent.ClassName === 'Workspace') return ['Part', 'Folder', 'Script', 'Sound', 'PointLight', 'SpawnLocation'].includes(child.ClassName);
          if (parent.ClassName === 'Lighting') return ['Sky', 'Atmosphere'].includes(child.ClassName);
          if (parent.ClassName === 'StarterGui') return ['ScreenGui'].includes(child.ClassName);
          // UI
          if (parent.ClassName === 'ScreenGui' || parent.ClassName === 'Frame') return ['Frame', 'TextLabel', 'TextButton'].includes(child.ClassName);
          if (parent.ClassName === 'SurfaceGui') return ['Frame', 'TextLabel', 'TextButton'].includes(child.ClassName);
          // Parts
          if (parent.ClassName === 'Part') return ['Script', 'Sound', 'PointLight', 'SurfaceGui'].includes(child.ClassName);
          
          return false;
        };

        if (canReparent(inst, _draggedInstance)) {
          _saveUndo();
          _draggedInstance.setParent(inst);
          _updateObjectVisibility(_draggedInstance);
          rebuildExplorer();
          updateProps();
          if (_onChangeCallback) _onChangeCallback(getPartsData());
        } else {
          console.warn('Incompatible reparenting:', _draggedInstance.ClassName, '->', inst.ClassName);
        }
      }
    });

    const toggle = document.createElement('span');
    toggle.style.cssText = 'width: 12px; display: inline-block; cursor: pointer; color: #666; font-size: 10px;';
    if (inst.Children.length > 0) {
      toggle.textContent = inst._expanded ? '▼' : '▶';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        inst._expanded = !inst._expanded;
        rebuildExplorer();
      });
    }
    item.appendChild(toggle);

    const icon = document.createElement('span');
    icon.style.fontSize = '14px';
    const icons = {
      'Workspace': '🌍', 'Lighting': '💡', 'ReplicatedStorage': '📦', 
      'StarterGui': '🖥️', 'Players': '👥', 'Part': '🧱', 'Script': '📜', 'DataModel': '🎮',
      'Sky': '☀️', 'Atmosphere': '🌫️', 'Folder': '📂', 'Sound': '🔊', 'PointLight': '💡',
      'SurfaceGui': '📄', 'ScreenGui': '🖥️', 'TextLabel': '🅰️', 'Frame': '🖼️', 'TextButton': '🔘'
    };
    icon.textContent = icons[inst.ClassName] || '📄';
    item.appendChild(icon);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'explorer-name';
      
      if (inst === _renamingInstance) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = inst.Name;
        input.style.cssText = 'background:#222;border:1px solid #5865f2;color:#fff;font-size:12px;padding:2px 4px;border-radius:2px;outline:none;width:100px;';
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            inst.Name = input.value || inst.Name;
            _renamingInstance = null;
            rebuildExplorer();
            updateProps();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          } else if (e.key === 'Escape') {
            _renamingInstance = null;
            rebuildExplorer();
          }
        });
        setTimeout(() => input.focus(), 10);
        nameSpan.appendChild(input);
      } else {
        nameSpan.textContent = inst.Name;
      }
      
      item.appendChild(nameSpan);

    item.addEventListener('click', () => selectInstance(inst));
    item.addEventListener('dblclick', () => {
      if (inst.ClassName === 'Script' && _onOpenScript) _onOpenScript(inst.Name);
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      selectInstance(inst);
      const menuItems = [
        { label: 'Add Object', submenu: [
          { label: 'Block', action: () => {
            const p = new PartInstance('Part');
            p.Shape = 'Block';
            p.setParent(inst);
            _addPartMesh(p, 0, 2, 0); // _addPartMesh calls _updateObjectVisibility
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'Sphere', action: () => {
            const p = new PartInstance('Part');
            p.Shape = 'Sphere';
            p.setParent(inst);
            _addPartMesh(p, 0, 2, 0);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'Folder', action: () => {
            const f = new Folder('Folder');
            f.setParent(inst);
            _updateObjectVisibility(f);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'Script', action: () => {
            const s = new ScriptInstance('Script', '-- New Script');
            s.setParent(inst);
            _updateObjectVisibility(s);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'Sound', action: () => {
            const s = new Sound('Sound');
            s.setParent(inst);
            _updateObjectVisibility(s);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'PointLight', action: () => {
            const l = new PointLight('PointLight');
            l.setParent(inst);
            _updateObjectVisibility(l);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'Sky', action: () => {
            const s = new Sky();
            s.setParent(inst);
            _updateObjectVisibility(s);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'Atmosphere', action: () => {
            const a = new Atmosphere();
            a.setParent(inst);
            _updateObjectVisibility(a);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'SurfaceGui', action: () => {
            const g = new SurfaceGui('SurfaceGui');
            g.setParent(inst);
            _updateObjectVisibility(g);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'ScreenGui', action: () => {
            const g = new ScreenGui('ScreenGui');
            g.setParent(inst);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'Frame', action: () => {
            const g = new Frame('Frame');
            g.setParent(inst);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'TextButton', action: () => {
            const g = new TextButton('TextButton');
            g.setParent(inst);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
          { label: 'TextLabel', action: () => {
            const l = new TextLabel('TextLabel');
            l.setParent(inst);
            _updateObjectVisibility(l);
            rebuildExplorer();
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          }},
        ]},
        { label: 'Rename', action: () => {
          _renamingInstance = inst;
          rebuildExplorer();
        }},
      ];
      const protectedNames = ['Workspace', 'Lighting', 'ReplicatedStorage', 'Players', 'StarterGui', 'game'];
      if (!protectedNames.includes(inst.Name)) {
        menuItems.push({ separator: true });
        menuItems.push({ label: 'Delete', color: '#ef5350', action: () => {
          inst.Destroy();
          if (inst.mesh) scene.remove(inst.mesh);
          if (selectedInstance === inst) selectInstance(null);
          rebuildExplorer();
          if (_onChangeCallback) _onChangeCallback(getPartsData());
        }});
      }
      _showContextMenu(e.clientX, e.clientY, menuItems);
    });

    explorerList.appendChild(item);

    if (inst._expanded) {
      inst.Children.forEach(child => renderInstance(child, depth + 1));
    }
  }

  // Don't render "game" root, just its children
  _game.Children.forEach(child => renderInstance(child, 0));
}

function updateProps() {
  propsContainer.innerHTML = '';
  if (!selectedInstance) {
    propsContainer.innerHTML = '<div style="padding:12px;color:#8a8c8e;font-size:12px;">No instance selected</div>';
    return;
  }
  const inst = selectedInstance;

  const fields = [
    { label: 'Name', key: 'Name', type: 'text', value: inst.Name },
    { label: 'Parent', key: 'ParentName', type: 'text', value: inst.Parent ? inst.Parent.Name : 'None', readonly: true },
  ];

  if (inst.ClassName === 'PointLight') {
    fields.push(
      { label: 'Enabled', key: 'Enabled', type: 'checkbox', value: inst.Enabled !== false },
      { label: 'Color', key: 'Color', type: 'color', value: '#' + inst.Color.getHexString() },
      { label: 'Brightness', key: 'Brightness', type: 'number', value: inst.Brightness },
      { label: 'Range', key: 'Range', type: 'number', value: inst.Range },
      { label: 'Shadows', key: 'Shadows', type: 'checkbox', value: inst.Shadows }
    );
  } else if (inst.ClassName === 'Sound') {
    fields.push(
      { label: 'SoundId', key: 'SoundId', type: 'text', value: inst.SoundId },
      { label: 'Playing', key: 'Playing', type: 'checkbox', value: inst.Playing },
      { label: 'Looped', key: 'Looped', type: 'checkbox', value: inst.Looped },
      { label: 'Volume', key: 'Volume', type: 'number', value: inst.Volume }
    );
  } else if (inst.ClassName === 'TextLabel' || inst.ClassName === 'Frame' || inst.ClassName === 'TextButton') {
    fields.push(
      { label: 'Visible', key: 'Visible', type: 'checkbox', value: inst.Visible !== false },
      { label: 'BG Color', key: 'BackgroundColor', type: 'color', value: '#' + inst.BackgroundColor.getHexString() },
      { label: 'Transparency', key: 'BackgroundTransparency', type: 'range', value: inst.BackgroundTransparency, min: 0, max: 1, step: 0.05 },
      { label: 'Pos X', key: 'posX', type: 'number', value: inst.Position[0] },
      { label: 'Pos Y', key: 'posY', type: 'number', value: inst.Position[1] },
      { label: 'Size X', key: 'sizeX', type: 'number', value: inst.Size[0] },
      { label: 'Size Y', key: 'sizeY', type: 'number', value: inst.Size[1] }
    );
    if (inst.ClassName === 'TextLabel' || inst.ClassName === 'TextButton') {
      fields.push(
        { label: 'Text', key: 'Text', type: 'text', value: inst.Text },
        { label: 'Text Color', key: 'TextColor', type: 'color', value: '#' + inst.TextColor.getHexString() },
        { label: 'Text Transparency', key: 'TextTransparency', type: 'range', value: inst.TextTransparency, min: 0, max: 1, step: 0.05 },
        { label: 'Font Size', key: 'FontSize', type: 'number', value: inst.FontSize }
      );
    }
  }

  if (inst.ClassName === 'Part' && inst.mesh) {
    fields.push(
      { label: 'Shape', key: 'Shape', type: 'select', value: inst.Shape || 'Block', options: ['Block', 'Sphere', 'Cylinder'] },
      { label: 'Position X', key: 'px', type: 'number', value: inst.mesh.position.x.toFixed(3) },
      { label: 'Position Y', key: 'py', type: 'number', value: inst.mesh.position.y.toFixed(3) },
      { label: 'Position Z', key: 'pz', type: 'number', value: inst.mesh.position.z.toFixed(3) },
      { label: 'Rotation X', key: 'rx', type: 'number', value: (inst.mesh.rotation.x * RAD2DEG).toFixed(1) },
      { label: 'Rotation Y', key: 'ry', type: 'number', value: (inst.mesh.rotation.y * RAD2DEG).toFixed(1) },
      { label: 'Rotation Z', key: 'rz', type: 'number', value: (inst.mesh.rotation.z * RAD2DEG).toFixed(1) },
      { label: 'Width', key: 'sw', type: 'number', value: inst.Size[0].toFixed(1) },
      { label: 'Height', key: 'sh', type: 'number', value: inst.Size[1].toFixed(1) },
      { label: 'Depth', key: 'sd', type: 'number', value: inst.Size[2].toFixed(1) },
      { label: 'Color', key: 'Color', type: 'color', value: '#' + inst.Color.getHexString() },
      { label: 'Transparency', key: 'Transparency', type: 'range', value: inst.Transparency || 0, min: 0, max: 1, step: 0.05 },
      { label: 'Anchored', key: 'Anchored', type: 'checkbox', value: inst.Anchored },
      { label: 'CanCollide', key: 'CanCollide', type: 'checkbox', value: inst.CanCollide }
    );
  } else if (inst.ClassName === 'Script') {
    fields.push(
      { label: 'Source', key: 'Source', type: 'textarea', value: inst.Source }
    );
  } else if (inst.ClassName === 'Sky') {
    fields.push(
      { label: 'Skybox Color', key: 'SkyboxColor', type: 'color', value: '#' + inst.SkyboxColor.getHexString() },
      { label: 'Sun Color', key: 'SunColor', type: 'color', value: '#' + inst.SunColor.getHexString() },
      { label: 'Brightness', key: 'Brightness', type: 'range', value: inst.Brightness, min: 0, max: 10, step: 0.1 },
      { label: 'Sun Pos X', key: 'sunX', type: 'number', value: inst.SunPosition[0] },
      { label: 'Sun Pos Y', key: 'sunY', type: 'number', value: inst.SunPosition[1] },
      { label: 'Sun Pos Z', key: 'sunZ', type: 'number', value: inst.SunPosition[2] }
    );
  } else if (inst.ClassName === 'Atmosphere') {
    fields.push(
      { label: 'Density', key: 'Density', type: 'range', value: inst.Density, min: 0, max: 1, step: 0.01 },
      { label: 'Offset', key: 'Offset', type: 'number', value: inst.Offset },
      { label: 'Fog Color', key: 'FogColor', type: 'color', value: '#' + inst.FogColor.getHexString() }
    );
  } else if (inst.ClassName === 'Folder') {
    // only name
  } else if (inst.ClassName === 'Folder') {
    // only name
  } else if (inst.ClassName === 'SurfaceGui') {
    fields.push(
      { label: 'Enabled', key: 'Enabled', type: 'checkbox', value: inst.Enabled !== false },
      { label: 'Face', key: 'Face', type: 'select', value: inst.Face || 'Front', options: ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'] },
      { label: 'Rotation', key: 'Rotation', type: 'range', value: inst.Rotation || 0, min: -180, max: 180, step: 1 },
      { label: 'Canvas W', key: 'CanvasSize0', type: 'number', value: (inst.CanvasSize && inst.CanvasSize[0]) || 200 },
      { label: 'Canvas H', key: 'CanvasSize1', type: 'number', value: (inst.CanvasSize && inst.CanvasSize[1]) || 200 }
    );
  } else if (inst.ClassName === 'ScreenGui') {
    fields.push(
      { label: 'Enabled', key: 'Enabled', type: 'checkbox', value: inst.Enabled !== false }
    );
  }

  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const label = document.createElement('label');
    label.className = 'prop-label';
    label.textContent = f.label;

    let input;
    if (f.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = f.value;
      input.addEventListener('change', () => applyProp(f.key, input.checked));
    } else if (f.type === 'select') {
      input = document.createElement('select');
      input.className = 'prop-input';
      for (const opt of f.options) {
        const op = document.createElement('option');
        op.value = opt;
        op.textContent = opt;
        if (opt === f.value) op.selected = true;
        input.appendChild(op);
      }
      input.addEventListener('change', () => applyProp(f.key, input.value));
    } else if (f.type === 'range') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;';
      input = document.createElement('input');
      input.type = 'range';
      input.min = f.min;
      input.max = f.max;
      input.step = f.step || 0.05;
      input.value = f.value;
      input.style.cssText = 'flex:1;accent-color:rgba(88,101,242,0.8);';
      const valLabel = document.createElement('span');
      valLabel.style.cssText = 'color:rgba(200,200,200,0.7);font-size:11px;min-width:28px;text-align:right;';
      valLabel.textContent = f.value;
      input.addEventListener('input', () => {
        valLabel.textContent = parseFloat(input.value).toFixed(2);
        const val = parseFloat(input.value);
        const inst = selectedInstance;
        if (!inst) return;
        inst[f.key] = val;
        // Real-time 3D scene updates during drag
        if (inst.mesh && f.key === 'Transparency') {
          inst.mesh.material.transparent = val > 0;
          inst.mesh.material.opacity = Math.max(0, Math.min(1, 1 - val));
          inst.mesh.material.needsUpdate = true;
        }
        if (f.key === 'Brightness') {
          const sun = scene.children.find(c => c.isDirectionalLight && c.position.y > 50);
          if (sun) sun.intensity = val * 2.0;
        }
        if (f.key === 'Density') {
          if (scene.fog) scene.fog.far = 600 - (val * 500);
        }
      });
      input.addEventListener('change', () => {
        applyProp(f.key, parseFloat(input.value));
      });
      wrap.appendChild(input);
      wrap.appendChild(valLabel);
      row.appendChild(label);
      row.appendChild(wrap);
      propsContainer.appendChild(row);
      continue;
    } else if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.style.cssText = 'width:100%;min-height:100px;font-family:monospace;font-size:12px;background:#111;color:#ccc;border:1px solid #333;border-radius:4px;padding:8px;';
      input.value = f.value;
      input.addEventListener('change', () => applyProp(f.key, input.value));
    } else if (f.key === 'SoundId') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1;';
      input = document.createElement('input');
      input.className = 'prop-input';
      input.type = 'text';
      input.value = f.value;
      input.style.flex = '1';
      input.addEventListener('change', () => applyProp(f.key, input.value));
      const upBtn = document.createElement('button');
      upBtn.textContent = '⤒';
      upBtn.title = 'Upload Sound';
      upBtn.style.cssText = 'padding:2px 6px;font-size:12px;background:rgba(88,101,242,0.4);border:1px solid rgba(88,101,242,0.6);border-radius:4px;color:#fff;cursor:pointer;';
      upBtn.addEventListener('click', async () => {
        const fi = document.createElement('input');
        fi.type = 'file';
        fi.accept = 'audio/*';
        fi.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            alert('File too large! Max 10MB.');
            return;
          }
          upBtn.textContent = '...';
          upBtn.disabled = true;
          try {
            const { uploadSoundToCloudinary } = await import('./firebase.js');
            const url = await uploadSoundToCloudinary(file);
            input.value = url;
            applyProp(f.key, url);
          } catch (err) {
            alert('Upload failed: ' + err.message);
          } finally {
            upBtn.textContent = '⤒';
            upBtn.disabled = false;
          }
        };
        fi.click();
      });
      wrap.appendChild(input);
      wrap.appendChild(upBtn);
      row.appendChild(label);
      row.appendChild(wrap);
      propsContainer.appendChild(row);
      continue;
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
      input.value = f.value;
      if (f.readonly) input.readOnly = true;
      input.addEventListener('change', () => applyProp(f.key, input.value));
      if (f.type === 'color') {
        input.addEventListener('input', () => {
          const inst = selectedInstance;
          if (!inst) return;
          const color = new THREE.Color(input.value);
          inst[f.key] = color;
          if (inst.mesh && f.key === 'Color') {
            inst.mesh.material.color.copy(color);
            inst.mesh.material.needsUpdate = true;
          }
          if (f.key === 'SkyboxColor') scene.background = color;
          if (f.key === 'SunColor') {
            const sun = scene.children.find(c => c.isDirectionalLight && c.position.y > 50);
            if (sun) sun.color.copy(color);
          }
        });
      }
    }
    input.className = 'prop-input';
    row.appendChild(label);
    row.appendChild(input);
    propsContainer.appendChild(row);
  }

  // GUI Editor button for SurfaceGui
  if (selectedInstance && (selectedInstance.ClassName === 'SurfaceGui' || selectedInstance.ClassName === 'ScreenGui')) {
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'padding:8px;';
    const btn = document.createElement('button');
    btn.textContent = 'Open 2D GUI Editor';
    btn.style.cssText = 'width:100%;padding:6px;background:rgba(88,101,242,0.3);border:1px solid rgba(88,101,242,0.5);border-radius:4px;color:#fff;cursor:pointer;font-size:12px;';
    btn.onmouseenter = () => { btn.style.background = 'rgba(88,101,242,0.5)'; };
    btn.onmouseleave = () => { btn.style.background = 'rgba(88,101,242,0.3)'; };
    btn.onclick = () => {
      _guiEditorVisible = true;
      _openGuiEditorWindow();
      const guiBtn = document.querySelector('.studio-tool-btn[title*="GUI"]');
      if (guiBtn) { guiBtn.style.background = 'rgba(88,101,242,0.35)'; guiBtn.style.color = '#fff'; }
    };
    btnRow.appendChild(btn);
    propsContainer.appendChild(btnRow);
  }
}

function rebuildMesh(inst) {
  if (!inst.mesh) return;
  const mesh = inst.mesh;
  const oldGeo = mesh.geometry;
  const newGeo = createGeometry(inst.Shape || 'Block', inst.Size[0], inst.Size[1], inst.Size[2]);
  mesh.geometry = newGeo;
  oldGeo.dispose();
  const mat = mesh.material;
  mat.color.copy(inst.Color);
  mat.transparent = (inst.Transparency || 0) > 0;
  mat.opacity = Math.max(0, Math.min(1, 1 - (inst.Transparency || 0)));
  mat.needsUpdate = true;
}

function applyProp(key, val) {
  if (!selectedInstance) return;
  const inst = selectedInstance;
  _saveUndo();

  switch (key) {
    case 'Name':
      inst.Name = String(val);
      rebuildExplorer();
      break;
    case 'Shape': {
      const newShape = String(val);
      if (newShape !== inst.Shape) {
        inst.Shape = newShape;
        rebuildMesh(inst);
      }
      break;
    }
    case 'px':
      if (inst.mesh) inst.mesh.position.x = parseFloat(val) || 0;
      break;
    case 'py':
      if (inst.mesh) inst.mesh.position.y = parseFloat(val) || 0;
      break;
    case 'pz':
      if (inst.mesh) inst.mesh.position.z = parseFloat(val) || 0;
      break;
    case 'sw':
      inst.Size[0] = Math.max(0.1, parseFloat(val) || 1);
      rebuildMesh(inst);
      break;
    case 'sh':
      inst.Size[1] = Math.max(0.1, parseFloat(val) || 1);
      rebuildMesh(inst);
      break;
    case 'sd':
      inst.Size[2] = Math.max(0.1, parseFloat(val) || 1);
      rebuildMesh(inst);
      break;
    case 'Color': {
      inst.Color = new THREE.Color(val);
      rebuildMesh(inst);
      break;
    }
    case 'Transparency': {
      inst.Transparency = Math.max(0, Math.min(1, parseFloat(val) || 0));
      rebuildMesh(inst);
      break;
    }
    case 'Anchored':
      inst.Anchored = !!val;
      break;
    case 'CanCollide':
      inst.CanCollide = !!val;
      break;
    case 'Source':
      inst.Source = String(val);
      if (_onScriptAction) _onScriptAction('update', inst.Name, inst.Source);
      break;
    case 'SkyboxColor':
      inst.SkyboxColor = new THREE.Color(val);
      scene.background = inst.SkyboxColor;
      break;
    case 'SunColor':
      inst.SunColor = new THREE.Color(val);
      const sun = scene.children.find(c => c.isDirectionalLight && c.position.y > 50);
      if (sun) sun.color.copy(inst.SunColor);
      break;
    case 'Brightness':
      inst.Brightness = parseFloat(val);
      const sun2 = scene.children.find(c => c.isDirectionalLight && c.position.y > 50);
      if (sun2) sun2.intensity = inst.Brightness * 2.0;
      break;
    case 'sunX': inst.SunPosition[0] = parseFloat(val); break;
    case 'sunY': inst.SunPosition[1] = parseFloat(val); break;
    case 'sunZ': inst.SunPosition[2] = parseFloat(val); break;
    case 'CanvasSize0':
      if (inst.CanvasSize) { inst.CanvasSize[0] = Math.max(1, parseInt(val) || 200); }
      break;
    case 'CanvasSize1':
      if (inst.CanvasSize) { inst.CanvasSize[1] = Math.max(1, parseInt(val) || 200); }
      break;
    case 'Density':
      inst.Density = parseFloat(val);
      if (scene.fog) scene.fog.far = 600 - (inst.Density * 500);
      break;
    case 'FogColor':
      inst.FogColor = new THREE.Color(val);
      if (scene.fog) scene.fog.color.copy(inst.FogColor);
      break;
    case 'Offset':
      inst.Offset = parseFloat(val);
      break;
    case 'Volume': inst.Volume = parseFloat(val); break;
    case 'Playing': inst.Playing = !!val; break;
    case 'Looped': inst.Looped = !!val; break;
    case 'Enabled': 
      inst.Enabled = !!val;
      if (inst._lightRef) inst._lightRef.visible = inst.Enabled;
      break;
    case 'Range':
      inst.Range = parseFloat(val);
      if (inst._lightRef) inst._lightRef.distance = inst.Range;
      break;
    case 'Shadows':
      inst.Shadows = !!val;
      if (inst._lightRef) inst._lightRef.castShadow = inst.Shadows;
      break;
    case 'Color':
      inst.Color = new THREE.Color(val);
      if (inst.mesh && inst.ClassName === 'PointLight') inst.mesh.material.color.copy(inst.Color);
      if (inst._lightRef) inst._lightRef.color.copy(inst.Color);
      break;
    case 'Text': inst.Text = String(val); break;
    case 'FontSize': inst.FontSize = parseFloat(val); break;
    case 'TextColor': inst.TextColor = new THREE.Color(val); break;
    case 'TextTransparency': inst.TextTransparency = parseFloat(val); break;
    case 'BackgroundColor': inst.BackgroundColor = new THREE.Color(val); break;
    case 'BackgroundTransparency': inst.BackgroundTransparency = parseFloat(val); break;
    case 'Visible': inst.Visible = !!val; break;
    case 'posX': inst.Position[0] = parseFloat(val); break;
    case 'posY': inst.Position[1] = parseFloat(val); break;
    case 'sizeX': inst.Size[0] = parseFloat(val); break;
    case 'sizeY': inst.Size[1] = parseFloat(val); break;
    case 'Face': inst.Face = String(val); break;
  }

  _updateSelectionBox();
  if (_onChangeCallback) _onChangeCallback(getPartsData());
  updateProps();
}

function _updateStudioGuiPreview() {
  if (!_guiPreviewContainer || !_game) return;
  _guiPreviewContainer.innerHTML = '';
  
  const renderGui = (inst, parentEl) => {
    if (inst.Visible === false) return;
    
    let el = null;
    if (inst.ClassName === 'Frame') {
      el = document.createElement('div');
    } else if (inst.ClassName === 'TextLabel') {
      el = document.createElement('div');
      el.textContent = inst.Text;
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      const tAlpha = 1 - (inst.TextTransparency || 0);
      if (tAlpha <= 0) {
        el.style.color = 'transparent';
      } else if (tAlpha < 1) {
        const tc = inst.TextColor;
        el.style.color = tc ? 'rgba(' + Math.round(tc.r * 255) + ',' + Math.round(tc.g * 255) + ',' + Math.round(tc.b * 255) + ',' + tAlpha + ')' : '#fff';
      } else {
        el.style.color = '#' + inst.TextColor.getHexString();
      }
      el.style.fontSize = inst.FontSize + 'px';
    } else if (inst.ClassName === 'TextButton') {
      el = document.createElement('button');
      el.textContent = inst.Text;
      const btAlpha = 1 - (inst.TextTransparency || 0);
      if (btAlpha <= 0) {
        el.style.color = 'transparent';
      } else if (btAlpha < 1) {
        const tc = inst.TextColor;
        el.style.color = tc ? 'rgba(' + Math.round(tc.r * 255) + ',' + Math.round(tc.g * 255) + ',' + Math.round(tc.b * 255) + ',' + btAlpha + ')' : '#fff';
      } else {
        el.style.color = '#' + (inst.TextColor ? inst.TextColor.getHexString() : 'ffffff');
      }
      el.style.fontSize = inst.FontSize + 'px';
    }
    
    if (el) {
      el.style.position = 'absolute';
      const [px, py] = inst.Position || [0, 0];
      const [sx, sy] = inst.Size || [100, 100];
      
      el.style.left = px <= 1 ? (px * 100) + '%' : px + 'px';
      el.style.top = py <= 1 ? (py * 100) + '%' : py + 'px';
      el.style.width = sx <= 1 ? (sx * 100) + '%' : sx + 'px';
      el.style.height = sy <= 1 ? (sy * 100) + '%' : sy + 'px';
      
      const bgAlpha = 1 - (inst.BackgroundTransparency || 0);
      if (bgAlpha <= 0) {
        el.style.backgroundColor = 'transparent';
      } else if (bgAlpha >= 1) {
        const bgColor = inst.BackgroundColor || inst.Color;
        el.style.backgroundColor = bgColor ? '#' + bgColor.getHexString() : '#333';
      } else {
        const c = inst.BackgroundColor || inst.Color;
        if (c) {
          el.style.backgroundColor = 'rgba(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ',' + bgAlpha + ')';
        } else {
          el.style.backgroundColor = 'transparent';
        }
      }
      el.style.border = (inst === selectedInstance) ? '1px solid #5865f2' : 'none';
      el.style.pointerEvents = 'auto'; 
      
      if (inst === selectedInstance) {
        el.style.cursor = 'move';
        el.onmousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const [startPosX, startPosY] = inst.Position;
          
          const onMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            
            const parentRect = parentEl.getBoundingClientRect();
            if (inst.Position[0] <= 1) {
              inst.Position[0] = startPosX + (dx / parentRect.width);
            } else {
              inst.Position[0] = startPosX + dx;
            }
            
            if (inst.Position[1] <= 1) {
              inst.Position[1] = startPosY + (dy / parentRect.height);
            } else {
              inst.Position[1] = startPosY + dy;
            }
            
            updateProps();
            _updateStudioGuiPreview();
          };
          
          const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (_onChangeCallback) _onChangeCallback(getPartsData());
          };
          
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        };
      } else {
        el.onmousedown = (e) => {
          e.stopPropagation();
          selectInstance(inst);
        };
      }

      parentEl.appendChild(el);
      inst.Children.forEach(child => renderGui(child, el));
    } else {
       inst.Children.forEach(child => renderGui(child, parentEl));
    }
  };

  const traverse = (node) => {
    if (node.ClassName === 'ScreenGui' && node.Enabled !== false) {
      renderGui(node, _guiPreviewContainer);
    } else if (node.ClassName !== 'SurfaceGui') {
      node.Children.forEach(traverse);
    }
  };
  
  traverse(_game);
  
  if (_guiEditorWindow && _guiEditorVisible) {
    const editorContainer = _guiEditorWindow._innerContainer;
    if (editorContainer) {
      editorContainer.innerHTML = '';
      const traverseEditor = (node) => {
        if ((node.ClassName === 'ScreenGui' || node.ClassName === 'SurfaceGui') && node.Enabled !== false) {
          renderGui(node, editorContainer);
        } else {
          node.Children.forEach(traverseEditor);
        }
      };
      traverseEditor(_game);
    }
  }
}

function _openGuiEditorWindow() {
  if (_guiEditorWindow) { _guiEditorWindow.style.display = 'flex'; return; }
  _guiEditorWindow = document.createElement('div');
  _guiEditorWindow.style.cssText = `
    position: fixed; bottom: 40px; right: 20px; width: 380px; height: 300px;
    background: rgba(10,16,30,0.95); border: 1px solid rgba(88,101,242,0.4);
    border-radius: 8px; z-index: 10000; display: flex; flex-direction: column;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5); overflow: hidden;
    resize: both; min-width: 200px; min-height: 150px;
  `;
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; background: rgba(88,101,242,0.2); user-select: none;
    cursor: move; font-size: 12px; color: rgba(200,200,200,0.8);
  `;
  header.innerHTML = '<span>GUI Editor</span><span style="cursor:pointer;font-size:14px;">&times;</span>';
  header.lastChild.onclick = () => { _guiEditorVisible = false; _closeGuiEditorWindow(); };
  
  const inner = document.createElement('div');
  inner.style.cssText = 'flex:1;position:relative;overflow:hidden;pointer-events:none;';
  _guiEditorWindow.appendChild(header);
  _guiEditorWindow.appendChild(inner);
  
  // Drag
  let dragging = false, dragStart = { x: 0, y: 0 }, startPos = { x: 0, y: 0 };
  header.onmousedown = (e) => {
    if (e.target === header.lastChild) return;
    dragging = true;
    dragStart.x = e.clientX; dragStart.y = e.clientY;
    const rect = _guiEditorWindow.getBoundingClientRect();
    startPos.x = rect.left; startPos.y = rect.top;
  };
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    _guiEditorWindow.style.left = (startPos.x + e.clientX - dragStart.x) + 'px';
    _guiEditorWindow.style.top = (startPos.y + e.clientY - dragStart.y) + 'px';
    _guiEditorWindow.style.right = 'auto';
    _guiEditorWindow.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
  
  document.body.appendChild(_guiEditorWindow);
  _guiEditorWindow._innerContainer = inner;
}

function _closeGuiEditorWindow() {
  if (_guiEditorWindow) _guiEditorWindow.style.display = 'none';
}

function _getGuiContentHash(inst) {
  let h = '';
  const walk = (n) => {
    if (n.Visible === false) return;
    h += n.ClassName + '|' + n.Position + '|' + n.Size + '|' + (n.Text||'') + '|';
    h += (n.BackgroundColor ? n.BackgroundColor.getHexString()+','+n.BackgroundTransparency : '') + '|';
    h += (n.TextColor ? n.TextColor.getHexString()+','+n.TextTransparency : '') + '|';
    h += (n.FontSize||0) + '|';
    n.Children.forEach(walk);
  };
  walk(inst);
  return h;
}

function _updateStudioSurfaceGuis() {
  if (!camera || !_game) return;
  const vp = renderer.domElement;
  const vw = vp.clientWidth, vh = vp.clientHeight;
  if (!vw || !vh) return;

  const surfaceGuis = [];
  (function scan(node) {
    if (node.ClassName === 'SurfaceGui' && node.Enabled !== false) surfaceGuis.push(node);
    node.Children.forEach(scan);
  })(_game);

  const validIds = new Set();
  const projMat = camera.projectionMatrix;
  const viewMat = camera.matrixWorldInverse;

  const clipToPixels = new THREE.Matrix4().set(
    vw/2, 0,    0, vw/2,
    0,   -vh/2, 0, vh/2,
    0,    0,    1, 0,
    0,    0,    0, 1
  );

  surfaceGuis.forEach(sg => {
    const part = sg.Adornee || sg.Parent;
    if (!part || part.ClassName !== 'Part' || !part.mesh) {
      if (sg._sgStudioEl) sg._sgStudioEl.style.display = 'none';
      return;
    }
    if (!sg._sgStudioId) sg._sgStudioId = 'ssg-' + Math.random().toString(36).slice(2);
    validIds.add(sg._sgStudioId);

    const sz = part.Size || [4, 4, 4];
    const hw = sz[0]/2, hh = sz[1]/2, hd = sz[2]/2;
    const quat = part.mesh.quaternion, pos = part.mesh.position;
    const face = sg.Face || 'Front';
    const cs = sg.CanvasSize || [200, 200];

    const off = 0.025;
    let c0, c1, c2, c3;
    switch (face) {
      case 'Right':
        c0=[ hw+off,-hh, hd]; c1=[ hw+off,-hh,-hd]; c2=[ hw+off, hh,-hd]; c3=[ hw+off, hh, hd]; break;
      case 'Left':
        c0=[-hw-off,-hh,-hd]; c1=[-hw-off,-hh, hd]; c2=[-hw-off, hh, hd]; c3=[-hw-off, hh,-hd]; break;
      case 'Top':
        c0=[-hw, hh+off, hd]; c1=[ hw, hh+off, hd]; c2=[ hw, hh+off,-hd]; c3=[-hw, hh+off,-hd]; break;
      case 'Bottom':
        c0=[-hw,-hh-off,-hd]; c1=[ hw,-hh-off,-hd]; c2=[ hw,-hh-off, hd]; c3=[-hw,-hh-off, hd]; break;
      case 'Back':
        c0=[-hw,-hh,-hd-off]; c1=[ hw,-hh,-hd-off]; c2=[ hw, hh,-hd-off]; c3=[-hw, hh,-hd-off]; break;
      default:
        c0=[-hw,-hh, hd+off]; c1=[ hw,-hh, hd+off]; c2=[ hw, hh, hd+off]; c3=[-hw, hh, hd+off]; break;
    }

    const fcx = (c0[0]+c1[0]+c2[0]+c3[0])/4;
    const fcy = (c0[1]+c1[1]+c2[1]+c3[1])/4;
    const fcz = (c0[2]+c1[2]+c2[2]+c3[2])/4;

    const worldCenter = new THREE.Vector3(fcx, fcy, fcz).applyQuaternion(quat).add(pos);
    const centerNDC = worldCenter.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(projMat, viewMat));
    if (centerNDC.z / centerNDC.w > 1) {
      if (sg._sgStudioEl) sg._sgStudioEl.style.display = 'none';
      return;
    }

    // UV basis vectors in local 3D space
    let du = new THREE.Vector3(c1[0]-c0[0], c1[1]-c0[1], c1[2]-c0[2]).divideScalar(cs[0]);
    let dv = new THREE.Vector3(c3[0]-c0[0], c3[1]-c0[1], c3[2]-c0[2]).divideScalar(cs[1]);

    // Apply rotation (if any) around the face normal
    const rot = sg.Rotation || 0;
    if (rot !== 0) {
      const theta = rot * Math.PI / 180;
      const cosA = Math.cos(theta), sinA = Math.sin(theta);
      const duNew = new THREE.Vector3().copy(du).multiplyScalar(cosA).add(new THREE.Vector3().copy(dv).multiplyScalar(-sinA));
      const dvNew = new THREE.Vector3().copy(du).multiplyScalar(sinA).add(new THREE.Vector3().copy(dv).multiplyScalar(cosA));
      du = duNew;
      dv = dvNew;
    }

    const pixToLocal = new THREE.Matrix4().set(
      du.x, dv.x, 0, c0[0],
      du.y, dv.y, 0, c0[1],
      du.z, dv.z, 1, c0[2],
      0,    0,    0, 1
    );

    const modelMat = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
    const localToWorld = new THREE.Matrix4().multiplyMatrices(modelMat, pixToLocal);
    const fullMatrix = new THREE.Matrix4()
      .multiplyMatrices(clipToPixels, projMat)
      .multiply(viewMat)
      .multiply(localToWorld);

    if (!sg._sgStudioEl) {
      sg._sgStudioEl = document.createElement('div');
      sg._sgStudioEl.dataset.sgStudio = sg._sgStudioId;
      sg._sgStudioEl.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;';
      studioContainer.appendChild(sg._sgStudioEl);
    }
    const el = sg._sgStudioEl;
    el.style.width = cs[0] + 'px';
    el.style.height = cs[1] + 'px';
    el.style.display = 'block';
    el.style.transform = 'matrix3d(' + fullMatrix.elements.join(',') + ')';

    // Only rebuild DOM content when the GUI tree has actually changed
    const hash = _getGuiContentHash(sg);
    if (hash !== sg._sgContentHash) {
      sg._sgContentHash = hash;
      el.innerHTML = '';
      const renderGuiElement = (inst, parentEl) => {
        if (inst.Visible === false) return;
        let el2 = null;
        if (inst.ClassName === 'Frame') {
          el2 = document.createElement('div');
        } else if (inst.ClassName === 'TextLabel') {
          el2 = document.createElement('div');
          el2.textContent = inst.Text;
          el2.style.display = 'flex';
          el2.style.alignItems = 'center';
          el2.style.justifyContent = 'center';
          const tAlpha = 1 - (inst.TextTransparency || 0);
          if (tAlpha <= 0) {
            el2.style.color = 'transparent';
          } else if (tAlpha < 1) {
            const tc = inst.TextColor;
            el2.style.color = tc ? 'rgba(' + Math.round(tc.r * 255) + ',' + Math.round(tc.g * 255) + ',' + Math.round(tc.b * 255) + ',' + tAlpha + ')' : '#fff';
          } else {
            el2.style.color = '#' + inst.TextColor.getHexString();
          }
          el2.style.fontSize = inst.FontSize + 'px';
        } else if (inst.ClassName === 'TextButton') {
          el2 = document.createElement('button');
          el2.textContent = inst.Text;
          const btAlpha = 1 - (inst.TextTransparency || 0);
          if (btAlpha <= 0) {
            el2.style.color = 'transparent';
          } else if (btAlpha < 1) {
            const tc = inst.TextColor;
            el2.style.color = tc ? 'rgba(' + Math.round(tc.r * 255) + ',' + Math.round(tc.g * 255) + ',' + Math.round(tc.b * 255) + ',' + btAlpha + ')' : '#fff';
          } else {
            el2.style.color = '#' + (inst.TextColor ? inst.TextColor.getHexString() : 'ffffff');
          }
          el2.style.fontSize = inst.FontSize + 'px';
        }
        if (el2) {
          el2.style.position = 'absolute';
          const [px, py] = inst.Position || [0, 0];
          const [sx, sy] = inst.Size || [100, 100];
          el2.style.left = px <= 1 ? (px * 100) + '%' : px + 'px';
          el2.style.top = py <= 1 ? (py * 100) + '%' : py + 'px';
          el2.style.width = sx <= 1 ? (sx * 100) + '%' : sx + 'px';
          el2.style.height = sy <= 1 ? (sy * 100) + '%' : sy + 'px';
          const bgAlpha = 1 - (inst.BackgroundTransparency || 0);
          if (bgAlpha <= 0) {
            el2.style.backgroundColor = 'transparent';
          } else if (bgAlpha >= 1) {
            const bgColor = inst.BackgroundColor || inst.Color;
            el2.style.backgroundColor = bgColor ? '#' + bgColor.getHexString() : '#333';
          } else {
            const c = inst.BackgroundColor || inst.Color;
            if (c) {
              el2.style.backgroundColor = 'rgba(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ',' + bgAlpha + ')';
            } else {
              el2.style.backgroundColor = 'transparent';
            }
          }
          el2.style.border = (inst === selectedInstance) ? '1px solid #5865f2' : 'none';
          parentEl.appendChild(el2);
          inst.Children.forEach(child => renderGuiElement(child, el2));
        } else {
          inst.Children.forEach(child => renderGuiElement(child, parentEl));
        }
      };
      renderGuiElement(sg, el);
    }
  });

  document.querySelectorAll('[data-sg-studio]').forEach(el => {
    if (!validIds.has(el.dataset.sgStudio)) el.remove();
  });
}

export function getInstanceSuggestions(path) {
  if (!_game) return [];
  
  const parts = path.split('.');
  let current = _game;
  
  if (parts[0] === 'game') {
    parts.shift();
  }
  
  if (parts.length > 0 && parts[0] === 'workspace') {
    current = _game.Children.find(c => c.ClassName === 'Workspace');
    parts.shift();
  } else if (parts.length > 0) {
    // Try to find top level service
    const service = _game.Children.find(c => c.ClassName.toLowerCase() === parts[0].toLowerCase() || c.Name.toLowerCase() === parts[0].toLowerCase());
    if (service) {
      current = service;
      parts.shift();
    }
  }

  // Follow path
  for (const part of parts) {
    if (!part) continue;
    const next = current.Children.find(c => c.Name.toLowerCase() === part.toLowerCase());
    if (next) {
      current = next;
    } else {
      return [];
    }
  }
  
  return current.Children.map(c => ({
    name: c.Name,
    type: c.ClassName,
    isMethod: false
  }));
}

export function startTestMode() {
  if (_isTestMode) return;
  _isTestMode = true;
  
  // Disable controls
  if (controls) controls.enabled = false;
  if (transformControls) transformControls.detach();
  
  // Clear selection
  selectInstance(null);
  
  // Init character state (matching game)
  _charGrounded = false;
  _charVelY = 0;
  _coyoteTimer = 0;
  _jumpBuffer = 0;
  _shiftLock = false;
  _anim = { time: 0, bones: {}, rest: {} };
  
  // Spawn noob character
  _spawnTestCharacter();
  
  // Start scripts
  _runHierarchyScripts();
  
  // Set up keys, mouse, camera (matching game's init)
  _testCamYaw = 0;
  _testCamPitch = 0.35;
  _testCamDist = 25.6;
  _shiftLock = false;
  _rmb = false;

  // Create shift-lock indicator (matching game)
  let shiftLockEl = document.getElementById('shift-lock-indicator');
  if (!shiftLockEl) {
    shiftLockEl = document.createElement('div');
    shiftLockEl.id = 'shift-lock-indicator';
    document.body.appendChild(shiftLockEl);
  }

  const onKeyDown = (e) => {
    _keys[e.code] = true;
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
      _shiftLock = !_shiftLock;
      shiftLockEl.classList.toggle('visible', _shiftLock);
    }
    if (e.code === 'Space') _jumpBuffer = JUMP_BUFFER_T;
  };
  const onKeyUp = (e) => { _keys[e.code] = false; };
  const onMouseMove = (e) => {
    if (document.pointerLockElement && (_shiftLock || _rmb)) {
      _testCamYaw -= e.movementX * CAM_H_SENS;
      _testCamPitch = Math.max(CAM_MIN_PITCH, Math.min(CAM_MAX_PITCH, _testCamPitch + e.movementY * CAM_V_SENS));
    }
  };
  const onWheel = (e) => {
    _testCamDist = Math.max(CAM_MIN_DIST, Math.min(CAM_MAX_DIST, _testCamDist + e.deltaY * 0.04));
  };
  const onPointerDown = (e) => {
    if (e.target.closest('.studio-viewport, .studio-3d-container') && !e.target.closest('.studio-props-panel')) {
      renderer.domElement.requestPointerLock();
    }
  };
  const onMouseDown = (e) => { if (e.button === 2) _rmb = true; };
  const onMouseUp = (e) => { if (e.button === 2) _rmb = false; };
  const onContextMenu = (e) => e.preventDefault();
  const onPointerLockChange = () => {
    if (!document.pointerLockElement) _rmb = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  renderer.domElement.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  _testModeKeyCleanup = () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    renderer.domElement.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    if (document.pointerLockElement) document.exitPointerLock();
    _keys = {};
  };
}

export function stopTestMode() {
  if (!_isTestMode) return;
  _isTestMode = false;

  // Re-enable controls
  if (controls) controls.enabled = true;

  // Cleanup character
  if (_character && scene) {
    scene.remove(_character);
    _character = null;
    _charInstance = null;
  }

  // Cleanup shift-lock indicator
  const shiftLockEl = document.getElementById('shift-lock-indicator');
  if (shiftLockEl) shiftLockEl.remove();

  // Cleanup keys
  if (_testModeKeyCleanup) _testModeKeyCleanup();

  // Abort all running scripts
  _activeScriptControllers.forEach(c => c.abort());
  _activeScriptControllers.clear();

  // Reset clock
  _clock = null;
}

function _spawnTestCharacter() {
  const workspace = _game.Children.find(c => c.ClassName === 'Workspace');
  let spawnPos = new THREE.Vector3(0, CHAR_STAND_Y, 0);

  // Find SpawnLocation
  const findSpawn = (node) => {
    if (node.Name === 'SpawnLocation' && node.mesh) {
      spawnPos.copy(node.mesh.position).add(new THREE.Vector3(0, 5, 0));
      return true;
    }
    return node.Children.some(findSpawn);
  };
  findSpawn(_game);

  // Load the FBX noob model
  const loader = new FBXLoader();
  loader.load('assets/models/player.fbx', (fbx) => {
    // Strip vertex colors
    fbx.traverse(child => {
      if (child.isMesh && child.geometry) {
        for (const key of Object.keys(child.geometry.attributes)) {
          if (key.toLowerCase().includes('color')) {
            child.geometry.deleteAttribute(key);
          }
        }
      }
    });

    // Store bones for animation
    fbx.traverse(child => {
      if (child.isBone || child.type === 'Bone') {
        _anim.bones[child.name] = child;
        _anim.rest[child.name] = {
          x: child.rotation.x, y: child.rotation.y, z: child.rotation.z,
          px: child.position.x, py: child.position.y, pz: child.position.z,
        };
      }
    });

    // Remap materials (matching game's model setup)
    const faceMats = [];
    fbx.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
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
          newMat.name = mat.name;
          if (mat.userData) newMat.userData = JSON.parse(JSON.stringify(mat.userData));
          mats[i] = newMat;
          mat = newMat;
          const matNameLower = (mat.name || child.name || '').toLowerCase();
          if (matNameLower.includes('head') || matNameLower.includes('face')) {
            mat.userData = mat.userData || {};
            mat.userData.isFace = true;
            faceMats.push(mat);
          }
        }
      }
    });

    // Assign a default color scheme (matching game's _applyColorsToModel)
    _applyColorsToModel(fbx, {
      Body: '#1e3a5f',
      Legs: '#2d5a27',
      Arms: '#1e3a5f',
      Head: '#c4a882',
    });

    fbx.position.copy(spawnPos);
    fbx.scale.setScalar(1);
    scene.add(fbx);
    _character = fbx;
    _charInstance = new PlayerInstance('Player');
    _charInstance._characterRef = fbx;
    _charInstance.Parent = _game.Children.find(c => c.ClassName === 'Workspace');
  });
}

function _applyColorsToModel(model, colors) {
  if (!model || !colors) return;
  model.traverse(child => {
    if (child.isMesh) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!mat) continue;
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

function _runHierarchyScripts() {
  const scripts = [];
  const collect = (node) => {
    if (node.ClassName === 'Script') scripts.push(node);
    node.Children.forEach(collect);
  };
  collect(_game);

  scripts.forEach(s => {
    const ctrl = new AbortController();
    _activeScriptControllers.add(ctrl);
    executeScript(s.Source, {
      game: _game,
      scriptInstance: s,
      signal: ctrl.signal,
      character: _character || null,
      isJS: s.Name.endsWith('.js'),
      onOutput: (msg, type) => {
        if (window.addOutput) window.addOutput(`[${s.Name}] ${msg}`, type);
      }
    });
  });
}

function _getPartColliders() {
  // Collect AABB colliders from all collidable parts (matches game's spatial grid)
  const colliders = [];
  const collect = (node) => {
    if (node.ClassName === 'Part' && node.CanCollide !== false && node.mesh) {
      const s = node.Size || [4, 1, 4];
      const p = node.mesh.position;
      colliders.push({
        minX: p.x - s[0] / 2, maxX: p.x + s[0] / 2,
        minY: p.y - s[1] / 2, maxY: p.y + s[1] / 2,
        minZ: p.z - s[2] / 2, maxZ: p.z + s[2] / 2,
        inst: node,
      });
    }
    node.Children.forEach(collect);
  };
  collect(_game);
  return colliders;
}

function _fireTouched(collider) {
  if (_charInstance && collider.inst && collider.inst.Touched) {
    collider.inst.Touched.Fire(_charInstance);
  }
}

function _updateTestMode(dt) {
  if (!_isTestMode || !_character) return;

  // ── Movement input (matching game's update()) ──
  const moveInput = new THREE.Vector3();
  if (_keys['KeyW'] || _keys['ArrowUp'])    moveInput.z -= 1;
  if (_keys['KeyS'] || _keys['ArrowDown'])  moveInput.z += 1;
  if (_keys['KeyA'] || _keys['ArrowLeft'])  moveInput.x -= 1;
  if (_keys['KeyD'] || _keys['ArrowRight']) moveInput.x += 1;

  const moving = moveInput.lengthSq() > 0;
  _charMoving = moving;
  let velX = 0, velZ = 0;

  if (moving) {
    moveInput.normalize();
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), _testCamYaw);
    moveInput.applyQuaternion(yawQuat);
    velX = moveInput.x * WALK_SPEED;
    velZ = moveInput.z * WALK_SPEED;
    if (!_shiftLock) {
      const targetAngle = Math.atan2(moveInput.x, moveInput.z);
      _character.rotation.y += (targetAngle - _character.rotation.y) * Math.min(1, ROT_SPEED * dt);
    }
  }

  // Speed cap
  const sp2 = velX * velX + velZ * velZ;
  if (sp2 > WALK_SPEED * WALK_SPEED) {
    const sc = WALK_SPEED / Math.sqrt(sp2);
    velX *= sc; velZ *= sc;
  }

  // ── Axis-separated collision sweep (matching game's swept-AABB) ──
  const colliders = _getPartColliders();
  const fy0 = _character.position.y - CHAR_FOOT_OFFSET;
  const acos = Math.abs(Math.cos(_character.rotation.y));
  const asin = Math.abs(Math.sin(_character.rotation.y));
  const halfX = CHAR_HALF_W * acos + CHAR_HALF_D * asin;
  const halfZ = CHAR_HALF_W * asin + CHAR_HALF_D * acos;

  // X sweep
  let dx = velX * dt;
  for (const b of colliders) {
    if (b.maxY <= fy0 + 0.05 || b.minY >= fy0 + CHAR_HEIGHT) continue;
    const stepNeeded = b.maxY - fy0;
    if (stepNeeded > 0 && stepNeeded <= STEP_HEIGHT && _charGrounded && _charVelY <= 0) continue;
    if (_character.position.z + halfZ <= b.minZ + SWEEP_MARGIN || _character.position.z - halfZ >= b.maxZ - SWEEP_MARGIN) continue;
    if (dx > 0) {
      const edge = _character.position.x + halfX;
      if (edge > b.minX) continue;
      const allow = b.minX - edge;
      if (allow < dx) { dx = Math.max(0, allow); _fireTouched(b); }
    } else if (dx < 0) {
      const edge = _character.position.x - halfX;
      if (edge < b.maxX) continue;
      const allow = b.maxX - edge;
      if (allow > dx) { dx = Math.min(0, allow); _fireTouched(b); }
    }
  }
  _character.position.x += dx;

  // Z sweep
  let dz = velZ * dt;
  for (const b of colliders) {
    if (b.maxY <= fy0 + 0.05 || b.minY >= fy0 + CHAR_HEIGHT) continue;
    const stepNeeded = b.maxY - fy0;
    if (stepNeeded > 0 && stepNeeded <= STEP_HEIGHT && _charGrounded && _charVelY <= 0) continue;
    if (_character.position.x + halfX <= b.minX + SWEEP_MARGIN || _character.position.x - halfX >= b.maxX - SWEEP_MARGIN) continue;
    if (dz > 0) {
      const edge = _character.position.z + halfZ;
      if (edge > b.minZ) continue;
      const allow = b.minZ - edge;
      if (allow < dz) { dz = Math.max(0, allow); _fireTouched(b); }
    } else if (dz < 0) {
      const edge = _character.position.z - halfZ;
      if (edge < b.maxZ) continue;
      const allow = b.maxZ - edge;
      if (allow > dz) { dz = Math.min(0, allow); _fireTouched(b); }
    }
  }
  _character.position.z += dz;

  // ── Coyote time & jump buffer ──
  if (_charGrounded) _coyoteTimer = COYOTE_TIME;
  else _coyoteTimer = Math.max(0, _coyoteTimer - dt);

  if (_keys['Space']) _jumpBuffer = JUMP_BUFFER_T;
  _jumpBuffer = Math.max(0, _jumpBuffer - dt);

  // ── Vertical ──
  _charVelY += GRAVITY * dt;
  _character.position.y += _charVelY * dt;

  // Ground snap (world floor)
  _charGrounded = false;

  // Vertical collision against parts
  for (const b of colliders) {
    if (_character.position.x + halfX <= b.minX || _character.position.x - halfX >= b.maxX) continue;
    if (_character.position.z + halfZ <= b.minZ || _character.position.z - halfZ >= b.maxZ) continue;
    const footY = _character.position.y - CHAR_FOOT_OFFSET;
    if (_charVelY <= 0 && footY <= b.maxY && footY >= b.maxY - CHAR_HEIGHT) {
      _character.position.y = b.maxY + CHAR_FOOT_OFFSET;
      _charVelY = 0;
      _charGrounded = true;
      _fireTouched(b);
      break;
    }
  }

  // World floor ground
  if (!_charGrounded && _character.position.y <= CHAR_STAND_Y) {
    _character.position.y = CHAR_STAND_Y;
    _charVelY = 0;
    _charGrounded = true;
  }

  // ── Jump ──
  if (_jumpBuffer > 0 && (_charGrounded || _coyoteTimer > 0)) {
    _charVelY = JUMP_POWER;
    _charGrounded = false;
    _coyoteTimer = 0;
    _jumpBuffer = 0;
  }

  // ── Fall respawn ──
  if (_character.position.y < -100) {
    _character.position.set(0, CHAR_STAND_Y, 0);
    _charVelY = 0;
    _charGrounded = false;
  }

  // ── Shift lock (camera-aligned movement) ──
  if (_shiftLock) _character.rotation.y = _testCamYaw + Math.PI;

  // ── Animations ──
  _updateAnimations(dt);

  // ── Camera (matching game's updateCamera) ──
  const sinYaw = Math.sin(_testCamYaw);
  const cosYaw = Math.cos(_testCamYaw);
  const sinPitch = Math.sin(_testCamPitch);
  const cosPitch = Math.cos(_testCamPitch);

  const pivot = new THREE.Vector3(
    _character.position.x,
    _character.position.y + CAM_PIVOT_Y,
    _character.position.z
  );

  if (_shiftLock) {
    pivot.x += cosYaw * SHIFT_LOCK_OFFSET;
    pivot.z += -sinYaw * SHIFT_LOCK_OFFSET;
  }

  const targetCamPos = new THREE.Vector3(
    pivot.x + _testCamDist * cosPitch * sinYaw,
    pivot.y + _testCamDist * sinPitch,
    pivot.z + _testCamDist * cosPitch * cosYaw
  );
  camera.position.lerp(targetCamPos, 0.15);
  camera.lookAt(pivot);
}

// ─── Animation helpers (matching bloxverse-engine.js) ────────────────────────
function _setRot(bone, axis, target, speed, dt) {
  if (!bone) return;
  const rest = _anim.rest[bone.name]?.[axis] ?? 0;
  bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], rest + target, Math.min(1, speed * dt));
}

function _updateAnimations(dt) {
  _anim.time += dt;
  const t = _anim.time, sp = 12;
  const lLeg = _anim.bones['Left_Leg'],  rLeg = _anim.bones['Right_Leg'];
  const lArm = _anim.bones['Left_Arm'],  rArm = _anim.bones['Right_Arm'];
  const torso = _anim.bones['Torso'];
  const lArmRestY = _anim.rest['Left_Arm']?.py  ?? 0;
  const rArmRestY = _anim.rest['Right_Arm']?.py ?? 0;

  if (!_charGrounded) {
    _setRot(lLeg,  'x',  0,       sp, dt);
    _setRot(rLeg,  'x',  0,       sp, dt);
    _setRot(lArm,  'x', -Math.PI, sp, dt);
    _setRot(rArm,  'x', -Math.PI, sp, dt);
    _setRot(lArm,  'z',  0,       sp, dt);
    _setRot(rArm,  'z',  0,       sp, dt);
    _setRot(torso, 'x',  0,       sp, dt);
    if (lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY - 0.75, Math.min(1, sp*dt));
    if (rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY - 0.75, Math.min(1, sp*dt));
  } else if (_charMoving) {
    const swing = Math.sin(t * 2.8 * Math.PI);
    _setRot(lLeg,  'x',  swing * 1.0,  sp, dt);
    _setRot(rLeg,  'x', -swing * 1.0,  sp, dt);
    _setRot(lArm,  'x', -swing * 0.8,  sp, dt);
    _setRot(rArm,  'x',  swing * 0.8,  sp, dt);
    _setRot(lArm,  'z',  0.05,         sp, dt);
    _setRot(rArm,  'z', -0.05,         sp, dt);
    _setRot(torso, 'x',  0.03,         sp, dt);
    _setRot(torso, 'z',  0,            sp, dt);
    if (lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*dt));
    if (rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*dt));
  } else {
    const breathe = Math.sin(t * 1.2) * 0.015;
    _setRot(lLeg,  'x',  0,             sp, dt);
    _setRot(rLeg,  'x',  0,             sp, dt);
    _setRot(lArm,  'x',  0,             sp, dt);
    _setRot(rArm,  'x',  0,             sp, dt);
    _setRot(lArm,  'z',  0.1 + breathe, sp, dt);
    _setRot(rArm,  'z', -0.1 - breathe, sp, dt);
    _setRot(torso, 'x',  breathe,       sp, dt);
    _setRot(torso, 'z',  0,             sp, dt);
    if (lArm) lArm.position.y = THREE.MathUtils.lerp(lArm.position.y, lArmRestY, Math.min(1, sp*dt));
    if (rArm) rArm.position.y = THREE.MathUtils.lerp(rArm.position.y, rArmRestY, Math.min(1, sp*dt));
  }
}
