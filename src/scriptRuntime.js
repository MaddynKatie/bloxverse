import { Signal, Instance } from './instances.js';

export function luaToJS(lua) {
    // Use a reduce pipeline over an array of transform functions.
    // This prevents esbuild from collapsing the sequential assignments into a
    // single comma-expression `return t=t.replace(...), t=t.replace(...), t`
    // which causes variable-name collisions with minified Proxy handler params.
    const _transforms = [
        (_s) => _s.replace(/--\[\[[\s\S]*?\]\]/g, ''),
        (_s) => _s.replace(/--.*$/gm, ''),
        // Convert Lua table constructors {key = value} to {key: value}
        // Placed early, before block statements are converted to {, so only actual table { is matched
        (_s) => _s.replace(/\{(\s*\w+)\s*=\s*/g, '{$1: '),
        (_s) => _s.replace(/(,\s*)(\w+)\s*=\s*/g, '$1$2: '),
        (_s) => _s.replace(/\blocal\s+function\s+(\w+)\s*\(/g, 'exports.$1 = async function('),
        (_s) => _s.replace(/\bfunction\s+(\w+)\s*\(/g, 'exports.$1 = async function('),
        (_s) => _s.replace(/(?<!\basync\s)\bfunction\s*\(/g, 'async function('),
        (_s) => _s.replace(/^(\s*)end\b/gm, '$1}'),
        (_s) => _s.replace(/(\bfunction\s*\([^)]*\))(?!\s*\{)/g, '$1 {'),
        // Wrap if/while/elseif conditions in parens (skip if already wrapped)
        (_s) => _s.replace(/if\s+(?!\()(.*?)\s+then/g, 'if ($1) then'),
        (_s) => _s.replace(/while\s+(?!\()(.*?)\s+do/g, 'while ($1) {'),
        (_s) => _s.replace(/elseif\s+(?!\()(.*?)\s+then/g, 'else if ($1) then'),
        (_s) => _s.replace(/\blocal\s+/g, 'let '),
        (_s) => _s.replace(/\bthen\b/g, '{'),
        (_s) => _s.replace(/\belseif\b/g, '} else if'),
        (_s) => _s.replace(/\belse\b(?![^\S\n]*(?:\{|if\b))/g, '} else {'),
        // Convert `:` method calls to `.` BEFORE pairs/ipairs conversion
        (_s) => _s.replace(/(\w+(?:\.\w+)*(?:\[[^\]]*\])*):([\w]+)\s*\(/g, '$1.$2('),
        // Convert empty table constructors to arrays so table.insert/sort/concat work
        (_s) => _s.replace(/([=:])\s*\{\}/g, '$1 []'),
        // Convert Lua ipairs/pairs for loops to JS for loops
        // MUST run before `do` → `{` conversion (below) so the `do` keyword is still present
        (_s) => {
            let _forIdx = 0;
            const _np = /((?:[^()]|(?:\([^()]*\)))+)/;
            const _iv  = new RegExp('for\\s+_,\\s*(\\w+)\\s+in\\s+ipairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
            const _ikv = new RegExp('for\\s+(\\w+)\\s*,\\s*(\\w+)\\s+in\\s+ipairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
            const _ik  = new RegExp('for\\s+(\\w+)\\s+in\\s+ipairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
            const _pkv = new RegExp('for\\s+(\\w+)\\s*,\\s*(\\w+)\\s+in\\s+pairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
            _s = _s.replace(_iv,  (_m, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}];`; });
            _s = _s.replace(_ikv, (_m, _k, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}]; let ${_k}=_ip${_i};`; });
            _s = _s.replace(_ik,  (_m, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}];`; });
            _s = _s.replace(_pkv, (_m, _k, _v, _e) => { const _i = _forIdx++; return `for (let _pk${_i} in ${_e}) { let ${_v}=(${_e})[_pk${_i}]; let ${_k}=_pk${_i};`; });
            return _s;
        },
        // Numeric for loops: for i = start, stop[, step] do
        // MUST run before `do` → `{` conversion (below) so the `do` keyword is still present
        (_s) => {
            let _nfi = 0;
            return _s.replace(/for\s+(\w+)\s*=\s*([^,\n]+)\s*,\s*([^,\n{]+?)(?:\s*,\s*([^,\n{]+?))?\s+do/g,
                (_m, _v, _start, _stop, _step) => {
                    _nfi++;
                    const _st = _step ? _step.trim() : '1';
                    const _sn = parseFloat(_st);
                    const _cmp = (!isNaN(_sn) && _sn < 0) ? '>=' : '<=';
                    return `for (let ${_v}=${_start.trim()}; ${_v}${_cmp}${_stop.trim()}; ${_v}+=(${_st})) {`;
                });
        },
        // Convert bare Lua do...end to { ... } — must run AFTER for-loop conversions above
        (_s) => _s.replace(/\bdo\b(?!\s*\{)/g, '{'),
        // Convert repeat...until to do...while
        (_s) => _s.replace(/\brepeat\b/g, 'do {'),
        (_s) => _s.replace(/\buntil\b\s*/g, '} while (!('),
        (_s) => _s.replace(/\bthen\b/g, '{'),
        // Convert remaining `end` at end-of-line to `}` (handles nested braces too)
        (_s) => _s.replace(/\bend\b\s*$/gm, '}'),
        (_s) => _s.replace(/\bnot\s+/g, '!'),
        (_s) => _s.replace(/\band\b/g, '&&'),
        (_s) => _s.replace(/\bor\b/g, '||'),
        (_s) => _s.replace(/\bnil\b/g, 'null'),
        (_s) => _s.replace(/([^.]?)\.\.([^.]?)/g, '$1 + $2'),
        (_s) => _s.replace(/~=/g, '!=='),
        (_s) => _s.replace(/(?<![=!<>])===(?!=)/g, '==='), // keep existing ===
        (_s) => _s.replace(/(?<![=!<>])==(?!=)/g, '==='),
        (_s) => _s.replace(/(?<!['"\w])#(\w+(?:\.\w+)*)/g, '$1.length'),
        // Convert top-level return { k = v } to Object.assign(exports, {k: v})
        // local functions become exports.fn (not bare names), so fall back to exports.fn
        (_s) => _s.replace(/^return\s*\{([^}]*)\}\s*;?\s*$/m, (_match, _inner) =>
            'Object.assign(exports, {' + _inner.replace(/(\w+)\s*:\s*([a-zA-Z_]\w*)/g, (_m, _k, _v) =>
                `${_k}: (typeof ${_v} !== 'undefined' ? ${_v} : exports.${_v})`
            ) + '});'
        ),
        (_s) => _s.replace(/\bmath\./g, 'Math.'),
        (_s) => _s.replace(/\bwait\s*\(/g, 'await wait('),
        (_s) => _s.replace(/\btostring\s*\(/g, 'String('),
        (_s) => _s.replace(/\btonumber\s*\(/g, 'Number('),
        (_s) => _s.replace(/\btype\s*\(/g, '_luaType('),
        // os.clock() → Date.now()/1000 (wall-clock seconds, usable for cooldowns)
        (_s) => _s.replace(/\bos\.clock\s*\(\s*\)/g, '(Date.now()/1000)'),
        // Await async game API calls
        (_s) => _s.replace(/\bgame\.DeductBux\s*\(/g, 'await game.DeductBux('),
        (_s) => _s.replace(/\bgame\.PurchaseGamepass\s*\(/g, 'await game.PurchaseGamepass('),
        (_s) => _s.replace(/\bgame\.PurchaseDeveloperProduct\s*\(/g, 'await game.PurchaseDeveloperProduct('),
        (_s) => _s.replace(/\bgame\.PromptDeveloperProduct\s*\(/g, 'await game.PromptDeveloperProduct('),
        // Compound assignment operators: += -= *= /= //= %= ^= ..=
        // Placed after table-key transforms to avoid {x = …} → {x: …} conflict
        (_s) => _s.replace(
            /(\w+(?:\s*\.\s*\w+)*(?:\s*\[[^\]]+\])*)\s*([+\-*/%]|\.\.)=\s*/g,
            (_m, _v, _op) => {
                if (_op === '..') return `${_v} = ${_v} + `;
                return `${_v} = ${_v} ${_op} `;
            }
        ),
        // ^=  →  **=  (JS supports **= natively)
        (_s) => _s.replace(/\^=(?=\s|$)/g, '**='),
        // ^  →  **  (exponentiation, must run AFTER ^= is already converted)
        (_s) => _s.replace(/\^/g, '**'),
        // //=  →  Math.floor(x / rhs) — capture RHS up to ; or newline
        (_s) => _s.replace(
            /(\w+(?:\s*\.\s*\w+)*(?:\s*\[[^\]]+\])*)\s*\/\/=\s*([^;\n]+)/g,
            (_m, _v, _rhs) => `${_v} = Math.floor(${_v} / ${_rhs})`
        ),
    ];

    return _transforms.reduce((_acc, _fn) => _fn(_acc), lua);
}

function _v3ToArray(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return [v.x ?? v.X ?? 0, v.y ?? v.Y ?? 0, v.z ?? v.Z ?? 0];
    return [0, 0, 0];
}

function _v3ToObj(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return { x: v.x ?? v.X ?? 0, y: v.y ?? v.Y ?? 0, z: v.z ?? v.Z ?? 0 };
    const arr = _v3ToArray(v);
    return { x: arr[0], y: arr[1], z: arr[2] };
}

// ── GUI element wrapper ────────────────────────────────────────────────────────
function createGuiElement(type, props, screenEl) {
    const el = document.createElement(type === 'Frame' ? 'div' : type === 'TextLabel' ? 'div' : 'button');
    el.dataset.guiType = type;

    const state = {
        Text: props.Text ?? (type === 'TextButton' ? 'Button' : 'Label'),
        Visible: props.Visible !== undefined ? props.Visible : true,
        PositionX: props.PositionX ?? 0,
        PositionY: props.PositionY ?? 0,
        SizeX: props.SizeX ?? 100,
        SizeY: props.SizeY ?? 30,
        TextColor: props.TextColor ?? '#ffffff',
        BackgroundColor: props.BackgroundColor ?? (type === 'TextButton' ? '#444444' : 'transparent'),
        BackgroundTransparency: props.BackgroundTransparency ?? 0,
        FontSize: props.FontSize ?? 14,
        ZIndex: props.ZIndex ?? 1,
        TextTransparency: props.TextTransparency ?? 0,
    };

    // Attach click handler from Lua props (bypasses Proxy get trap)
    if (props._click && typeof props._click === 'function') {
        el.addEventListener('click', props._click);
    }

    function applyStyles() {
        el.style.position = 'absolute';
        el.style.zIndex = String(state.ZIndex);
        el.style.fontSize = state.FontSize + 'px';
        el.style.display = state.Visible ? '' : 'none';
        el.style.boxSizing = 'border-box';
        el.style.textAlign = 'center';
        el.style.lineHeight = state.SizeY + 'px';
        el.style.border = 'none';
        el.style.outline = 'none';
        el.style.cursor = type === 'TextButton' ? 'pointer' : 'default';
        el.style.overflow = 'hidden';
        el.style.userSelect = 'none';

        // Position
        const pw = screenEl.clientWidth || window.innerWidth;
        const ph = screenEl.clientHeight || window.innerHeight;
        const px = state.PositionX <= 1 ? state.PositionX * pw : state.PositionX;
        const py = state.PositionY <= 1 ? state.PositionY * ph : state.PositionY;
        const sw = state.SizeX <= 1 ? state.SizeX * pw : state.SizeX;
        const sh = state.SizeY <= 1 ? state.SizeY * ph : state.SizeY;
        el.style.left = (px - sw / 2) + 'px';
        el.style.top = py + 'px';
        el.style.width = sw + 'px';
        el.style.height = sh + 'px';

        // Colors
        const bgAlpha = 1 - state.BackgroundTransparency;
        if (state.BackgroundColor === 'transparent') {
            el.style.background = 'transparent';
        } else {
            const rgb = cssColorToRgb(state.BackgroundColor);
            el.style.background = rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${bgAlpha})` : state.BackgroundColor;
        }
        const txtAlpha = 1 - state.TextTransparency;
        const trgb = cssColorToRgb(state.TextColor);
        el.style.color = trgb ? `rgba(${trgb.r},${trgb.g},${trgb.b},${txtAlpha})` : state.TextColor;

        if (type !== 'Frame') el.textContent = state.Text;
    }

    applyStyles();
    screenEl.appendChild(el);

    const listeners = {};

    // Proxy so scripts can do label.Text = "..." etc.
    const proxy = new Proxy(state, {
        get(t, prop) {
            if (prop === 'Destroy') return () => { el.remove(); };
            if (prop === 'Connect') {
                return (evtName, fn) => {
                    if (!listeners[evtName]) listeners[evtName] = [];
                    listeners[evtName].push(fn);
                    const domEvt = evtName === 'click' ? 'click'
                        : evtName === 'mouseenter' ? 'mouseenter'
                        : evtName === 'mouseleave' ? 'mouseleave'
                        : evtName === 'mousedown' ? 'mousedown'
                        : evtName === 'mouseup' ? 'mouseup'
                        : evtName;
                    el.addEventListener(domEvt, fn);
                    return { Disconnect: () => el.removeEventListener(domEvt, fn) };
                };
            }
            // Roblox-style signal: button.MouseButton1Click:Connect(fn)
            if (prop === 'MouseButton1Click') {
                return {
                    Connect: (fn) => {
                        el.addEventListener('click', fn);
                        return { Disconnect: () => el.removeEventListener('click', fn) };
                    }
                };
            }
            return t[prop];
        },
        set(t, prop, value) {
            t[prop] = value;
            applyStyles();
            return true;
        }
    });

    return proxy;
}

function cssColorToRgb(color) {
    if (!color || color === 'transparent') return null;
    if (typeof color === 'number') {
        return { r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255 };
    }
    if (typeof color === 'object' && 'r' in color) {
        return { r: Math.round(color.r * 255), g: Math.round(color.g * 255), b: Math.round(color.b * 255) };
    }
    if (typeof color === 'string') {
        const hex = color.replace('#', '');
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
        }
        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            return { r: parseInt(hex[0]+hex[0], 16), g: parseInt(hex[1]+hex[1], 16), b: parseInt(hex[2]+hex[2], 16) };
        }
    }
    return null;
}

// ── ScreenGui wrapper ──────────────────────────────────────────────────────────
function createScreenGuiContainer(name) {
    const container = document.createElement('div');
    container.dataset.screenGui = name;
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9000;overflow:hidden;';
    document.body.appendChild(container);

    const guiElements = [];

    const api = {
        Name: name,
        Enabled: true,
        CreateGui(type, props = {}) {
            const el = createGuiElement(type, props, container);
            el._domContainer = container;
            guiElements.push(el);
            return el;
        },
        Destroy() {
            container.remove();
        },
        // Also support Instance-style children
        _container: container,
    };

    // Allow pointer events on interactive children
    container.addEventListener('pointerdown', e => e.stopPropagation(), true);

    return api;
}

// ── Metatables (Lua OOP support) ──────────────────────────────────────────────
function createMetatable(obj, mt) {
    if (!mt) return obj;
    return new Proxy(obj, {
        get(target, prop) {
            if (prop in target) return target[prop];
            const index = mt.__index;
            if (!index) return undefined;
            if (typeof index === 'function') return index(target, prop);
            if (typeof index === 'object') return index[prop];
            return undefined;
        }
    });
}

export function createInstanceProxy(inst) {
    if (!inst) return null;
    if (!inst._attrs) inst._attrs = {};
    const isPart = inst.ClassName === 'Part';
    const isGui = inst.ClassName === 'TextLabel' || inst.ClassName === 'TextButton' || inst.ClassName === 'Frame' || inst.ClassName === 'ScreenGui' || inst.ClassName === 'SurfaceGui';

    return new Proxy(inst, {
        get(target, prop) {
            if (prop === '_target') return target;
            if (prop === 'Parent') return createInstanceProxy(target.Parent);
            if (prop === 'Children') return (target.Children || []).map(c => createInstanceProxy(c));

            if (isPart || target.ClassName === 'Player') {
                if (prop === 'Position') {
                    if (target.mesh) return _v3ToObj(target.mesh.position);
                    if (target._characterRef) return _v3ToObj(target._characterRef.position);
                    return _v3ToObj(target.Position);
                }
                if (prop === 'Size') return _v3ToObj(target.Size);
                if (prop === 'SetVelocity') {
                    return (vx, vy, vz) => {
                        const bv = window._bloxverse;
                        if (target.mesh && bv?._setPartVelocity) bv._setPartVelocity(target.mesh, vx, vy, vz);
                    };
                }
                if (prop === 'SetBounciness') {
                    return (restitution) => {
                        const bv = window._bloxverse;
                        if (target.mesh && bv?._setPartBounciness) bv._setPartBounciness(target.mesh, restitution);
                    };
                }
                if (prop === 'SetTexture') {
                    return (url) => {
                        const bv = window._bloxverse;
                        if (target.mesh && bv?._setPartTexture) bv._setPartTexture(target.mesh, url);
                    };
                }
                if (prop === 'GetVelocity') {
                    return () => {
                        const bv = window._bloxverse;
                        if (target.mesh && bv?._getPartVelocity) return bv._getPartVelocity(target.mesh);
                        return { x: 0, y: 0, z: 0 };
                    };
                }
                if (prop === 'SetPosition') {
                    return (x, y, z) => {
                        target.Position = [x, y, z];
                        if (target.mesh) target.mesh.position.set(x, y, z);
                        if (target.setProperty) { target.setProperty('px', x); target.setProperty('py', y); target.setProperty('pz', z); }
                    };
                }
                if (prop === 'GetPosition') {
                    return () => {
                        const p = _v3ToObj(target.mesh ? target.mesh.position : target.Position);
                        return { x: p.x, y: p.y, z: p.z };
                    };
                }
            }

            // GUI Text property shortcut
            if (isGui && prop === 'Text') return target.Text ?? '';

            // Instance methods
            if (prop === 'Destroy') return () => {
                if (target.Destroy) target.Destroy();
                else if (target.Parent?.Children) {
                    const idx = target.Parent.Children.indexOf(target);
                    if (idx !== -1) target.Parent.Children.splice(idx, 1);
                }
            };
            if (prop === 'ClearAllChildren') return () => {
                if (target.Children) {
                    [...target.Children].forEach(c => { if (c.Destroy) c.Destroy(); });
                    target.Children = [];
                }
            };

            if (prop === 'FindFirstChild') {
                return (name, recursive) => {
                    const found = target.FindFirstChild(name, recursive);
                    return found ? createInstanceProxy(found) : null;
                };
            }
            if (prop === 'GetChildren') {
                return () => (target.Children || []).map(c => createInstanceProxy(c));
            }
            if (prop === 'IsA') return (className) => target.IsA ? target.IsA(className) : target.ClassName === className;
            if (prop === 'WaitForChild') {
                return (name, timeout) => {
                    const p = target.WaitForChild(name, timeout);
                    return p && p.then ? p.then(c => createInstanceProxy(c)) : Promise.resolve(createInstanceProxy(p));
                };
            }
            if (prop === 'GetAttribute') return (name) => target._attrs ? target._attrs[name] : null;
            if (prop === 'SetAttribute') return (name, value) => { if (!target._attrs) target._attrs = {}; target._attrs[name] = value; };
            if (prop === 'GetAttributes') return () => target._attrs ? {...target._attrs} : {};
            if (prop === 'GetFullName') {
                return () => {
                    const parts = [];
                    let cur = target;
                    while (cur && cur.ClassName !== 'DataModel') { parts.unshift(cur.Name); cur = cur.Parent; }
                    return parts.join('.');
                };
            }

            if (prop in target) {
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }

            // Child lookup by name
            const child = (target.Children || []).find(c => c.Name === prop);
            if (child) return createInstanceProxy(child);
            return undefined;
        },
        set(target, prop, value) {
            if (prop === 'Parent') {
                if (target.setParent) target.setParent(value?._target || value);
                else target.Parent = (value?._target || value);
                return true;
            }
            if (prop === 'ClassName') return false;

            // GUI Text setter — calls setProperty which triggers _applyDOM on the instance
            if ((isGui || target.ClassName === 'TextLabel' || target.ClassName === 'TextButton') && prop === 'Text') {
                if (target.setProperty) target.setProperty('Text', value);
                else target.Text = value;
                return true;
            }

            if (prop === 'BackgroundColor3' || prop === 'BackgroundColor') {
                const c = value;
                if (typeof c === 'object' && c !== null && 'r' in c) {
                    if (target.BackgroundColor) target.BackgroundColor.setRGB(c.r, c.g, c.b);
                    else target.BackgroundColor = c;
                } else {
                    const hex = typeof c === 'number' ? c : parseInt(String(c).replace('#', ''), 16);
                    if (target.BackgroundColor?.setHex) target.BackgroundColor.setHex(hex);
                    else target.BackgroundColor = c;
                }
                if (target.setProperty) target.setProperty('BackgroundColor', target.BackgroundColor ?? value);
                return true;
            }
            if (prop === 'TextColor3' || prop === 'TextColor') {
                const c = value;
                if (typeof c === 'object' && c !== null && 'r' in c) {
                    if (target.TextColor?.setRGB) target.TextColor.setRGB(c.r, c.g, c.b);
                    else target.TextColor = c;
                } else {
                    const hex = typeof c === 'number' ? c : parseInt(String(c).replace('#', ''), 16);
                    if (target.TextColor?.setHex) target.TextColor.setHex(hex);
                    else target.TextColor = c;
                }
                if (target.setProperty) target.setProperty('TextColor', target.TextColor ?? value);
                return true;
            }
            if (target[prop] instanceof Signal) return true;
            if (isPart || target.ClassName === 'Player') {
                if (prop === 'Position') {
                    const arr = _v3ToArray(value);
                    if (isPart) target.Position = arr;
                    if (target.mesh) {
                        target.mesh.position.set(arr[0], arr[1], arr[2]);
                        target.setProperty?.('px', arr[0]);
                        target.setProperty?.('py', arr[1]);
                        target.setProperty?.('pz', arr[2]);
                    } else if (target._characterRef) {
                        target._characterRef.position.set(arr[0], arr[1], arr[2]);
                    }
                    return true;
                }
                if (prop === 'Size') {
                    const arr = _v3ToArray(value);
                    target.Size = arr;
                    target.setProperty?.('Size', arr);
                    return true;
                }
                if (prop === 'CanCollide') {
                    target.CanCollide = !!value;
                    if (target.mesh) {
                        if (!target.mesh.userData) target.mesh.userData = {};
                        target.mesh.userData.canCollide = target.CanCollide;
                        const bv = window._bloxverse;
                        if (bv) {
                            if (target.CanCollide) bv._activatePartCollider?.(target.mesh);
                            else bv._deactivatePartCollider?.(target.mesh);
                        }
                    }
                    return true;
                }
                if (prop === 'Color') {
                    if (typeof value === 'object' && value !== null && 'r' in value) {
                        target.Color.setRGB(value.r, value.g, value.b);
                    } else {
                        const hex = typeof value === 'number' ? value : parseInt(String(value).replace('#', ''), 16);
                        target.Color.setHex(hex);
                    }
                    target.setProperty?.('Color', target.Color);
                    return true;
                }
            }
            if (prop === 'Value' && (target.ClassName === 'IntValue' || target.ClassName === 'StringValue' || target.ClassName === 'NumberValue' || target.ClassName === 'BoolValue')) {
                target.Value = value;
                target.setProperty?.('Value', value);
                return true;
            }
            if (target.setProperty) {
                target.setProperty(prop, value);
            } else {
                target[prop] = value;
            }
            return true;
        }
    });
}

// ── sprintf ────────────────────────────────────────────────────────────────────
function sprintf(fmt, ...args) {
    let i = 0;
    return fmt.replace(/%(-?)(\d*)(\.?\d*)([xXdsf%])/g, (m, minus, width, prec, type) => {
        if (type === '%') return '%';
        const val = args[i++];
        if (val == null) return m;
        let s;
        if (type === 'x' || type === 'X') {
            s = Number(val).toString(16);
            if (type === 'X') s = s.toUpperCase();
            if (width) s = s.padStart(Number(width), '0');
        } else if (type === 'd') {
            s = String(Math.floor(Number(val)));
            if (width) s = minus ? s.padEnd(Number(width)) : s.padStart(Number(width), '0');
        } else if (type === 'f') {
            const dec = prec ? Number(prec.slice(1)) : undefined;
            s = Number(val).toFixed(dec != null ? dec : 6);
        } else {
            s = String(val);
            if (width) s = minus ? s.padEnd(Number(width)) : s.padStart(Number(width));
        }
        return s;
    });
}

// ── Color3 / Vector3 ───────────────────────────────────────────────────────────
function Color3(r, g, b) {
    if (r === undefined) return { r: 0, g: 0, b: 0 };
    if (typeof r === 'number' && g === undefined) return { r: r, g: r, b: r };
    return { r: r, g: g, b: b };
}
Color3.new = (r, g, b) => ({ r: r ?? 0, g: g ?? 0, b: b ?? 0 });
Color3.fromRGB = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 });
Color3.fromHSV = (h, s, v) => {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r=v; g=t; b=p; break; case 1: r=q; g=v; b=p; break;
        case 2: r=p; g=v; b=t; break; case 3: r=p; g=q; b=v; break;
        case 4: r=t; g=p; b=v; break; case 5: r=v; g=p; b=q; break;
    }
    return { r, g, b };
};

function Vector3(x, y, z) { return { x: x ?? 0, y: y ?? 0, z: z ?? 0 }; }
Vector3.new = (x, y, z) => ({ x: x ?? 0, y: y ?? 0, z: z ?? 0 });

// ── UDim2 / UDim (Roblox-style, accepted but simplified) ─────────────────────
function UDim2(sx, ox, sy, oy) { return { ScaleX: sx ?? 0, OffsetX: ox ?? 0, ScaleY: sy ?? 0, OffsetY: oy ?? 0 }; }
UDim2.new = UDim2;
function UDim(s, o) { return { Scale: s ?? 0, Offset: o ?? 0 }; }
UDim.new = UDim;

// ── Lua type helper ───────────────────────────────────────────────────────────
function _luaType(v) {
    if (v === null) return 'nil';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'function') return 'function';
    if (Array.isArray(v)) return 'table';
    if (typeof v === 'object') return 'table';
    return 'userdata';
}

// ── Math extras ───────────────────────────────────────────────────────────────
const LuaMath = {
    ...Math,
    clamp: (v, min, max) => Math.min(Math.max(v, min), max),
    random: (...args) => {
        if (args.length === 0) return Math.random();
        if (args.length === 1) return Math.floor(Math.random() * args[0]) + 1;
        const [m, n] = args;
        return Math.floor(Math.random() * (n - m + 1)) + m;
    },
    huge: Infinity,
    pi: Math.PI,
    max: Math.max,
    min: Math.min,
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    sqrt: Math.sqrt,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    log: Math.log,
    exp: Math.exp,
    pow: (a, b) => Math.pow(a, b),
    fmod: (a, b) => a % b,
    modf: (a) => [Math.trunc(a), a % 1],
};

// ── String extras ─────────────────────────────────────────────────────────────
const LuaString = {
    format: sprintf,
    sub: (s, start, last) => {
        s = String(s);
        const len = s.length;
        const i = start < 0 ? Math.max(0, len + start) : Math.max(0, start - 1);
        const j = last === undefined ? len : (last < 0 ? len + last + 1 : last);
        return s.slice(i, j);
    },
    lower: (s) => String(s).toLowerCase(),
    upper: (s) => String(s).toUpperCase(),
    len: (s) => String(s).length,
    rep: (s, n, sep) => Array(n).fill(s).join(sep ?? ''),
    reverse: (s) => String(s).split('').reverse().join(''),
    byte: (s, i, j) => {
        s = String(s); i = (i ?? 1) - 1; j = j ?? i + 1;
        const codes = [];
        for (let k = i; k < j; k++) codes.push(s.charCodeAt(k));
        return codes.length === 1 ? codes[0] : codes;
    },
    char: (...codes) => codes.map(c => String.fromCharCode(c)).join(''),
    find: (s, pat, init) => {
        s = String(s); init = init ? init - 1 : 0;
        const sub = s.indexOf(pat, init);
        if (sub === -1) return null;
        return [sub + 1, sub + pat.length];
    },
    gmatch: (s, pat) => {
        // Very simplified: only handles plain patterns as substrings
        const re = new RegExp(pat.replace(/%a/g, '[a-zA-Z]').replace(/%d/g, '\\d').replace(/%w/g, '\\w').replace(/%s/g, '\\s'), 'g');
        return () => { const m = re.exec(s); return m ? m[0] : null; };
    },
    gsub: (s, pat, repl, n) => {
        const re = new RegExp(pat.replace(/%a/g, '[a-zA-Z]').replace(/%d/g, '\\d').replace(/%w/g, '\\w').replace(/%s/g, '\\s'), 'g');
        let count = 0;
        const result = s.replace(re, (m) => {
            if (n !== undefined && count >= n) return m;
            count++;
            return typeof repl === 'function' ? repl(m) : typeof repl === 'string' ? repl : m;
        });
        return [result, count];
    },
    match: (s, pat) => {
        const re = new RegExp(pat.replace(/%a/g, '[a-zA-Z]').replace(/%d/g, '\\d').replace(/%w/g, '\\w').replace(/%s/g, '\\s'));
        const m = String(s).match(re);
        return m ? (m.length > 1 ? m.slice(1) : m[0]) : null;
    },
};

// ── Table extras ──────────────────────────────────────────────────────────────
const _toArray = (t) => { if (!t) return []; if (Array.isArray(t)) return t; const a = Object.values(t); Object.keys(t).forEach((k, i) => { delete t[k]; t[i] = a[i]; }); t.length = a.length; Object.setPrototypeOf(t, Array.prototype); return t; };
const LuaTable = {
    insert: (t, pos, val) => {
        t = _toArray(t);
        if (val === undefined) { t.push(pos); }
        else { t.splice(pos - 1, 0, val); }
    },
    remove: (t, i) => { t = _toArray(t); return t.splice(i != null ? i - 1 : t.length - 1, 1)[0]; },
    sort: (t, cmp) => { t = _toArray(t); if (cmp) t.sort(cmp); else t.sort((a, b) => a < b ? -1 : a > b ? 1 : 0); },
    concat: (t, sep, i, j) => {
        t = _toArray(t);
        sep = sep ?? '';
        i = (i ?? 1) - 1;
        j = j ?? t.length;
        return t.slice(i, j).join(sep);
    },
    unpack: (t, i, j) => {
        t = _toArray(t);
        i = i ?? 1;
        j = j ?? t.length;
        const result = [];
        for (let n = i; n <= j; n++) result.push(t[n]);
        return result;
    },
};

// ── Script context factory ────────────────────────────────────────────────────
export function createScriptContext(api) {
    const _guiScreens = [];
    const _eventHandlers = {};
    const _keyState = {};

    // Track key state globally if not already set up
    if (typeof window !== 'undefined' && !window._bloxverseKeyHandlerSet) {
        window._bloxverseKeyHandlerSet = true;
        window.addEventListener('keydown', e => { window._bloxverseKeys = window._bloxverseKeys || {}; window._bloxverseKeys[e.code] = true; });
        window.addEventListener('keyup', e => { if (window._bloxverseKeys) window._bloxverseKeys[e.code] = false; });
    }

    const gameApi = {
        // Players
        GetPlayers: () => (api.game?.GetPlayers ? api.game.GetPlayers() : []),
        FindPlayer: (id) => (api.game?.FindPlayer ? api.game.FindPlayer(id) : null),
        GetGameTime: () => (api.game?.GetGameTime ? api.game.GetGameTime() : (Date.now() / 1000)),
        GetProperty: (key) => api.game?.GetProperty ? api.game.GetProperty(key) : (api.game?._props?.[key] ?? null),
        SetProperty: (key, value) => {
            if (api.game?.SetProperty) api.game.SetProperty(key, value);
            else { if (!api.game._props) api.game._props = {}; api.game._props[key] = value; }
        },
        Broadcast: (msg) => {
            if (api.game?.Broadcast) api.game.Broadcast(msg);
            if (api.onOutput) api.onOutput('[Broadcast] ' + msg, 'info');
        },
        Fire: (eventName, ...args) => {
            if (api.game?.Fire) { api.game.Fire(eventName, ...args); return; }
            const handlers = _eventHandlers[eventName] || [];
            handlers.forEach(fn => fn(...args));
        },
        On: (eventName, fn) => {
            if (api.game?.On) { api.game.On(eventName, fn); return; }
            if (!_eventHandlers[eventName]) _eventHandlers[eventName] = [];
            _eventHandlers[eventName].push(fn);
        },
        // Key input
        IsKeyDown: (code) => {
            if (api.game?.IsKeyDown) return api.game.IsKeyDown(code);
            return !!(window._bloxverseKeys?.[code]);
        },
        GetCameraYaw: () => {
            if (api.game?.GetCameraYaw) return api.game.GetCameraYaw();
            return window._bloxverse?.getCameraYaw?.() ?? 0;
        },
        SetWalkSpeed: (speed) => { if (api.game?.SetWalkSpeed) api.game.SetWalkSpeed(speed); },
        GetWalkSpeed: () => api.game?.GetWalkSpeed ? api.game.GetWalkSpeed() : 16,
        // Parts
        GetPart: (name) => {
            if (api.game?.GetPart) return api.game.GetPart(name);
            return null;
        },
        GetAllParts: () => api.game?.GetAllParts ? api.game.GetAllParts() : [],
        RemovePart: (name) => { if (api.game?.RemovePart) api.game.RemovePart(name); },
        // GUI (imperative API)
        CreateScreenGui: (name) => {
            if (api.game?.CreateScreenGui) return api.game.CreateScreenGui(name);
            const g = createScreenGuiContainer(name);
            _guiScreens.push(g);
            return g;
        },
        CleanupGui: () => {
            if (api.game?.CleanupGui) { api.game.CleanupGui(); return; }
            _guiScreens.forEach(g => g.Destroy());
            _guiScreens.length = 0;
            // Also clean up any leftover screen guis
            document.querySelectorAll('[data-screen-gui]').forEach(el => el.remove());
        },
        // Emotes
        PlayEmote: (id) => { return window._bloxverse?.playEmote?.(id) ?? false; },
        StopEmote: () => { window._bloxverse?.stopEmote?.(); },
    };

    // Merge game proxy with gameApi so scripts can call game:CreateScreenGui() etc.
    // We wrap the original game in a proxy that falls back to gameApi
    function makeGameProxy(gameObj) {
        return new Proxy(gameObj || {}, {
            get(target, prop) {
                // Method call style (game:Foo() → game.Foo())
                if (prop in gameApi) {
                    const fn = gameApi[prop];
                    if (typeof fn === 'function') return fn;
                }
                if (prop in target) {
                    const val = target[prop];
                    return typeof val === 'function' ? val.bind(target) : val;
                }
                // Child instance lookup
                if (target.Children) {
                    const child = target.Children.find(c => c.Name === prop);
                    if (child) return createInstanceProxy(child);
                }
                // Well-known service names
                if (prop === 'Workspace' || prop === 'workspace') {
                    return createInstanceProxy(target.Workspace || target.Children?.find(c => c.Name === 'Workspace'));
                }
                if (prop === 'StarterGui') {
                    return createInstanceProxy(target.StarterGui || target.Children?.find(c => c.Name === 'StarterGui'));
                }
                if (prop === 'Lighting') {
                    return createInstanceProxy(target.Lighting || target.Children?.find(c => c.Name === 'Lighting'));
                }
                if (prop === 'ReplicatedStorage') {
                    return createInstanceProxy(target.ReplicatedStorage || target.Children?.find(c => c.Name === 'ReplicatedStorage'));
                }
                if (prop === 'Players') {
                    return createInstanceProxy(target.Players || target.Children?.find(c => c.Name === 'Players'));
                }
                return undefined;
            }
        });
    }

    const ctx = {
        print: (...args) => {
            const msg = args.map(String).join('\t');
            console.log('[Script]', msg);
            if (api.onOutput) api.onOutput(msg, 'info');
        },
        warn: (...args) => {
            const msg = args.map(String).join('\t');
            console.warn('[Script]', msg);
            if (api.onOutput) api.onOutput(msg, 'warn');
        },
        error: (msg, level) => {
            console.error('[Script]', msg);
            if (api.onOutput) api.onOutput(String(msg), 'error');
            throw new Error(msg);
        },
        assert: (v, msg) => { if (!v) throw new Error(msg ?? 'assertion failed'); return v; },
        wait: (seconds) => new Promise((resolve, reject) => {
            if (api.signal?.aborted) { resolve(); return; }
            const timer = setTimeout(resolve, (seconds || 0) * 1000);
            api.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('Script stopped'));
            }, { once: true });
        }),
        spawn: (fn) => {
            if (api.signal?.aborted) return;
            const timer = setTimeout(() => {
                if (api.signal?.aborted) return;
                try { fn(); } catch(e) { console.error('[Script spawn]', e); }
            }, 0);
            api.signal?.addEventListener('abort', () => clearTimeout(timer), { once: true });
        },
        delay: (seconds, fn) => {
            if (api.signal?.aborted) return;
            const timer = setTimeout(() => {
                if (api.signal?.aborted) return;
                try { fn(); } catch(e) { console.error('[Script delay]', e); }
            }, (seconds || 0) * 1000);
            api.signal?.addEventListener('abort', () => clearTimeout(timer), { once: true });
        },
        pcall: (fn, ...args) => {
            try { return [true, fn(...args)]; } catch (e) { return [false, String(e?.message ?? e)]; }
        },
        xpcall: (fn, handler, ...args) => {
            try { return [true, fn(...args)]; } catch (e) { return [false, handler(e)]; }
        },
        ipairs: (t) => {
            let i = 0;
            return () => { if (i < t.length) { const v = [i + 1, t[i]]; i++; return v; } return null; };
        },
        pairs: (t) => {
            const keys = Object.keys(t);
            let i = 0;
            return () => { if (i < keys.length) { const k = keys[i++]; return [k, t[k]]; } return null; };
        },
        unpack: (t, i, j) => { i = (i ?? 1) - 1; j = j ?? t.length; return t.slice(i, j); },
        select: (index, ...args) => {
            if (index === '#') return args.length;
            return args.slice(index - 1);
        },
        rawget: (t, k) => t[k],
        rawset: (t, k, v) => { t[k] = v; return t; },
        rawequal: (a, b) => a === b,
        setmetatable: createMetatable,
        getmetatable: (t) => t?.__mt ?? null,
        next: (t, k) => {
            const keys = Object.keys(t);
            if (k === null || k === undefined) return keys.length ? [keys[0], t[keys[0]]] : null;
            const idx = keys.indexOf(String(k));
            if (idx === -1 || idx + 1 >= keys.length) return null;
            return [keys[idx + 1], t[keys[idx + 1]]];
        },
        string: LuaString,
        table: LuaTable,
        math: LuaMath,
        Math: LuaMath,
        game: makeGameProxy(api.game),
        workspace: createInstanceProxy(api.game?.Workspace || api.game?.Children?.find(c => c.Name === 'Workspace')),
        Instance: Instance,
        Color3: Color3,
        Vector3: Vector3,
        UDim2: UDim2,
        UDim: UDim,
        Signal: Signal,
        _luaType,
        exports: {}
    };
    ctx.Vector3.new = Vector3.new;
    ctx.Color3.new = Color3.new;
    ctx.Color3.fromRGB = Color3.fromRGB;
    ctx.Color3.fromHSV = Color3.fromHSV;

    // `require` stub — returns exports of a named script if available via api
    ctx.require = (name) => {
        if (api.require) return api.require(name);
        console.warn('[Script] require("' + name + '") not supported in this context');
        return {};
    };

    return ctx;
}

export function executeScript(code, api) {
    const ctx = createScriptContext(api);
    const isJS = api.isJS === true || (api.scriptInstance && api.scriptInstance.Name.endsWith('.js'));
    const jsCode = isJS ? code : luaToJS(code);

    const gameProxy = ctx.game;
    const scriptInstance = api.scriptInstance;
    const scriptProxy = createInstanceProxy(scriptInstance);

    // Wrap Instance.new so it returns proxied instances
    const proxiedInstance = {
    new(className, parent) {
        const inst = Instance.new(className);

        if (!inst) {
            console.error("Failed to create instance:", className);
            return null;
        }

        if (parent) {
            inst.setParent(parent?._target || parent);
        }

        return createInstanceProxy(inst);
    }
};

    const wrapped = `
        "use strict";
        (async () => {
            ${jsCode}
        })()
        .catch(e => { if (e.message !== 'Script stopped') { console.error('[Script Runtime] Async error:', e); if (typeof _onError === 'function') _onError(e); } });
    `;
    try {
        const fn = new Function(
            'exports', 'game', 'workspace', 'script',
            'Instance', 'Color3', 'Vector3', 'UDim2', 'UDim',
            'print', 'warn', 'error', 'assert',
            'wait', 'spawn', 'delay',
            'pcall', 'xpcall',
            'setmetatable', 'getmetatable', 'rawget', 'rawset', 'rawequal',
            'ipairs', 'pairs', 'unpack', 'select', 'next',
            'string', 'table', 'math',
            'tostring', 'tonumber', '_luaType', 'require',
            '_onError', 'character',
            wrapped
        );
        fn(
            ctx.exports, gameProxy, ctx.workspace, scriptProxy,
            proxiedInstance, ctx.Color3, ctx.Vector3, ctx.UDim2, ctx.UDim,
            ctx.print, ctx.warn, ctx.error, ctx.assert,
            ctx.wait, ctx.spawn, ctx.delay,
            ctx.pcall, ctx.xpcall,
            ctx.setmetatable, ctx.getmetatable, ctx.rawget, ctx.rawset, ctx.rawequal,
            ctx.ipairs, ctx.pairs, ctx.unpack, ctx.select, ctx.next,
            ctx.string, ctx.table, ctx.math,
            (v) => String(v ?? 'nil'), (v) => Number(v), _luaType, ctx.require,
            (e) => { if (api.onOutput) api.onOutput('Script error: ' + e.message, 'error'); },
            api.character || null
        );
        return ctx.exports;
    } catch (e) {
        console.error('[Script Runtime] Failed to create script:', e);
        if (api.onOutput) api.onOutput('Script error: ' + e.message, 'error');
        return {};
    }
}

export function loadScriptsFromStorage() {
    try {
        const stored = localStorage.getItem('bloxverse_scripts');
        if (stored) {
            const data = JSON.parse(stored);
            const scripts = {};
            for (const [name, code] of Object.entries(data)) {
                scripts[name] = { code };
            }
            return scripts;
        }
    } catch (e) {
        console.warn('Failed to load scripts from localStorage:', e);
    }
    return {};
}

export function saveScriptsToStorage(scripts) {
    try {
        const data = {};
        for (const [name, script] of Object.entries(scripts)) {
            data[name] = script.code;
        }
        localStorage.setItem('bloxverse_scripts', JSON.stringify(data));
    } catch (e) {
        console.warn('Failed to save scripts to localStorage:', e);
    }
}