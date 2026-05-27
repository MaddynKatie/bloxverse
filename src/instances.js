import * as THREE from 'three';

export class Signal {
  constructor() {
    this._handlers = [];
  }
  Connect(handler) {
    this._handlers.push(handler);
    return {
      Disconnect: () => {
        const i = this._handlers.indexOf(handler);
        if (i !== -1) this._handlers.splice(i, 1);
      }
    };
  }
  Fire(...args) {
    this._handlers.forEach(h => {
      try { h(...args); } catch (e) { console.error('[Signal] Handler error:', e); }
    });
  }
}

export class Instance {
  // Callbacks set by the engine for runtime creation/destruction of meshes/physics
  static _onPartCreateMesh = null;
  static _onPartDestroyMesh = null;

  constructor(className, name) {
    this.ClassName = className;
    this.Name = name || className;
    this.Parent = null;
    this.Children = [];
    this._expanded = true;
    this.Changed = null; // Callback for property changes
  }

  static new(className, name) {
    const ctor = {
      Part: PartInstance,
      Folder: Folder,
      Script: ScriptInstance,
      Sound: Sound,
      PointLight: PointLight,
      Sky: Sky,
      Atmosphere: Atmosphere,
      ScreenGui: ScreenGui,
      Frame: Frame,
      TextLabel: TextLabel,
      TextButton: TextButton,
      SurfaceGui: SurfaceGui,
      IntValue: IntValue,
      StringValue: StringValue,
      NumberValue: NumberValue,
      BoolValue: BoolValue,
      Player: PlayerInstance,
      Model: ModelInstance,
    }[className];
    if (!ctor) throw new Error(`Unknown class: ${className}`);
    return new ctor(name);
  }

  setProperty(prop, value) {
    const oldVal = this[prop];
    this[prop] = value;
    if (this.Changed && oldVal !== value) {
      this.Changed(prop, value);
    }
  }

  setParent(newParent) {
    if (this.Parent === newParent) return;
    if (this.Parent) {
      const idx = this.Parent.Children.indexOf(this);
      if (idx !== -1) this.Parent.Children.splice(idx, 1);
    }
    this.Parent = newParent;
    if (newParent) {
      newParent.Children.push(this);
    }
  }

  Destroy() {
    this._onDestroy();
    if (this.Parent) {
      const idx = this.Parent.Children.indexOf(this);
      if (idx !== -1) this.Parent.Children.splice(idx, 1);
    }
    this.Children.forEach(c => c.Destroy());
  }

  _onDestroy() {}

  FindFirstChild(name, recursive) {
    if (recursive) {
      for (const c of this.Children) {
        if (c.Name === name) return c;
        const found = c.FindFirstChild(name, true);
        if (found) return found;
      }
      return null;
    }
    return this.Children.find(c => c.Name === name) || null;
  }

  GetChildren() {
    return [...this.Children];
  }

  IsA(className) {
    const map = {
      'Instance': true,
      'Part': true, 'PartInstance': true,
      'Folder': true,
      'Script': true, 'ScriptInstance': true,
      'Sound': true,
      'PointLight': true,
      'Sky': true,
      'Atmosphere': true,
      'ScreenGui': true,
      'Frame': true,
      'TextLabel': true,
      'TextButton': true,
      'SurfaceGui': true,
      'IntValue': true,
      'StringValue': true,
      'NumberValue': true,
      'BoolValue': true,
      'Player': true, 'PlayerInstance': true,
      'DataModel': true,
      'Workspace': true,
      'Lighting': true,
      'Players': true,
      'StarterGui': true,
      'ReplicatedStorage': true,
      'Model': true,
    };
    return !!map[className];
  }

  ClearAllChildren() {
    while (this.Children.length > 0) {
      this.Children[0].Destroy();
    }
  }

  WaitForChild(name, timeout) {
    return new Promise((resolve, reject) => {
      const found = this.FindFirstChild(name);
      if (found) return resolve(found);
      const timer = timeout ? setTimeout(() => reject(new Error(`WaitForChild timed out: ${name}`)), timeout * 1000) : null;
      const listener = (prop, val) => {
        if (prop === 'Children') {
          const child = this.FindFirstChild(name);
          if (child) {
            if (timer) clearTimeout(timer);
            resolve(child);
          }
        }
      };
      this.Changed = listener;
    });
  }
}

function _isInWorkspace(inst) {
  let cur = inst.Parent;
  while (cur) {
    if (cur.ClassName === 'Workspace') return true;
    cur = cur.Parent;
  }
  return false;
}

export class PartInstance extends Instance {
  constructor(name) {
    super('Part', name);
    this.Shape = 'Block';
    this.Size = [4, 4, 4];
    this.Color = new THREE.Color(0x808080);
    this.Anchored = true;
    this.CanCollide = true;
    this.Transparency = 0;
    this.Position = [0, 0, 0];
    this.mesh = null;
    this.Touched = new Signal();
  }

  setParent(newParent) {
    const wasInWs = _isInWorkspace(this);
    super.setParent(newParent);
    const nowInWs = _isInWorkspace(this);
    if (!wasInWs && nowInWs) {
      Instance._onPartCreateMesh?.(this);
    } else if (wasInWs && !nowInWs) {
      Instance._onPartDestroyMesh?.(this);
    }
  }

  _onDestroy() {
    if (this.mesh) Instance._onPartDestroyMesh?.(this);
  }
}

export class ScriptInstance extends Instance {
  constructor(name, code) {
    super('Script', name);
    this.Source = code || '';
  }
}

export class Sky extends Instance {
  constructor(name) {
    super('Sky', name || 'Sky');
    this.SkyboxColor = new THREE.Color(0x7ec8e3);
    this.SunPosition = [100, 100, 100];
    this.SunColor = new THREE.Color(0xffffff);
    this.Brightness = 1.0;
  }
}

export class Atmosphere extends Instance {
  constructor(name) {
    super('Atmosphere', name || 'Atmosphere');
    this.Density = 0.3;
    this.Offset = 0;
    this.FogColor = new THREE.Color(0x7ec8e3);
  }
}

export class Folder extends Instance {
  constructor(name) {
    super('Folder', name || 'Folder');
  }
}

export class IntValue extends Instance {
  constructor(name) {
    super('IntValue', name || 'IntValue');
    this.Value = 0;
  }
}

export class StringValue extends Instance {
  constructor(name) {
    super('StringValue', name || 'StringValue');
    this.Value = '';
  }
}

export class NumberValue extends Instance {
  constructor(name) {
    super('NumberValue', name || 'NumberValue');
    this.Value = 0;
  }
}

export class BoolValue extends Instance {
  constructor(name) {
    super('BoolValue', name || 'BoolValue');
    this.Value = false;
  }
}

export class ModelInstance extends Instance {
  constructor(name) {
    super('Model', name || 'Model');
    this.PrimaryPart = null;
  }
}

export class PlayerInstance extends Instance {
  constructor(name) {
    super('Player', name || 'Player');
    this.UserId = '';
    this.Character = null;
    this.CharacterAdded = new Signal();
    this._characterRef = null;
  }
  get Position() {
    if (this._characterRef) {
      return { x: this._characterRef.position.x, y: this._characterRef.position.y, z: this._characterRef.position.z };
    }
    return { x: 0, y: 0, z: 0 };
  }
  set Position(val) {
    if (this._characterRef && val != null) {
      const x = (val.x ?? val[0]) ?? 0;
      const y = (val.y ?? val[1]) ?? 0;
      const z = (val.z ?? val[2]) ?? 0;
      this._characterRef.position.set(x, y, z);
    }
  }
}

export class Sound extends Instance {
  constructor(name) {
    super('Sound', name || 'Sound');
    this.SoundId = '';
    this.Volume = 0.5;
    this.Playing = false;
    this.Looped = false;
    this.PlayOnRemove = false;
    this.Ended = new Signal();
  }
  Play() {
    this.Playing = true;
    if (this.onPlay) this.onPlay();
  }
  Stop() {
    this.Playing = false;
    if (this.onStop) this.onStop();
  }
}

export class PointLight extends Instance {
  constructor(name) {
    super('PointLight', name || 'PointLight');
    this.Color = new THREE.Color(0xffffff);
    this.Brightness = 1.0;
    this.Range = 16;
    this.Shadows = false;
    this.Enabled = true;
  }
}

export class SurfaceGui extends Instance {
  constructor(name) {
    super('SurfaceGui', name || 'SurfaceGui');
    this.Face = 'Front';
    this.Adornee = null;
    this.Enabled = true;
    this.CanvasSize = [200, 200];
    this.SizingMode = 'FixedSize';
    this.Rotation = 0;
  }
}

export class ScreenGui extends Instance {
  constructor(name) {
    super('ScreenGui', name || 'ScreenGui');
    this.Enabled = true;
    this._domWrapper = null;
  }

  // Called by engine when this ScreenGui is parented to StarterGui
  _mountDOM() {
    if (this._domWrapper) return;
    const container = document.getElementById('scriptGuiContainer');
    if (!container) return;
    const wrapper = document.createElement('div');
    wrapper.dataset.bvScreenGui = this.Name;
    wrapper.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    container.appendChild(wrapper);
    this._domWrapper = wrapper;
  }

  _onDestroy() {
    this._domWrapper?.remove();
    this._domWrapper = null;
  }

  setParent(newParent) {
    super.setParent(newParent);
    if (newParent?.ClassName === 'StarterGui' || newParent?.Name === 'StarterGui') {
      this._mountDOM();
    }
  }

  setProperty(prop, value) {
    super.setProperty(prop, value);
    if (prop === 'Enabled') {
      if (this._domWrapper) this._domWrapper.style.display = value ? '' : 'none';
    }
  }
}

export class Frame extends Instance {
  constructor(name) {
    super('Frame', name || 'Frame');
    this.Visible = true;
    this.BackgroundColor = new THREE.Color(0x333333);
    this.BackgroundTransparency = 0;
    this.Position = [0, 0];
    this.Size = [100, 100];
    this.Rotation = 0;
    this._domEl = null;
  }

  _mountDOM(parentEl) {
    if (this._domEl) return;
    const el = document.createElement('div');
    el.dataset.bvFrame = this.Name;
    el.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:auto;';
    parentEl.appendChild(el);
    this._domEl = el;
    this._applyDOM();
  }

  _applyDOM() {
    if (!this._domEl) return;
    const el = this._domEl;
    const [sw, sh] = Array.isArray(this.Size) ? this.Size : [this.Size?.x ?? 100, this.Size?.y ?? 100];
    const [px, py] = Array.isArray(this.Position) ? this.Position : [this.Position?.x ?? 0, this.Position?.y ?? 0];
    const alpha = 1 - Math.max(0, Math.min(1, this.BackgroundTransparency));
    const c = this.BackgroundColor;
    const r = Math.round((c.r ?? 0) * 255), g = Math.round((c.g ?? 0) * 255), b = Math.round((c.b ?? 0) * 255);
    Object.assign(el.style, {
      left: px + 'px', top: py + 'px', width: sw + 'px', height: sh + 'px',
      background: `rgba(${r},${g},${b},${alpha})`,
      display: this.Visible ? '' : 'none',
    });
  }

  setProperty(prop, value) {
    super.setProperty(prop, value);
    this._applyDOM();
  }

  setParent(newParent) {
    super.setParent(newParent);
    const dom = newParent?._domWrapper || newParent?._domEl;
    if (dom) this._mountDOM(dom);
  }

  _onDestroy() { this._domEl?.remove(); this._domEl = null; }
}

export class TextLabel extends Instance {
  constructor(name) {
    super('TextLabel', name || 'TextLabel');
    this.Text = 'Label';
    this.TextColor = new THREE.Color(0xffffff);
    this.TextTransparency = 0;
    this.BackgroundColor = new THREE.Color(0x000000);
    this.BackgroundTransparency = 1; // transparent by default like Roblox
    this.FontSize = 14;
    this.Visible = true;
    this.Position = [0, 0];
    this.Size = [200, 50];
    this.Rotation = 0;
    this._domEl = null;
  }

  _mountDOM(parentEl) {
    if (this._domEl) return;
    const el = document.createElement('div');
    el.dataset.bvTextLabel = this.Name;
    el.style.cssText = 'position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;pointer-events:none;overflow:hidden;';
    parentEl.appendChild(el);
    this._domEl = el;
    this._applyDOM();
  }

  _applyDOM() {
    if (!this._domEl) return;
    const el = this._domEl;
    const [sw, sh] = Array.isArray(this.Size) ? this.Size : [this.Size?.x ?? 200, this.Size?.y ?? 50];
    const [px, py] = Array.isArray(this.Position) ? this.Position : [this.Position?.x ?? 0, this.Position?.y ?? 0];
    const bgAlpha = 1 - Math.max(0, Math.min(1, this.BackgroundTransparency));
    const bc = this.BackgroundColor;
    const br = Math.round((bc.r ?? 0) * 255), bg = Math.round((bc.g ?? 0) * 255), bb = Math.round((bc.b ?? 0) * 255);
    const txtAlpha = 1 - Math.max(0, Math.min(1, this.TextTransparency));
    const tc = this.TextColor;
    const tr = Math.round((tc.r ?? 0) * 255), tg = Math.round((tc.g ?? 0) * 255), tb = Math.round((tc.b ?? 0) * 255);
    Object.assign(el.style, {
      left: px + 'px', top: py + 'px', width: sw + 'px', height: sh + 'px',
      fontSize: this.FontSize + 'px',
      background: `rgba(${br},${bg},${bb},${bgAlpha})`,
      color: `rgba(${tr},${tg},${tb},${txtAlpha})`,
      display: this.Visible ? 'flex' : 'none',
    });
    el.textContent = this.Text;
  }

  setProperty(prop, value) {
    super.setProperty(prop, value);
    this._applyDOM();
  }

  // Direct assignment support: label.Text = "..."
  set Text(v) { this._text = v; this._applyDOM?.(); }
  get Text()   { return this._text ?? 'Label'; }

  setParent(newParent) {
    super.setParent(newParent);
    const dom = newParent?._domWrapper || newParent?._domEl;
    if (dom) this._mountDOM(dom);
  }

  _onDestroy() { this._domEl?.remove(); this._domEl = null; }
}

export class TextButton extends Instance {
  constructor(name) {
    super('TextButton', name || 'TextButton');
    this.Text = 'Button';
    this.TextColor = new THREE.Color(0xffffff);
    this.TextTransparency = 0;
    this.BackgroundColor = new THREE.Color(0x5865f2);
    this.BackgroundTransparency = 0;
    this.FontSize = 14;
    this.Visible = true;
    this.Position = [0, 0];
    this.Size = [200, 50];
    this.Rotation = 0;
    this.MouseButton1Click = new Signal();
    this._domEl = null;
  }

  _mountDOM(parentEl) {
    if (this._domEl) return;
    const el = document.createElement('button');
    el.dataset.bvTextButton = this.Name;
    el.style.cssText = 'position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;pointer-events:auto;border:none;outline:none;cursor:pointer;overflow:hidden;';
    el.addEventListener('click', () => this.MouseButton1Click.Fire());
    parentEl.appendChild(el);
    this._domEl = el;
    this._applyDOM();
  }

  _applyDOM() {
    if (!this._domEl) return;
    const el = this._domEl;
    const [sw, sh] = Array.isArray(this.Size) ? this.Size : [this.Size?.x ?? 200, this.Size?.y ?? 50];
    const [px, py] = Array.isArray(this.Position) ? this.Position : [this.Position?.x ?? 0, this.Position?.y ?? 0];
    const bgAlpha = 1 - Math.max(0, Math.min(1, this.BackgroundTransparency));
    const bc = this.BackgroundColor;
    const br = Math.round((bc.r ?? 0) * 255), bg = Math.round((bc.g ?? 0) * 255), bb = Math.round((bc.b ?? 0) * 255);
    const txtAlpha = 1 - Math.max(0, Math.min(1, this.TextTransparency));
    const tc = this.TextColor;
    const tr = Math.round((tc.r ?? 0) * 255), tg = Math.round((tc.g ?? 0) * 255), tb = Math.round((tc.b ?? 0) * 255);
    Object.assign(el.style, {
      left: px + 'px', top: py + 'px', width: sw + 'px', height: sh + 'px',
      fontSize: this.FontSize + 'px',
      background: `rgba(${br},${bg},${bb},${bgAlpha})`,
      color: `rgba(${tr},${tg},${tb},${txtAlpha})`,
      display: this.Visible ? 'flex' : 'none',
    });
    el.textContent = this.Text;
  }

  setProperty(prop, value) {
    super.setProperty(prop, value);
    this._applyDOM();
  }

  set Text(v) { this._text = v; this._applyDOM?.(); }
  get Text()   { return this._text ?? 'Button'; }

  setParent(newParent) {
    super.setParent(newParent);
    const dom = newParent?._domWrapper || newParent?._domEl;
    if (dom) this._mountDOM(dom);
  }

  _onDestroy() { this._domEl?.remove(); this._domEl = null; }
}

export function initGameHierarchy() {
  const game = new Instance('DataModel', 'game');
  const workspace = new Instance('Workspace', 'Workspace');
  workspace.setParent(game);
  
  const lighting = new Instance('Lighting', 'Lighting');
  lighting.setParent(game);
  
  const sky = new Sky();
  sky.setParent(lighting);
  
  const atmosphere = new Atmosphere();
  atmosphere.setParent(lighting);

  const replicatedStorage = new Instance('ReplicatedStorage', 'ReplicatedStorage');
  replicatedStorage.setParent(game);
  const starterGui = new Instance('StarterGui', 'StarterGui');
  starterGui.setParent(game);
  const players = new Instance('Players', 'Players');
  players.setParent(game);
  return game;
}