import { Signal, Instance } from './instances.js';

export function luaToJS(lua) {
    // Use a reduce pipeline over an array of transform functions.
    // This prevents esbuild from collapsing the sequential assignments into a
    // single comma-expression `return t=t.replace(...), t=t.replace(...), t`
    // which causes variable-name collisions with minified Proxy handler params.
    const _transforms = [
        (_s) => _s.replace(/--\[\[[\s\S]*?\]\]/g, ''),
        (_s) => _s.replace(/--.*$/gm, ''),
        // `local a, b[, c...] = <expr>` (multiple names, one `=`) needs real
        // array destructuring, not JS's plain comma-declarator semantics -
        // `let a, b = expr;` in JS only assigns to `b` and leaves `a`
        // undefined, which silently breaks the extremely common
        // `local ok, err = pcall(...)` pattern (and coroutine.resume,
        // string.find, table.unpack, any user function returning multiple
        // values...). <expr> can itself span multiple lines (most pcall
        // calls wrap a multi-line `function() ... end`), so this scans
        // forward tracking paren/bracket/brace depth and quote state to
        // find the expression's true end rather than assuming one line.
        // Placed before any other transform so "end"/"then"/etc are still
        // plain keywords, not yet-unbalanced braces, while we count depth.
        (_s) => {
            const lines = _s.split('\n');
            const out = [];
            const headRe = /^(\s*)(local\s+)?(\w+(?:\s*,\s*\w+)+)\s*=(?!=)\s*(.*)$/;
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(headRe);
                if (!m) { out.push(lines[i]); continue; }
                const [, indent, isLocal, names, exprStart] = m;
                let depth = 0;
                let inStr = null;
                const scanLine = (line) => {
                    for (let j = 0; j < line.length; j++) {
                        const c = line[j];
                        if (inStr) {
                            if (c === '\\') { j++; continue; }
                            if (c === inStr) inStr = null;
                            continue;
                        }
                        if (c === '"' || c === "'") { inStr = c; continue; }
                        if (c === '(' || c === '[' || c === '{') depth++;
                        else if (c === ')' || c === ']' || c === '}') depth--;
                    }
                };
                scanLine(exprStart);
                const exprLines = [exprStart];
                let k = i;
                while (depth > 0 && k + 1 < lines.length) {
                    k++;
                    exprLines.push(lines[k]);
                    scanLine(lines[k]);
                }
                const fullExpr = exprLines.join('\n').trim();
                const nameList = names.split(',').map(n => n.trim());
                if (!fullExpr) { out.push(lines[i]); continue; }
                const decl = isLocal ? 'let ' : '';
                out.push(`${indent}${decl}[${nameList.join(', ')}] = _asMulti(${fullExpr});`);
                i = k;
            }
            return out.join('\n');
        },
        // `return a, b` (top-level comma in the return expression) needs to
        // become `return [a, b]` so the multi-assignment destructuring
        // transform above has an actual array to destructure - otherwise
        // JS's comma operator would silently collapse it to just `b`.
        // Scoped to a single line (Lua return statements aren't normally
        // split across lines in practice, matching this transpiler's
        // existing line-oriented conventions elsewhere).
        (_s) => {
            const lines = _s.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^(\s*)return\s+(.*)$/);
                if (!m) continue;
                const [, indent, rest] = m;
                const trimmedRest = rest.trim();
                if (!trimmedRest || trimmedRest === ';') continue;
                let depth = 0, inStr = null, hasTopComma = false;
                for (let j = 0; j < rest.length; j++) {
                    const c = rest[j];
                    if (inStr) {
                        if (c === '\\') { j++; continue; }
                        if (c === inStr) inStr = null;
                        continue;
                    }
                    if (c === '"' || c === "'") { inStr = c; continue; }
                    if (c === '(' || c === '[' || c === '{') depth++;
                    else if (c === ')' || c === ']' || c === '}') depth--;
                    else if (c === ',' && depth === 0) hasTopComma = true;
                }
                if (hasTopComma) {
                    lines[i] = `${indent}return [${trimmedRest.replace(/;$/, '')}];`;
                }
            }
            return lines.join('\n');
        },
        // Convert Lua table constructors to JS syntax. At this point in the
        // pipeline nothing but genuine `{ ... }` table literals use braces
        // yet (Lua blocks still use then/do/end, not braces), so it's safe
        // to transform every non-nested `{...}` span found. Dict-style
        // tables `{a = 1, b = 2}` become object literals `{a: 1, b: 2}`;
        // plain value lists `{1, 2, 3}` become array literals `[1, 2, 3]`.
        // Run multiple passes to resolve nested tables (each pass can only
        // convert the innermost `{}` it finds, since `[^{}]*` can't span
        // into a nested brace - a later pass then sees the now-bracketed
        // inner value and can convert the outer one).
        //
        // NOTE: the previous two-step version of this used
        // `_s.replace(/(,\s*)(\w+)\s*=\s*/g, '$1$2: ')` to catch a table's
        // 2nd+ key=value pairs, with NO requirement that it be inside a
        // `{...}` at all - it matched ", word =" ANYWHERE in the source,
        // which silently corrupted ordinary multi-assignment statements
        // like `local ok, err = pcall(...)` into `local ok, err: pcall(...)`
        // (invalid JS). Scoping the match to text actually captured from
        // inside a brace pair (as done here) fixes that.
        (_s) => {
            const convertOnce = (s) => s.replace(/\{([^{}]*)\}/g, (m, inner) => {
                if (/^\s*$/.test(inner)) return '[]';
                // Also recognize an ALREADY-converted `key: value` shape (from
                // a previous pass over a nested table) so re-scanning it here
                // doesn't misclassify it as a plain array once its `=` signs
                // are already gone - without this, a 2nd pass would find no
                // `=` left, decide it must be an array, and wrap an already-
                // correct `{a: 1, b: 2}` object literal in `[...]` instead.
                let isDict = /(^|,)\s*(\[[^\]]+\]|\w+)\s*:\s*/.test(inner);
                const asDict = inner.replace(/(^|,)(\s*)(\[[^\]]+\]|\w+)(\s*)=(?!=)\s*/g, (mm, sep, ws1, key, ws2) => {
                    isDict = true;
                    const k = key.startsWith('[') ? key.slice(1, -1) : key;
                    return `${sep}${ws1}${k}: `;
                });
                return isDict ? `{${asDict}}` : `[${inner}]`;
            });
            let out = _s;
            for (let i = 0; i < 6; i++) out = convertOnce(out);
            return out;
        },
        // An outer table can still contain braces after the inner table was
        // converted, so the innermost-only pass cannot see its first key.
        // Restrict this follow-up to keys immediately after `{` to avoid
        // rewriting ordinary assignments elsewhere in the script.
        (_s) => _s.replace(/(\{\s*)(\w+)\s*=(?!=)/g, '$1$2: '),
        (_s) => _s.replace(/\blocal\s+function\s+(\w+)\s*\(/g, 'let $1 = async function('),
        (_s) => {
            // Auto-await calls to (a) locally-declared async functions, and
            // (b) the function returned by loadstring(...) (always its FIRST
            // destructured name, matching Lua's `local fn, err = loadstring(...)`
            // convention) - both are inherently async under the hood (every
            // Lua function body, including a loadstring'd chunk, compiles to
            // an async function), so calling them without awaiting would
            // hand back a pending Promise instead of the actual result.
            const localNames = [..._s.matchAll(/\blet\s+(\w+)\s*=\s*async\s+function\s*\(/g)].map(m => m[1]);
            const loadstringNames = [..._s.matchAll(/\[\s*(\w+)\s*(?:,[^\]]*)?\]\s*=\s*_asMulti\(\s*loadstring\s*\(/g)].map(m => m[1]);
            for (const name of [...localNames, ...loadstringNames]) {
                const callRe = new RegExp(`(?<![\\w.$])${name}\\s*\\(`, 'g');
                _s = _s.replace(callRe, (match, offset, full) => {
                    const before = full.slice(Math.max(0, offset - 6), offset);
                    return /await\s+$/.test(before) ? match : `await ${match}`;
                });
            }
            return _s;
        },
        (_s) => _s.replace(/\bfunction\s+(\w+)\s*\(/g, 'exports.$1 = async function('),
        (_s) => _s.replace(/(?<!\basync\s)\bfunction\s*\(/g, 'async function('),
        // Convert every remaining bare `end` keyword to `}`, regardless of
        // where it appears on its line. This used to only match `end` at
        // the very start of a line (`/^(\s*)end\b/gm`), which silently
        // failed to close blocks written inline - and inline single-line
        // bodies are extremely common Lua/Roblox style:
        //   pcall(function() ... end)
        //   setmetatable(t, {__index = function() ... end})
        //   t("name", function() ... end)
        // All the block *openers* (function(...), then, do) already convert
        // to `{` unconditionally regardless of line position (see below/
        // above), so `end` needs the same treatment to stay paired with
        // them. Scans character-by-character (rather than a global regex)
        // so a string literal that happens to contain the word "end" isn't
        // corrupted.
        (_s) => {
            let out = '';
            let inStr = null;
            for (let i = 0; i < _s.length; i++) {
                const c = _s[i];
                if (inStr) {
                    out += c;
                    if (c === '\\') { i++; if (i < _s.length) out += _s[i]; continue; }
                    if (c === inStr) inStr = null;
                    continue;
                }
                if (c === '"' || c === "'") { inStr = c; out += c; continue; }
                if (_s[i] === 'e' && _s[i + 1] === 'n' && _s[i + 2] === 'd') {
                    const prevChar = i > 0 ? _s[i - 1] : '';
                    const nextChar = _s[i + 3] || '';
                    if (!/\w/.test(prevChar) && !/\w/.test(nextChar)) {
                        out += '}';
                        i += 2;
                        continue;
                    }
                }
                out += c;
            }
            return out;
        },
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
        (_s) => _s.replace(/([\)\]])\s*:\s*([\w]+)\s*\(/g, '$1.$2('),
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
            const _pv  = new RegExp('for\\s+_\\s+in\\s+pairs\\s*\\(' + _np.source + '\\)\\s+do', 'g');
            _s = _s.replace(_iv,  (_m, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}];`; });
            _s = _s.replace(_ikv, (_m, _k, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}]; let ${_k}=_ip${_i}+1;`; });
            _s = _s.replace(_ik,  (_m, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}];`; });
            _s = _s.replace(_pkv, (_m, _k, _v, _e) => { const _i = _forIdx++; return `for (let _pk${_i} in ${_e}) { let ${_v}=(${_e})[_pk${_i}]; let ${_k}=_pk${_i};`; });
            _s = _s.replace(_pv, (_m, _e) => { const _i = _forIdx++; return `for (let _pk${_i} in ${_e}) {`; });
            // Bare `for k, v in someTable do` (no pairs()/ipairs() wrapper) -
            // not actually valid Lua/Luau (you're supposed to always wrap
            // with pairs/ipairs), but it's common enough as a mistake/
            // shorthand that scripts are written expecting it to "just
            // work". Treated the same as ipairs (1-based, array-style)
            // since that matches the overwhelming majority of real usage
            // (iterating a list of children/instances). Must run AFTER the
            // explicit ipairs()/pairs() patterns above, since by this point
            // any wrapped occurrence has already been consumed and no
            // longer matches "for ... in ... do" at all - so anything still
            // matching here is genuinely bare.
            const _ivBare  = new RegExp('for\\s+_,\\s*(\\w+)\\s+in\\s+' + _np.source + '\\s+do', 'g');
            const _ikvBare = new RegExp('for\\s+(\\w+)\\s*,\\s*(\\w+)\\s+in\\s+' + _np.source + '\\s+do', 'g');
            const _ikBare  = new RegExp('for\\s+(\\w+)\\s+in\\s+' + _np.source + '\\s+do', 'g');
            _s = _s.replace(_ivBare,  (_m, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}];`; });
            _s = _s.replace(_ikvBare, (_m, _k, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}]; let ${_k}=_ip${_i}+1;`; });
            _s = _s.replace(_ikBare,  (_m, _v, _e) => { const _i = _forIdx++; return `for (let _ip${_i}=0; _ip${_i}<(${_e}).length; _ip${_i}++) { let ${_v}=(${_e})[_ip${_i}];`; });
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
        // One-line loops may end as `do break end`; without this conversion,
        // JavaScript reads `end` as a label after the break statement.
        (_s) => _s.replace(/\b(break|continue)\s+end\b/g, '$1; }'),
        // Inline callbacks commonly close before a delimiter, e.g.
        // `pcall(function() end)` or `xpcall(function() error() end, ...)`.
        (_s) => _s.replace(/\bend\b(?=\s*[,\)\]])/g, '}'),
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
        // `#` applied to a parenthesized expression, e.g. `#(a or b)` or
        // `#({1,2,3})` - the identifier-only rule above doesn't match this
        // shape at all. Supports one level of nesting inside the parens,
        // which covers realistic cases without needing a real parser.
        (_s) => _s.replace(/(?<!['"\w])#(\([^()]*(?:\([^()]*\)[^()]*)*\))/g, '$1.length'),
        // Convert top-level return { k = v } to Object.assign(exports, {k: v})
        // local functions become exports.fn (not bare names), so fall back to exports.fn
        (_s) => _s.replace(/^return\s*\{([^}]*)\}\s*;?\s*$/m, (_match, _inner) =>
            'Object.assign(exports, {' + _inner.replace(/(\w+)\s*:\s*([a-zA-Z_]\w*)/g, (_m, _k, _v) =>
                `${_k}: (typeof ${_v} !== 'undefined' ? ${_v} : exports.${_v})`
            ) + '});'
        ),
        (_s) => _s.replace(/\bmath\./g, 'Math.'),
        // NOTE: negative lookbehind excludes `task.wait(`/`something.wait(` -
        // without it, `task.wait(1)` becomes the invalid `task.await wait(1)`
        // since \b alone doesn't care what's before the boundary. task.wait
        // gets its own explicit rule below, same pattern as the game.* calls.
        (_s) => _s.replace(/(?<!\.)\bwait\s*\(/g, 'await wait('),
        (_s) => _s.replace(/\btask\.wait\s*\(/g, 'await task.wait('),
        // pcall/xpcall/coroutine.yield all need to be awaited: the callback
        // passed to pcall/xpcall is itself an async function (every Lua
        // function is transpiled to one), so pcall must `await` it to
        // actually observe a thrown error via try/catch instead of getting
        // back an immediately-resolved array plus a separate, unobserved
        // promise rejection. coroutine.yield genuinely returns a promise
        // that resolves once resume() is next called.
        (_s) => _s.replace(/\bpcall\s*\(/g, 'await pcall('),
        (_s) => _s.replace(/\bxpcall\s*\(/g, 'await xpcall('),
        (_s) => _s.replace(/\bcoroutine\.yield\s*\(/g, 'await coroutine.yield('),
        (_s) => _s.replace(/\bcoroutine\.resume\s*\(/g, 'await coroutine.resume('),
        // RemoteFunction/BindableFunction Invoke calls are async (the
        // handler on the other side is virtually always an async Lua
        // function), so the return value needs awaiting the same way
        // pcall/xpcall/coroutine calls above do. Captures the full dotted
        // receiver chain (game.ReplicatedStorage.MyFunc:InvokeServer(...))
        // so `await` lands at the start of the whole expression, not
        // wedged in front of just the last segment.
        (_s) => _s.replace(/(?<![\w).\]])((?:\w+\.)*\w+)\.(InvokeServer|InvokeClient|Invoke)\s*\(/g, (m, obj, method) => `await ${obj}.${method}(`),
        (_s) => _s.replace(/\btostring\s*\(/g, 'String('),
        (_s) => _s.replace(/\btonumber\s*\(/g, 'Number('),
        (_s) => _s.replace(/\btype\s*\(/g, '_luaType('),
        (_s) => _s.replace(/\btypeof\s*\(/g, '_luaTypeOf('),
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
        // Datatype arithmetic dispatch: real Luau scripts regularly write
        // `pos + Vector3.new(...)`, `cf:GetPivot() + Vector3.new(...)`,
        // `Vector3.new(...) * 2`, etc., but JS `+`/`*` on objects just
        // stringifies them. Rewrite the common binary forms into _bvMath(...)
        // (exposed as a global so the transpiled code can call it), which
        // does real Vector3/CFrame-compatible math and falls back to the
        // native operator for ordinary numbers/strings. `Vector3.new(` and
        // `.Position`/`.CFrame` are strong "datatype" signals, so these
        // rewrites can't collide with plain numeric arithmetic.
        (_s) => _s.replace(
            /([a-zA-Z_$][\w$]*(?:\s*\.\s*[\w$]+(?:\s*\([^()]*\))?)*)\s*([+\-])\s*Vector3\.new\s*\(([^()]*)\)/g,
            (m, a, op, args) => `_bvMath('${op}', ${a}, Vector3.new(${args}))`
        ),
        (_s) => _s.replace(
            /Vector3\.new\s*\(([^()]*)\)\s*([+\-])\s*([a-zA-Z_$][\w$]*(?:\s*\.\s*[\w$]+(?:\s*\([^()]*\))?)*)/g,
            (m, args, op, b) => `_bvMath('${op}', Vector3.new(${args}), ${b})`
        ),
        (_s) => _s.replace(
            /((?:Vector3\.new\s*\([^()]*\)|[a-zA-Z_$][\w$]*\.(?:Position|CFrame|Pivot|p|Size)))\s*([*\/])\s*(\d+(?:\.\d+)?)/g,
            (m, a, op, n) => `_bvMath('${op}', ${a}, ${n})`
        ),
        (_s) => _s.replace(
            /(\d+(?:\.\d+)?)\s*\*\s*(Vector3\.new\s*\([^()]*\))/g,
            (m, n, b) => `_bvMath('*', ${b}, ${n})`
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
    if (v && typeof v === 'object' && !Array.isArray(v)) return new Vector3Class(v.x ?? v.X ?? 0, v.y ?? v.Y ?? 0, v.z ?? v.Z ?? 0);
    const arr = _v3ToArray(v);
    return new Vector3Class(arr[0], arr[1], arr[2]);
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
    // Stored (non-enumerably, so it doesn't show up in pairs()/Object.keys())
    // directly on the underlying object so getmetatable() can find it again -
    // the returned Proxy itself has no state of its own to keep it in.
    Object.defineProperty(obj, '__mt', { value: mt, writable: true, configurable: true, enumerable: false });
    return new Proxy(obj, {
        get(target, prop) {
            if (prop in target) return target[prop];
            const index = mt.__index;
            if (!index) return undefined;
            if (typeof index === 'function') return index(target, prop);
            if (typeof index === 'object') return index[prop];
            return undefined;
        },
        set(target, prop, value) {
            if (!(prop in target) && typeof mt.__newindex === 'function') {
                mt.__newindex(target, prop, value);
                return true;
            }
            if (!(prop in target) && typeof mt.__newindex === 'object' && mt.__newindex) {
                mt.__newindex[prop] = value;
                return true;
            }
            target[prop] = value;
            return true;
        },
    });
}

// ClassNames that need an actual THREE.js mesh to be visible. Roblox only
// renders things once they're parented (directly or indirectly) under
// Workspace - Instance.new() alone just creates the data-model object, the
// same way real Roblox does. The mesh itself has to be created by the host
// app (it owns THREE/the scene), so this only decides *when* to ask for one
// via `window._bloxverse.instantiateVisual(inst)` / `.removeVisual(inst)` -
// optional hooks the host page can implement; if it doesn't, instances still
// work as plain data (Position/Size/etc. are all still readable/writable),
// they just won't have a visual representation, matching the previous
// behavior exactly for hosts that haven't wired this up yet.
const _visualClassNames = new Set(['Part', 'MeshPart', 'SpawnLocation', 'WedgePart', 'TrussPart', 'CornerWedgePart', 'UnionOperation', 'NegateOperation']);
function _isDescendantOfWorkspace(inst) {
    let cur = inst;
    let depth = 0;
    while (cur && depth < 200) {
        if (cur.ClassName === 'Workspace') return true;
        cur = cur.Parent;
        depth++;
    }
    return false;
}
function _maybeInstantiateVisual(target) {
    if (!target.mesh && _visualClassNames.has(target.ClassName) && _isDescendantOfWorkspace(target)) {
        window._bloxverse?.instantiateVisual?.(target);
    }
}

// Tracks which player is "the active client" for the current script call, so
// RemoteEvent:FireServer()/RemoteFunction:InvokeServer() can pass it as the
// first argument to server-side handlers (matching real Roblox's
// `OnServerEvent:Connect(function(player, ...) end)` convention) without
// needing every call site to thread it through explicitly. Only meaningful
// while a client-side (LocalScript) call is actually executing.
let _activeClientPlayer = null;

export function createInstanceProxy(inst) {
    if (!inst) return null;
    if (!inst._attrs) inst._attrs = {};
    const isPart = inst.ClassName === 'Part';
    const isGui = inst.ClassName === 'TextLabel' || inst.ClassName === 'TextButton' || inst.ClassName === 'Frame' || inst.ClassName === 'ScreenGui' || inst.ClassName === 'SurfaceGui';
    const isRemote = inst.ClassName === 'RemoteEvent';
    const isRemoteFn = inst.ClassName === 'RemoteFunction';
    const isBindable = inst.ClassName === 'BindableEvent';
    const isBindableFn = inst.ClassName === 'BindableFunction';

    return new Proxy(inst, {
        get(target, prop) {
            if (prop === '_target') return target;
            if (prop === 'Parent') return createInstanceProxy(target.Parent);
            if (prop === 'Children') return (target.Children || []).map(c => createInstanceProxy(c));

            // RemoteEvent/RemoteFunction cross the server/client boundary;
            // BindableEvent/BindableFunction stay on one side but let
            // otherwise-unconnected scripts on that side talk to each
            // other. There's no real network here - both "sides" share the
            // same instance tree in this single-process sandbox, so this
            // just keeps a couple of Signals (created lazily) on the
            // instance itself and fires them directly.
            if (isRemote || isBindable) {
                if (prop === 'OnServerEvent') {
                    if (!target._serverSignal) target._serverSignal = new Signal();
                    return { Connect: (fn) => target._serverSignal.Connect(fn) };
                }
                if (prop === 'OnClientEvent' || prop === 'Event') {
                    if (!target._clientSignal) target._clientSignal = new Signal();
                    return { Connect: (fn) => target._clientSignal.Connect(fn) };
                }
                if (prop === 'FireServer') return (...args) => {
                    if (!target._serverSignal) target._serverSignal = new Signal();
                    target._serverSignal.Fire(createInstanceProxy(_activeClientPlayer), ...args);
                };
                if (prop === 'FireClient') return (player, ...args) => {
                    if (!target._clientSignal) target._clientSignal = new Signal();
                    target._clientSignal.Fire(...args);
                };
                if (prop === 'FireAllClients' || prop === 'Fire') return (...args) => {
                    if (!target._clientSignal) target._clientSignal = new Signal();
                    target._clientSignal.Fire(...args);
                };
            }
            if (isRemoteFn || isBindableFn) {
                if (prop === 'OnServerInvoke') return target.OnServerInvoke ?? null;
                if (prop === 'OnClientInvoke' || prop === 'OnInvoke') return target.OnClientInvoke ?? null;
                if (prop === 'InvokeServer') return async (...args) => target.OnServerInvoke ? await target.OnServerInvoke(createInstanceProxy(_activeClientPlayer), ...args) : undefined;
                if (prop === 'InvokeClient') return async (player, ...args) => target.OnClientInvoke ? await target.OnClientInvoke(...args) : undefined;
                if (prop === 'Invoke') return async (...args) => target.OnClientInvoke ? await target.OnClientInvoke(...args) : undefined;
            }

            if (isPart || target.ClassName === 'Player') {
                if (prop === 'Position') {
                    if (target.mesh) return _v3ToObj(target.mesh.position);
                    if (target._characterRef) return _v3ToObj(target._characterRef.position);
                    return _v3ToObj(target.Position);
                }
                if (prop === 'Size') return _v3ToObj(target.Size);
                if (prop === 'Color') {
                    if (target.Color && typeof target.Color === 'object' && 'r' in target.Color) return target.Color;
                    const mat = Array.isArray(target.mesh?.material) ? target.mesh.material[0] : target.mesh?.material;
                    if (mat?.color) return mat.color;
                    return { r: 163 / 255, g: 162 / 255, b: 165 / 255 };
                }
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
                if (prop === 'CFrame') {
                    const pos = target.mesh ? target.mesh.position : _v3ToObj(target.Position);
                    const rot = target.mesh ? target.mesh.rotation : { x: 0, y: 0, z: 0 };
                    return new CFrameClass(pos.x, pos.y, pos.z, rot.x, rot.y, rot.z);
                }
            }

            if (prop === 'Clone') {
                return () => {
                    let c = null;
                    if (typeof target.Clone === 'function') {
                        try { c = target.Clone(); } catch (e) { console.warn('[Script Runtime] Instance:Clone() threw:', e); c = null; }
                    }
                    if (!c) {
                        // Fallback: the underlying Instance class doesn't
                        // provide (or failed) its own Clone() - do a plain
                        // data copy instead of returning nil, covering the
                        // common Part/data-only case.
                        try {
                            c = new Instance(target.ClassName);
                            c.Name = target.Name;
                            if (target._attrs) c._attrs = { ...target._attrs };
                            for (const k of ['Position', 'Size', 'Anchored', 'CanCollide', 'Transparency']) {
                                if (target[k] !== undefined) c[k] = Array.isArray(target[k]) ? [...target[k]] : target[k];
                            }
                        } catch (e) {
                            console.warn('[Script Runtime] Clone() is not supported on this instance:', e);
                            return null;
                        }
                    }
                    // A clone must get its OWN mesh, not share the
                    // original's (moving one would visually move both) -
                    // clear whatever the copy above may have carried over
                    // and unparent it. The Parent-set hook above then
                    // creates a fresh mesh once the clone is actually
                    // parented somewhere visible, exactly like a brand new
                    // Instance.new() part does.
                    c.mesh = null;
                    c.Parent = null;
                    return createInstanceProxy(c);
                };
            }

            // GUI Text property shortcut
            if (isGui && prop === 'Text') return target.Text ?? '';

            // Instance methods
            if (prop === 'Destroy') return () => {
                if (target.mesh) window._bloxverse?.removeVisual?.(target);
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
            if (prop === 'GetDescendants') {
                return () => (target.GetDescendants ? target.GetDescendants() : []).map(c => createInstanceProxy(c));
            }
            if (prop === 'FindFirstChildOfClass') {
                return (className) => {
                    const found = target.FindFirstChildOfClass?.(className);
                    return found ? createInstanceProxy(found) : null;
                };
            }
            if (prop === 'FindFirstChildWhichIsA') {
                return (className) => {
                    const found = target.FindFirstChildWhichIsA?.(className);
                    return found ? createInstanceProxy(found) : null;
                };
            }
            if (prop === 'Raycast') {
                return (...args) => target.Raycast?.(...args) ?? null;
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
                _maybeInstantiateVisual(target);
                return true;
            }
            if (prop === 'ClassName') return false;

            if ((isRemoteFn || isBindableFn) && (prop === 'OnServerInvoke' || prop === 'OnClientInvoke' || prop === 'OnInvoke')) {
                target[prop === 'OnInvoke' ? 'OnClientInvoke' : prop] = value;
                return true;
            }

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
                    // Defensive: a fresh Instance.new("Part") (or a host that
                    // hasn't linked inst.Color to the mesh's real material
                    // color yet) may not have a THREE.Color-like object here
                    // at all. Without this check, `target.Color.setRGB(...)`
                    // throws - and since this runs inside an async Lua
                    // function, an uncaught throw here silently aborts the
                    // rest of the *entire* script (not just this statement),
                    // which is exactly what made scripts that set .Color
                    // right after creating a Part appear to "stop working
                    // after one part" instead of erroring visibly.
                    if (!target.Color || typeof target.Color.setRGB !== 'function') {
                        const mat = Array.isArray(target.mesh?.material) ? target.mesh.material[0] : target.mesh?.material;
                        if (mat?.color) {
                            target.Color = mat.color;
                        } else {
                            target.Color = { r: 1, g: 1, b: 1, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; }, setHex(h) { this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; } };
                        }
                    }
                    if (typeof value === 'object' && value !== null && 'r' in value) {
                        target.Color.setRGB(value.r, value.g, value.b);
                    } else {
                        const hex = typeof value === 'number' ? value : parseInt(String(value).replace('#', ''), 16);
                        target.Color.setHex(hex);
                    }
                    target.setProperty?.('Color', target.Color);
                    return true;
                }
                if (prop === 'Anchored') {
                    target.Anchored = !!value;
                    if (target.mesh) {
                        if (!target.mesh.userData) target.mesh.userData = {};
                        target.mesh.userData.anchored = target.Anchored;
                    }
                    target.setProperty?.('Anchored', target.Anchored);
                    return true;
                }
                if (prop === 'Transparency') {
                    target.Transparency = Math.max(0, Math.min(1, Number(value)));
                    if (target.mesh && target.mesh.material) {
                        target.mesh.material.transparent = target.Transparency > 0;
                        target.mesh.material.opacity = 1 - target.Transparency;
                    }
                    target.setProperty?.('Transparency', target.Transparency);
                    return true;
                }
                if (prop === 'CFrame') {
                    const cf = value;
                    const arr = _v3ToArray(cf);
                    if (isPart) target.Position = arr;
                    if (target.mesh) {
                        target.mesh.position.set(arr[0], arr[1], arr[2]);
                        if (cf && (cf._rx !== undefined || cf._ry !== undefined || cf._rz !== undefined)) {
                            target.mesh.rotation.set(cf._rx || 0, cf._ry || 0, cf._rz || 0);
                        }
                        target.setProperty?.('px', arr[0]);
                        target.setProperty?.('py', arr[1]);
                        target.setProperty?.('pz', arr[2]);
                    }
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

// `_G` is shared across every script running on the same *side* in a
// session (matching real Roblox: server scripts share one `_G`, client
// scripts share a separate one - they're different Lua VMs entirely and
// never see each other's `_G`, same as they can't see each other's local
// variables). Keyed by api.side ('server'/'client'), defaulting to a single
// shared bucket for hosts that don't pass `side` at all, so nothing breaks
// for callers that haven't adopted the new server/client separation yet.
const _G_buckets = { server: {}, client: {}, shared: {} };
function _getGBucket(side) {
    return _G_buckets[side] || _G_buckets.shared;
}

// bit32 - Lua 5.2/Luau's bitwise-operations library. JS's bitwise operators
// already work on 32-bit ints, so these are thin wrappers; `>>> 0` coerces
// results to an unsigned 32-bit value to match bit32's return convention.
const LuaBit32 = {
    band: (...xs) => xs.reduce((a, b) => a & b) >>> 0,
    bor: (...xs) => xs.reduce((a, b) => a | b) >>> 0,
    bxor: (...xs) => xs.reduce((a, b) => a ^ b) >>> 0,
    bnot: (x) => (~x) >>> 0,
    lshift: (x, n) => (x << n) >>> 0,
    rshift: (x, n) => (x >>> n) >>> 0,
    arshift: (x, n) => (x >> n) >>> 0,
    lrotate: (x, n) => {
        n = ((n % 32) + 32) % 32;
        return ((x << n) | (x >>> (32 - n))) >>> 0;
    },
    rrotate: (x, n) => {
        n = ((n % 32) + 32) % 32;
        return ((x >>> n) | (x << (32 - n))) >>> 0;
    },
    extract: (x, field, width = 1) => (x >>> field) & ((1 << width) - 1),
    replace: (x, v, field, width = 1) => {
        const mask = ((1 << width) - 1) << field;
        return ((x & ~mask) | ((v << field) & mask)) >>> 0;
    },
    countlz: (x) => Math.clz32(x >>> 0),
    countrz: (x) => { x = x >>> 0; if (x === 0) return 32; let n = 0; while (!(x & 1)) { x >>>= 1; n++; } return n; },
};

// utf8 - Luau's UTF-8 library. JS strings are UTF-16, so this uses
// Array.from (which iterates by Unicode code point, not UTF-16 code unit)
// and codePointAt/fromCodePoint to get UTF-8-correct behavior for anything
// outside the Basic Multilingual Plane (e.g. emoji).
const LuaUtf8 = {
    char: (...codes) => String.fromCodePoint(...codes),
    codepoint: (s, i, j) => {
        const chars = Array.from(String(s));
        i = (i ?? 1) - 1;
        j = (j ?? (i + 1)) - 1;
        const out = [];
        for (let k = i; k <= j && k < chars.length; k++) out.push(chars[k].codePointAt(0));
        return out;
    },
    len: (s, i, j) => {
        const chars = Array.from(String(s));
        i = (i ?? 1) - 1;
        j = j === undefined ? chars.length : (j < 0 ? chars.length + j + 1 : j);
        return Math.max(0, j - i);
    },
    offset: (s, n, i) => {
        const chars = Array.from(String(s));
        let start = i !== undefined ? (i > 0 ? i - 1 : chars.length + i + 1) : (n >= 0 ? 0 : chars.length);
        let idx = start;
        let remaining = n >= 0 ? n : -n;
        const step = n >= 0 ? 1 : -1;
        if (n === 0) return idx + 1;
        while (remaining > 0 && idx >= 0 && idx <= chars.length) { idx += step; remaining--; }
        return idx + 1;
    },
    codes: (s) => {
        const chars = Array.from(String(s));
        let i = 0;
        let byteOffset = 1;
        return () => {
            if (i >= chars.length) return null;
            const result = [byteOffset, chars[i].codePointAt(0)];
            byteOffset += chars[i].length;
            i++;
            return result;
        };
    },
    charpattern: '[\0-\x7F\xC2-\xFD][\x80-\xBF]*',
};

// os - a small, non-file-system subset (time/date/clock/difftime) since
// there's no real filesystem or process to back the rest of Lua's os library
// in a browser sandbox.
const LuaOs = {
    time: (t) => t ? Math.floor(new Date(t.year ?? 1970, (t.month ?? 1) - 1, t.day ?? 1, t.hour ?? 0, t.min ?? 0, t.sec ?? 0).getTime() / 1000) : Math.floor(Date.now() / 1000),
    clock: () => Date.now() / 1000,
    difftime: (t2, t1) => t2 - t1,
    date: (fmt, t) => {
        fmt = fmt ?? '%c';
        const d = t !== undefined ? new Date(t * 1000) : new Date();
        const utc = fmt.startsWith('!');
        if (utc) fmt = fmt.slice(1);
        const pick = (utcVal, localVal) => (utc ? utcVal : localVal);
        if (fmt === '*t' || fmt === '!*t') {
            return {
                year: pick(d.getUTCFullYear(), d.getFullYear()),
                month: pick(d.getUTCMonth(), d.getMonth()) + 1,
                day: pick(d.getUTCDate(), d.getDate()),
                hour: pick(d.getUTCHours(), d.getHours()),
                min: pick(d.getUTCMinutes(), d.getMinutes()),
                sec: pick(d.getUTCSeconds(), d.getSeconds()),
                wday: pick(d.getUTCDay(), d.getDay()) + 1,
                yday: Math.ceil((d - new Date(d.getFullYear(), 0, 0)) / 86400000),
                isdst: false,
            };
        }
        const pad = (n) => String(n).padStart(2, '0');
        const map = {
            Y: pick(d.getUTCFullYear(), d.getFullYear()),
            m: pad(pick(d.getUTCMonth(), d.getMonth()) + 1),
            d: pad(pick(d.getUTCDate(), d.getDate())),
            H: pad(pick(d.getUTCHours(), d.getHours())),
            M: pad(pick(d.getUTCMinutes(), d.getMinutes())),
            S: pad(pick(d.getUTCSeconds(), d.getSeconds())),
        };
        return fmt.replace(/%([YmdHMSc%])/g, (m2, c) => c === '%' ? '%' : (c === 'c' ? d.toString() : (map[c] ?? m2)));
    },
};

// ── Color3 / Vector3 ───────────────────────────────────────────────────────────
function Color3(r, g, b) {
    if (r === undefined) return { r: 0, g: 0, b: 0 };
    if (typeof r === 'number' && g === undefined) return { r: r, g: r, b: r };
    return { r: r, g: g, b: b };
}
function _color3Value(r, g, b) {
    return {
        r: r ?? 0, g: g ?? 0, b: b ?? 0,
        ToHSV() {
            const max = Math.max(this.r, this.g, this.b), min = Math.min(this.r, this.g, this.b);
            const d = max - min;
            let h = 0;
            if (d) {
                if (max === this.r) h = ((this.g - this.b) / d) % 6;
                else if (max === this.g) h = (this.b - this.r) / d + 2;
                else h = (this.r - this.g) / d + 4;
                h /= 6;
                if (h < 0) h += 1;
            }
            return [h, max ? d / max : 0, max];
        }
    };
}
Color3.new = (r, g, b) => _color3Value(r, g, b);
Color3.fromRGB = (r, g, b) => _color3Value(r / 255, g / 255, b / 255);
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
    return _color3Value(r, g, b);
};

function Vector2(x, y) { return { x: x ?? 0, y: y ?? 0, X: x ?? 0, Y: y ?? 0 }; }
Vector2.new = Vector2;
function Ray(origin, direction) { return { Origin: origin, Direction: direction }; }
Ray.new = Ray;
function Region3(min, max) { return { CFrame: CFrame.lookAt(min, max), Size: max.Sub(min) }; }
Region3.new = Region3;
function RaycastParams() { return { FilterType: null, FilterDescendantsInstances: [], IgnoreWater: false }; }
RaycastParams.new = RaycastParams;
function OverlapParams() { return { FilterType: null, FilterDescendantsInstances: [], MaxParts: 0 }; }
OverlapParams.new = OverlapParams;

// BrickColor - a small named-color palette (the full Roblox set has 100+
// entries; these are the common ones scripts actually reach for) plus
// numeric ids and BrickColor.random() so unrecognized/uncommon names still
// degrade to a real color instead of throwing.
const _brickColorPalette = {
    'White': [242, 243, 243], 'Grey': [163, 162, 165], 'Light grey': [200, 200, 200],
    'Black': [27, 42, 53], 'Really black': [17, 17, 17], 'Really red': [255, 0, 0],
    'Bright red': [196, 40, 28], 'Red': [196, 40, 28], 'Bright blue': [13, 105, 172],
    'Blue': [13, 105, 172], 'Really blue': [0, 0, 255], 'Bright green': [75, 151, 75],
    'Green': [75, 151, 75], 'Bright yellow': [245, 205, 48], 'Yellow': [245, 205, 48],
    'New Yeller': [255, 255, 0], 'Bright orange': [226, 149, 62], 'Orange': [226, 149, 62],
    'Bright violet': [107, 50, 124], 'Purple': [107, 50, 124], 'Hot pink': [255, 0, 191],
    'Pink': [255, 175, 202], 'Brown': [124, 92, 70], 'Lime green': [0, 255, 0],
    'Cyan': [0, 255, 255], 'Gold': [239, 184, 56], 'Silver': [172, 172, 172],
};
function _brickColorFromName(name) {
    const rgb = _brickColorPalette[name] || _brickColorPalette['Medium stone grey'] || [163, 162, 165];
    return { Name: name, Number: 1, Color: Color3.fromRGB(rgb[0], rgb[1], rgb[2]), r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 };
}
function BrickColor(v) {
    if (typeof v === 'string') return _brickColorFromName(v);
    if (typeof v === 'number') {
        const names = Object.keys(_brickColorPalette);
        return _brickColorFromName(names[v % names.length]);
    }
    return _brickColorFromName('Medium stone grey');
}
BrickColor.new = BrickColor;
BrickColor.random = () => {
    const names = Object.keys(_brickColorPalette);
    return _brickColorFromName(names[Math.floor(Math.random() * names.length)]);
};
BrickColor.White = () => _brickColorFromName('White');
BrickColor.Black = () => _brickColorFromName('Black');
BrickColor.Gray = () => _brickColorFromName('Grey');

// NumberRange / NumberSequence / ColorSequence - simple data-holders used
// mainly for ParticleEmitter-style properties. Keypoint arrays are accepted
// as-is (already plain {Time, Value, Envelope} / {Time, Value} objects).
function NumberRange(min, max) { return { Min: min, Max: max ?? min }; }
NumberRange.new = NumberRange;
function NumberSequence(a, b) {
    if (Array.isArray(a)) return { Keypoints: a };
    if (b !== undefined) return { Keypoints: [{ Time: 0, Value: a, Envelope: 0 }, { Time: 1, Value: b, Envelope: 0 }] };
    return { Keypoints: [{ Time: 0, Value: a, Envelope: 0 }, { Time: 1, Value: a, Envelope: 0 }] };
}
NumberSequence.new = NumberSequence;
NumberSequence.Keypoint = (time, value, envelope) => ({ Time: time, Value: value, Envelope: envelope ?? 0 });
function ColorSequence(a, b) {
    if (Array.isArray(a)) return { Keypoints: a };
    if (b !== undefined) return { Keypoints: [{ Time: 0, Value: a }, { Time: 1, Value: b }] };
    return { Keypoints: [{ Time: 0, Value: a }, { Time: 1, Value: a }] };
}
ColorSequence.new = ColorSequence;
ColorSequence.Keypoint = (time, value) => ({ Time: time, Value: value });

// PhysicalProperties - plain data, matches Roblox's constructor signature.
function PhysicalProperties(density, friction, elasticity, frictionWeight, elasticityWeight) {
    return {
        Density: density ?? 1, Friction: friction ?? 0.3, Elasticity: elasticity ?? 0.5,
        FrictionWeight: frictionWeight ?? 1, ElasticityWeight: elasticityWeight ?? 1,
    };
}
PhysicalProperties.new = PhysicalProperties;

// TweenInfo - plain data with Roblox's real defaults, consumed by
// TweenService (implemented elsewhere against the game/Instance layer).
function TweenInfo(time, easingStyle, easingDirection, repeatCount, reverses, delayTime) {
    return {
        Time: time ?? 1,
        EasingStyle: easingStyle ?? Enum.EasingStyle.Quad,
        EasingDirection: easingDirection ?? Enum.EasingDirection.Out,
        RepeatCount: repeatCount ?? 0,
        Reverses: reverses ?? false,
        DelayTime: delayTime ?? 0,
    };
}
TweenInfo.new = TweenInfo;

// Random - an actually-seedable PRNG (mulberry32), unlike math.random/
// math.randomseed which can't reseed JS's built-in Math.random.
function _mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function Random(seed) {
    const rng = _mulberry32(seed ?? Math.floor(Math.random() * 2 ** 31));
    return {
        NextNumber(min, max) {
            if (min === undefined) return rng();
            if (max === undefined) return rng() * min;
            return min + rng() * (max - min);
        },
        NextInteger(min, max) { return Math.floor(min + rng() * (max - min + 1)); },
        NextUnitVector() {
            const theta = rng() * Math.PI * 2;
            const z = rng() * 2 - 1;
            const r = Math.sqrt(1 - z * z);
            return new Vector3Class(r * Math.cos(theta), r * Math.sin(theta), z);
        },
        Clone() { return Random(Math.floor(rng() * 2 ** 31)); },
        Shuffle(t) {
            const a = Array.isArray(t) ? t.slice() : Object.values(t);
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        },
    };
}
Random.new = Random;

// DateTime - covers the common instance methods/statics scripts actually
// call (Format-string parsing for FromIsoDate/etc is intentionally not
// fully RFC3339-general, just the common cases).
function _makeDateTime(ms) {
    const d = new Date(ms);
    return {
        UnixTimestamp: Math.floor(ms / 1000),
        UnixTimestampMillis: ms,
        Date: d,
        ToIsoDate() { return d.toISOString(); },
        ToUniversalTime() {
            return {
                Year: d.getUTCFullYear(), Month: d.getUTCMonth() + 1, Day: d.getUTCDate(),
                Hour: d.getUTCHours(), Minute: d.getUTCMinutes(), Second: d.getUTCSeconds(),
                Millisecond: d.getUTCMilliseconds(),
            };
        },
        ToLocalTime() {
            return {
                Year: d.getFullYear(), Month: d.getMonth() + 1, Day: d.getDate(),
                Hour: d.getHours(), Minute: d.getMinutes(), Second: d.getSeconds(),
                Millisecond: d.getMilliseconds(),
            };
        },
        FormatUniversalTime(fmt) { return LuaOs.date('!' + (fmt || '%c'), ms / 1000); },
        FormatLocalTime(fmt) { return LuaOs.date(fmt || '%c', ms / 1000); },
    };
}
const DateTime = {
    now: () => _makeDateTime(Date.now()),
    fromUnixTimestamp: (t) => _makeDateTime(t * 1000),
    fromUnixTimestampMillis: (t) => _makeDateTime(t),
    fromIsoDate: (iso) => _makeDateTime(Date.parse(iso)),
    fromUniversalTime: (y, mo, d, h, mi, s, ms) => _makeDateTime(Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0, ms ?? 0)),
    fromLocalTime: (y, mo, d, h, mi, s, ms) => _makeDateTime(new Date(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0, ms ?? 0).getTime()),
};

// Vector3 is a real class (not a plain {x,y,z} object) so scripts get working
// Magnitude/Unit/Dot/Cross/Add/Sub/Multiply support. X/Y/Z aliases are made
// non-enumerable so pairs()/Object.keys() and anything that serializes a
// vector still only sees x/y/z, matching the old plain-object behavior.
// NOTE: native `+`/`-`/`*` operators between two Vector3 values are NOT
// supported - JavaScript can't overload those operators to return a new
// object (they always coerce to a number or string), and safely rewriting
// every `+`/`-`/`*` in transpiled source to dispatch at runtime would need a
// real expression parser, which this regex-based transpiler doesn't have.
// Scripts should use :Add()/:Sub()/:Multiply() (or the Lerp/Dot/Cross
// methods below) instead of raw arithmetic operators on Vector3 values.
class Vector3Class {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x; this.y = y; this.z = z;
        Object.defineProperties(this, {
            X: { value: x, enumerable: false },
            Y: { value: y, enumerable: false },
            Z: { value: z, enumerable: false },
        });
    }
    get Magnitude() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
    get Unit() {
        const m = this.Magnitude || 1;
        return new Vector3Class(this.x / m, this.y / m, this.z / m);
    }
    Dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z; }
    Cross(o) {
        return new Vector3Class(
            this.y * o.z - this.z * o.y,
            this.z * o.x - this.x * o.z,
            this.x * o.y - this.y * o.x
        );
    }
    Add(o) { return new Vector3Class(this.x + o.x, this.y + o.y, this.z + o.z); }
    Sub(o) { return new Vector3Class(this.x - o.x, this.y - o.y, this.z - o.z); }
    Subtract(o) { return this.Sub(o); }
    Multiply(o) {
        if (typeof o === 'number') return new Vector3Class(this.x * o, this.y * o, this.z * o);
        return new Vector3Class(this.x * o.x, this.y * o.y, this.z * o.z);
    }
    Lerp(o, t) {
        return new Vector3Class(
            this.x + (o.x - this.x) * t,
            this.y + (o.y - this.y) * t,
            this.z + (o.z - this.z) * t
        );
    }
    FuzzyEq(o, eps = 1e-5) { return Math.abs(this.x - o.x) <= eps && Math.abs(this.y - o.y) <= eps && Math.abs(this.z - o.z) <= eps; }
    toString() { return `${this.x}, ${this.y}, ${this.z}`; }
}
function Vector3(x, y, z) { return new Vector3Class(x ?? 0, y ?? 0, z ?? 0); }
Vector3.new = (x, y, z) => new Vector3Class(x ?? 0, y ?? 0, z ?? 0);
Object.defineProperty(Vector3, 'zero', { get: () => new Vector3Class(0, 0, 0) });
Object.defineProperty(Vector3, 'one', { get: () => new Vector3Class(1, 1, 1) });

// CFrame is simplified to a translation + XYZ Euler-angle rotation (radians)
// rather than a full 3x3 rotation matrix. That covers the overwhelming
// majority of real scripts (positioning/facing parts), but composing two
// CFrames with true rotation-matrix math (`cf1 * cf2`) is not implemented -
// use :ToWorldSpace()/:PointToWorldSpace() for translation-based composition
// instead of the `*` operator, for the same reason described above Vector3.
class CFrameClass {
    constructor(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
        this.x = x; this.y = y; this.z = z;
        Object.defineProperties(this, {
            X: { value: x, enumerable: false },
            Y: { value: y, enumerable: false },
            Z: { value: z, enumerable: false },
            _rx: { value: rx, enumerable: false },
            _ry: { value: ry, enumerable: false },
            _rz: { value: rz, enumerable: false },
        });
    }
    get Position() { return new Vector3Class(this.x, this.y, this.z); }
    get p() { return this.Position; }
    get LookVector() {
        const cx = Math.cos(this._rx), sx = Math.sin(this._rx);
        const cy = Math.cos(this._ry), sy = Math.sin(this._ry);
        return new Vector3Class(-sy * cx, sx, -cy * cx);
    }
    get UpVector() {
        const cx = Math.cos(this._rx), sx = Math.sin(this._rx);
        const cy = Math.cos(this._ry), sy = Math.sin(this._ry);
        return new Vector3Class(sy * sx, cx, cy * sx);
    }
    get RightVector() { return this.UpVector.Cross(this.LookVector); }
    ToWorldSpace(other) {
        return new CFrameClass(
            this.x + (other?.x ?? 0), this.y + (other?.y ?? 0), this.z + (other?.z ?? 0),
            this._rx + (other?._rx ?? 0), this._ry + (other?._ry ?? 0), this._rz + (other?._rz ?? 0)
        );
    }
    PointToWorldSpace(point) { return new Vector3Class(this.x + point.x, this.y + point.y, this.z + point.z); }
    PointToObjectSpace(point) { return new Vector3Class(point.x - this.x, point.y - this.y, point.z - this.z); }
    Inverse() { return new CFrameClass(-this.x, -this.y, -this.z, -this._rx, -this._ry, -this._rz); }
    Lerp(o, t) {
        return new CFrameClass(
            this.x + (o.x - this.x) * t, this.y + (o.y - this.y) * t, this.z + (o.z - this.z) * t,
            this._rx + (o._rx - this._rx) * t, this._ry + (o._ry - this._ry) * t, this._rz + (o._rz - this._rz) * t
        );
    }
    ToEulerAnglesXYZ() { return [this._rx, this._ry, this._rz]; }
    toString() { return `${this.x}, ${this.y}, ${this.z}`; }
}
function CFrame(x, y, z) {
    if (x && typeof x === 'object') {
        if (y && typeof y === 'object') return CFrame.lookAt(x, y);
        return new CFrameClass(x.x ?? 0, x.y ?? 0, x.z ?? 0);
    }
    return new CFrameClass(x ?? 0, y ?? 0, z ?? 0);
}
CFrame.new = CFrame;
Object.defineProperty(CFrame, 'identity', { get: () => new CFrameClass(0, 0, 0) });
CFrame.Angles = (rx, ry, rz) => new CFrameClass(0, 0, 0, rx ?? 0, ry ?? 0, rz ?? 0);
CFrame.fromEulerAnglesXYZ = CFrame.Angles;
CFrame.lookAt = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const ry = Math.atan2(dx, -dz);
    const dist = Math.sqrt(dx * dx + dz * dz);
    const rx = -Math.atan2(dy, dist);
    return new CFrameClass(from.x, from.y, from.z, rx, ry, 0);
};

// Runtime back-end for the transpiler's datatype-arithmetic rewrites (the
// `_bvMath('+', a, b)` calls inserted into transpiled source). Handles real
// Vector3/CFrame math for `+ - * /` and falls back to the native JS operator
// for anything else (plain numbers/strings), so ordinary arithmetic behaves
// exactly as before.
function _bvMath(op, a, b) {
    const isV = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
    const av = isV(a), bv = isV(b);
    if (av && bv) {
        const cfa = a.constructor === CFrameClass;
        const cfb = b.constructor === CFrameClass;
        if (op === '+') {
            if (cfa && !cfb) return new CFrameClass(a.x + b.x, a.y + b.y, a.z + b.z, a._rx, a._ry, a._rz);
            if (!cfa && cfb) return new CFrameClass(b.x + a.x, b.y + a.y, b.z + a.z, b._rx, b._ry, b._rz);
            if (cfa && cfb) return new CFrameClass(a.x + b.x, a.y + b.y, a.z + b.z, (a._rx || 0) + (b._rx || 0), (a._ry || 0) + (b._ry || 0), (a._rz || 0) + (b._rz || 0));
            return new Vector3Class(a.x + b.x, a.y + b.y, a.z + b.z);
        }
        if (op === '-') {
            if (cfa && !cfb) return new CFrameClass(a.x - b.x, a.y - b.y, a.z - b.z, a._rx, a._ry, a._rz);
            return new Vector3Class(a.x - b.x, a.y - b.y, a.z - b.z);
        }
        if (op === '*') return new Vector3Class(a.x * b.x, a.y * b.y, a.z * b.z);
        if (op === '/') return new Vector3Class(a.x / b.x, a.y / b.y, a.z / b.z);
    }
    if (op === '*' && av && typeof b === 'number') return new Vector3Class(a.x * b, a.y * b, a.z * b);
    if (op === '*' && typeof a === 'number' && bv) return new Vector3Class(b.x * a, b.y * a, b.z * a);
    if (op === '/' && av && typeof b === 'number') return new Vector3Class(a.x / b, a.y / b, a.z / b);
    if (op === '+' && av && typeof b === 'number') return new Vector3Class(a.x + b, a.y + b, a.z + b);
    if (op === '-' && av && typeof b === 'number') return new Vector3Class(a.x - b, a.y - b, a.z - b);
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
    }
    return undefined;
}
globalThis._bvMath = _bvMath;

// ── Enum (best-effort subset covering the commonly-used namespaces) ──────────
function _mkEnumItem(enumName, name, value) {
    return { EnumType: enumName, Name: name, Value: value, toString: () => `Enum.${enumName}.${name}` };
}
function _mkEnum(name, names) {
    const e = {};
    names.forEach((n, i) => { e[n] = _mkEnumItem(name, n, i); });
    Object.defineProperty(e, 'GetEnumItems', { value: () => names.map(n => e[n]), enumerable: false });
    return e;
}
const Enum = {
    Material: _mkEnum('Material', ['Plastic', 'Wood', 'Slate', 'Concrete', 'CorrodedMetal', 'DiamondPlate', 'Foil', 'Grass', 'Ice', 'Marble', 'Granite', 'Brick', 'Pebble', 'Sand', 'Fabric', 'SmoothPlastic', 'Metal', 'WoodPlanks', 'Cobblestone', 'Glass', 'ForceField', 'Air', 'Water', 'Neon']),
    KeyCode: _mkEnum('KeyCode', ['Unknown', 'Backspace', 'Tab', 'Return', 'Space', 'Escape', 'Up', 'Down', 'Left', 'Right', 'LeftShift', 'RightShift', 'LeftControl', 'RightControl', 'LeftAlt', 'RightAlt', 'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']),
    EasingStyle: _mkEnum('EasingStyle', ['Linear', 'Sine', 'Back', 'Quad', 'Quart', 'Quint', 'Bounce', 'Elastic', 'Exponential', 'Circular', 'Cubic']),
    EasingDirection: _mkEnum('EasingDirection', ['In', 'Out', 'InOut']),
    UserInputType: _mkEnum('UserInputType', ['MouseButton1', 'MouseButton2', 'MouseButton3', 'MouseWheel', 'MouseMovement', 'Keyboard', 'Touch', 'Gamepad1']),
    HumanoidStateType: _mkEnum('HumanoidStateType', ['Running', 'Jumping', 'Freefall', 'Landed', 'Climbing', 'Swimming', 'Dead', 'Seated', 'GettingUp', 'Ragdoll', 'None']),
    PartType: _mkEnum('PartType', ['Ball', 'Block', 'Cylinder', 'Wedge', 'CornerWedge']),
    RaycastFilterType: _mkEnum('RaycastFilterType', ['Exclude', 'Include']),
    NormalId: _mkEnum('NormalId', ['Top', 'Bottom', 'Front', 'Back', 'Right', 'Left']),
};

// ── Coroutines (best-effort) ──────────────────────────────────────────────────
// True Lua coroutines need real continuations (fibers/generators). Script
// bodies here are transpiled into plain `async function`s, not generators,
// so this emulates coroutine semantics with a promise handshake instead:
// resume() returns a promise that resolves once the coroutine reaches its
// *next* pause point - either a subsequent yield() call or the function
// returning/throwing - mirroring Lua's actual resume()/yield() pairing
// (including yielding more than once) rather than only handling a single
// synchronous yield. `_coroStack` tracks "the currently running coroutine"
// so a bare yield() call inside the coroutine body finds its own coroutine
// without needing to be passed it explicitly.
let _coroStack = [];
function _makeCoroutine(fn) {
    return { status: 'suspended', _fn: fn, _started: false, _gate: null, _onPause: null };
}
const LuaCoroutine = {
    create: (fn) => _makeCoroutine(fn),
    resume(co, ...args) {
        if (!co || co.status === 'dead') return Promise.resolve([false, 'cannot resume dead coroutine']);
        if (co.status === 'running') return Promise.resolve([false, 'cannot resume running coroutine']);
        return new Promise((resolveResume) => {
            co._onPause = (values, isDead, isError, errMsg) => {
                co._onPause = null;
                if (isDead) {
                    co.status = 'dead';
                    resolveResume(isError ? [false, errMsg] : [true, ...(values || [])]);
                } else {
                    co.status = 'suspended';
                    resolveResume([true, ...(values || [])]);
                }
            };
            co.status = 'running';
            if (!co._started) {
                co._started = true;
                _coroStack.push(co);
                let ran;
                try {
                    ran = co._fn(...args);
                } catch (e) {
                    _coroStack.pop();
                    const cb = co._onPause; co._onPause = null;
                    if (cb) cb(null, true, true, e?.message ?? String(e));
                    return;
                }
                _coroStack.pop();
                if (ran && typeof ran.then === 'function') {
                    ran.then((result) => {
                        const cb = co._onPause; co._onPause = null;
                        if (cb) cb(result === undefined ? [] : (Array.isArray(result) ? result : [result]), true, false);
                    }).catch((e) => {
                        const cb = co._onPause; co._onPause = null;
                        if (cb) cb(null, true, true, e?.message ?? String(e));
                    });
                } else {
                    const cb = co._onPause; co._onPause = null;
                    if (cb) cb(ran === undefined ? [] : (Array.isArray(ran) ? ran : [ran]), true, false);
                }
            } else if (co._gate) {
                const gate = co._gate;
                co._gate = null;
                _coroStack.push(co);
                gate.resolve(args.length <= 1 ? args[0] : args);
                _coroStack.pop();
            } else {
                const cb = co._onPause; co._onPause = null;
                if (cb) { /* nothing to do, fall through to explicit failure below */ }
                resolveResume([false, 'cannot resume non-suspended coroutine']);
            }
        });
    },
    yield(...args) {
        const co = _coroStack[_coroStack.length - 1];
        return new Promise((resolveYield) => {
            if (co) {
                co._gate = { resolve: resolveYield };
                const cb = co._onPause;
                co._onPause = null;
                if (cb) cb(args, false, false);
            } else {
                resolveYield(args.length <= 1 ? args[0] : args);
            }
        });
    },
    status: (co) => co?.status ?? 'dead',
    wrap(fn) {
        const co = _makeCoroutine(fn);
        return async (...args) => {
            const res = await LuaCoroutine.resume(co, ...args);
            if (!res[0]) throw new Error(res[1]);
            return res.length <= 2 ? res[1] : res.slice(1);
        };
    },
    isyieldable: () => _coroStack.length > 0,
    running: () => _coroStack[_coroStack.length - 1] || null,
};

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

// Normalizes a call result for `let [a, b] = _asMulti(expr)` destructuring:
// real multi-return built-ins (pcall, coroutine.resume, string.find, ...)
// already return a plain array, so it passes through untouched; anything
// else (a single-value expression, or a user function that only returns
// one value) gets wrapped so the first destructured name receives it and
// any extra requested names correctly come out as undefined (nil).
function _asMulti(v) {
    return Array.isArray(v) ? v : [v];
}

// Formats a value the way Lua's print()/tostring() would - nil (JS
// null/undefined) prints as "nil", not JS's "null"/"undefined".
function _luaToString(v) {
    if (v === null || v === undefined) return 'nil';
    return String(v);
}

// Luau's typeof() is more specific than type() - it names Roblox's
// "userdata" datatypes (Vector3, CFrame, Color3, Instance) instead of just
// lumping them under "userdata"/"table".
function _luaTypeOf(v) {
    if (v === null || v === undefined) return 'nil';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'function') return 'function';
    if (v instanceof Vector3Class) return 'Vector3';
    if (v instanceof CFrameClass) return 'CFrame';
    if (v && typeof v === 'object') {
        try { if (v._target !== undefined) return 'Instance'; } catch (e) { /* not a createInstanceProxy */ }
        if ('r' in v && 'g' in v && 'b' in v) return 'Color3';
    }
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
    randomseed: () => { /* no-op: JS's Math.random() can't be reseeded without a custom PRNG */ },
    round: (x) => Math.round(x),
    rad: (d) => d * Math.PI / 180,
    deg: (r) => r * 180 / Math.PI,
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
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2,
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
    split: (s, sep) => {
        s = String(s);
        if (sep === undefined || sep === '') return s.split('');
        return s.split(sep);
    },
    // Small subset of Lua's string.pack/unpack: signed/unsigned byte, short,
    // 32-bit int, and 32/64-bit float, always little-endian. Endianness
    // markers (<, >, =) and less-common specifiers (variable-length strings,
    // 64-bit ints, alignment) are not supported.
    pack: (fmt, ...args) => {
        const sizes = { b: 1, B: 1, h: 2, H: 2, i: 4, I: 4, l: 4, L: 4, f: 4, d: 8 };
        const chunks = [];
        let ai = 0;
        for (const ch of String(fmt).replace(/[<>=!]/g, '')) {
            if (!(ch in sizes)) continue;
            const buf = new ArrayBuffer(sizes[ch]);
            const view = new DataView(buf);
            const val = args[ai++];
            switch (ch) {
                case 'b': view.setInt8(0, val); break;
                case 'B': view.setUint8(0, val); break;
                case 'h': view.setInt16(0, val, true); break;
                case 'H': view.setUint16(0, val, true); break;
                case 'i': case 'l': view.setInt32(0, val, true); break;
                case 'I': case 'L': view.setUint32(0, val, true); break;
                case 'f': view.setFloat32(0, val, true); break;
                case 'd': view.setFloat64(0, val, true); break;
            }
            chunks.push(String.fromCharCode(...new Uint8Array(buf)));
        }
        return chunks.join('');
    },
    unpack: (fmt, str, pos) => {
        const sizes = { b: 1, B: 1, h: 2, H: 2, i: 4, I: 4, l: 4, L: 4, f: 4, d: 8 };
        let offset = (pos ?? 1) - 1;
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
        const view = new DataView(bytes.buffer);
        const results = [];
        for (const ch of String(fmt).replace(/[<>=!]/g, '')) {
            if (!(ch in sizes)) continue;
            switch (ch) {
                case 'b': results.push(view.getInt8(offset)); break;
                case 'B': results.push(view.getUint8(offset)); break;
                case 'h': results.push(view.getInt16(offset, true)); break;
                case 'H': results.push(view.getUint16(offset, true)); break;
                case 'i': case 'l': results.push(view.getInt32(offset, true)); break;
                case 'I': case 'L': results.push(view.getUint32(offset, true)); break;
                case 'f': results.push(view.getFloat32(offset, true)); break;
                case 'd': results.push(view.getFloat64(offset, true)); break;
            }
            offset += sizes[ch];
        }
        results.push(offset + 1);
        return results;
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
        i = (i ?? 1) - 1;
        j = j ?? t.length;
        return t.slice(i, j);
    },
    find: (t, val, init) => {
        t = _toArray(t);
        init = (init ?? 1) - 1;
        for (let i = init; i < t.length; i++) if (t[i] === val) return i + 1;
        return null;
    },
    clone: (t) => (Array.isArray(t) ? [...t] : { ...t }),
    clear: (t) => {
        if (Array.isArray(t)) t.length = 0;
        else for (const k of Object.keys(t)) delete t[k];
        return t;
    },
    create: (count, value) => new Array(count).fill(value ?? null),
    freeze: (t) => Object.freeze(t),
    isfrozen: (t) => Object.isFrozen(t),
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
        // game:GetService("X") - resolves the same well-known services that
        // direct property access (game.X) does, plus RunService which lives
        // outside the instance tree (it's handed in separately via `api`).
        GetService: (name) => {
            if (name === 'RunService') return api.RunService || null;
            if (name === 'Players') return makePlayersProxy(api.game || {});
            // Canonical service names always resolve by ClassName, even if a
            // service has been renamed in the explorer.
            return serviceChild(api.game || {}, name);
        },
    };

    // Finds a service instance by its canonical class name, preferring a
    // ClassName match over a direct property or a Name match. Used by
    // game:GetService(...) and the bare globals, which Roblox always resolves
    // to the canonical service regardless of any rename.
    function serviceChild(target, className) {
        const ch = target && target.Children ? target.Children : [];
        const byClass = ch.find((c) => c.ClassName === className);
        if (byClass) return createInstanceProxy(byClass);
        if (target && target[className]) return createInstanceProxy(target[className]);
        const byName = ch.find((c) => c.Name === className);
        return byName ? createInstanceProxy(byName) : null;
    }

    // Resolves Roblox's well-known top-level services against the raw game
    // object, shared by both direct property access (game.Workspace) and
    // game:GetService("Workspace"). Returns null (not undefined) for unknown
    // names so callers can tell "no such service" apart from "prop lookup
    // fell through to something else".
    function resolveService(target, name) {
        switch (name) {
            case 'Workspace': case 'workspace':
                return createInstanceProxy(target.Workspace || target.Children?.find(c => c.Name === 'Workspace'));
            case 'StarterGui':
                return createInstanceProxy(target.StarterGui || target.Children?.find(c => c.Name === 'StarterGui'));
            case 'Lighting':
                return createInstanceProxy(target.Lighting || target.Children?.find(c => c.Name === 'Lighting'));
            case 'ReplicatedStorage':
                return createInstanceProxy(target.ReplicatedStorage || target.Children?.find(c => c.Name === 'ReplicatedStorage'));
            case 'ServerScriptService':
                return createInstanceProxy(target.ServerScriptService || target.Children?.find(c => c.Name === 'ServerScriptService'));
            case 'ServerStorage':
                return createInstanceProxy(target.ServerStorage || target.Children?.find(c => c.Name === 'ServerStorage'));
            case 'StarterPack':
                return createInstanceProxy(target.StarterPack || target.Children?.find(c => c.Name === 'StarterPack'));
            case 'StarterPlayer':
                return createInstanceProxy(target.StarterPlayer || target.Children?.find(c => c.Name === 'StarterPlayer'));
            case 'Players':
                return makePlayersProxy(target);
            case 'RunService':
                return api.RunService || null;
            default:
                return null;
        }
    }

    // Players gets a small hand-built wrapper on top of the normal Instance
    // proxy so GetPlayers()/PlayerAdded/PlayerRemoving work even though this
    // sandbox doesn't have real networked players - they degrade gracefully
    // (empty list, connectable-but-never-fired signals) instead of throwing.
    function makePlayersProxy(target) {
        const base = serviceChild(target, 'Players') || {};
        return new Proxy(base, {
            get(t, prop) {
                if (prop === 'GetPlayers') return () => gameApi.GetPlayers().map(p => createInstanceProxy(p));
                if (prop === 'PlayerAdded') return { Connect: (fn) => { gameApi.On('PlayerAdded', fn); return { Disconnect: () => {} }; } };
                if (prop === 'PlayerRemoving') return { Connect: (fn) => { gameApi.On('PlayerRemoving', fn); return { Disconnect: () => {} }; } };
                // LocalPlayer only exists on the client, matching real
                // Roblox exactly - a Script (server) asking for it gets nil,
                // same as it would in a real game. The host page supplies
                // the actual player instance via api.localPlayer when
                // running a LocalScript.
                if (prop === 'LocalPlayer') return api.side === 'client' ? createInstanceProxy(api.localPlayer) : null;
                return t[prop];
            }
        });
    }

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
                // Well-known service names take priority over generic child
                // lookup below - Players in particular needs makePlayersProxy's
                // LocalPlayer handling, which a plain createInstanceProxy(child)
                // from the generic lookup wouldn't provide.
                const svc = resolveService(target, prop);
                if (svc !== null) return svc;
                // Child instance lookup (Folders, Models, other named children)
                if (target.Children) {
                    const child = target.Children.find(c => c.Name === prop);
                    if (child) return createInstanceProxy(child);
                }
                return undefined;
            }
        });
    }

    const ctx = {
        // print/warn resolve any Promise-valued argument before formatting.
        // This isn't required for the common case (plain values), but a
        // metatable's __index handler is virtually always an async function
        // (every Lua function compiles to one) and a Proxy `get` trap can't
        // itself be async - so `t.someProp` when __index is a function
        // always hands back an unawaited Promise. Making print/warn async
        // and awaiting Promise args here fixes the overwhelmingly common
        // symptom (`print(t.someProp)`) for free, without needing every
        // call site to know to await it.
        print: async (...args) => {
            const resolved = await Promise.all(args);
            const msg = resolved.map(_luaToString).join('\t');
            console.log('[Script]', msg);
            if (api.onOutput) api.onOutput(msg, 'info');
        },
        warn: async (...args) => {
            const resolved = await Promise.all(args);
            const msg = resolved.map(_luaToString).join('\t');
            console.warn('[Script]', msg);
            if (api.onOutput) api.onOutput(msg, 'warn');
        },
        error: (msg, level) => {
            console.error('[Script]', msg);
            if (api.onOutput) api.onOutput(String(msg), 'error');
            // Preserve the original value/type passed to error() (Lua errors
            // aren't always strings) so pcall/xpcall's caught value matches
            // what was actually thrown, instead of a JS Error's "Error: ..."
            // stringification once code does e.g. `"prefix"..err`.
            const e = new Error(typeof msg === 'string' ? msg : _luaToString(msg));
            e.luaValue = msg;
            throw e;
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
        // task.* mirrors the legacy wait/spawn/delay globals above - Roblox's
        // modern "task library" equivalents. task.cancel is a no-op here
        // since threads aren't tracked by an id in this simplified model.
        task: {
            wait: (seconds) => ctx.wait(seconds),
            spawn: (fn, ...args) => { ctx.spawn(() => fn(...args)); return {}; },
            delay: (seconds, fn, ...args) => { ctx.delay(seconds, () => fn(...args)); return {}; },
            defer: (fn, ...args) => { ctx.spawn(() => fn(...args)); return {}; },
            cancel: () => {},
        },
        coroutine: LuaCoroutine,
        pcall: async (fn, ...args) => {
            // `fn` is virtually always an async function (every Lua function
            // is transpiled to one), so this must await it - otherwise a
            // thrown error surfaces as an unobserved promise rejection well
            // after this try/catch has already returned, instead of being
            // caught here like real pcall semantics require.
            try { return [true, await fn(...args)]; } catch (e) { return [false, e?.luaValue !== undefined ? e.luaValue : String(e?.message ?? e)]; }
        },
        xpcall: async (fn, handler, ...args) => {
            try { return [true, await fn(...args)]; } catch (e) { return [false, await handler(e?.luaValue !== undefined ? e.luaValue : e)]; }
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
        os: LuaOs,
        bit32: LuaBit32,
        utf8: LuaUtf8,
        _G: _getGBucket(api.side),
        _VERSION: 'Lua 5.1',
        game: makeGameProxy(api.game),
        workspace: createInstanceProxy(api.game?.Workspace || api.game?.Children?.find(c => c.Name === 'Workspace')),
        // RunService and Players are exposed as bare globals (matching how
        // `game`/`workspace`/`script` already are here) rather than requiring
        // game:GetService(...) first, since that's the pattern this app's
        // sample scripts use. A safe no-op fallback is used if the host page
        // didn't pass a RunService object in via `api`. IsServer()/IsClient()
        // are layered on here (rather than requiring the host to provide
        // them) since they're the canonical way real scripts branch on which
        // side they're running on - Script gets IsServer()==true, LocalScript
        // gets IsClient()==true, matching api.side.
        RunService: new Proxy(api.RunService || {
            Heartbeat: { Connect: () => ({ Disconnect() {} }) },
            Stepped: { Connect: () => ({ Disconnect() {} }) },
            RenderStepped: { Connect: () => ({ Disconnect() {} }) },
        }, {
            get(t, p) {
                if (p === 'IsServer') return () => api.side !== 'client';
                if (p === 'IsClient') return () => api.side === 'client';
                if (p === 'IsStudio') return () => api.isStudio !== false;
                if (p === 'IsRunMode') return () => !!api.isStudio;
                const v = t[p];
                return typeof v === 'function' ? v.bind(t) : v;
            },
        }),
        Players: makePlayersProxy(api.game || {}),
        // Workspace/ReplicatedStorage/ServerScriptService are exposed as
        // bare globals too, alongside Players/RunService above, for the
        // same reason - some scripts reach for them directly rather than
        // going through game:GetService(...) first.
        Workspace: serviceChild(api.game || {}, 'Workspace'),
        ReplicatedStorage: serviceChild(api.game || {}, 'ReplicatedStorage'),
        ServerScriptService: serviceChild(api.game || {}, 'ServerScriptService'),
        Instance: Instance,
        Color3: Color3,
        Vector3: Vector3,
        Vector2: Vector2,
        CFrame: CFrame,
        Ray: Ray,
        Region3: Region3,
        RaycastParams: RaycastParams,
        OverlapParams: OverlapParams,
        BrickColor: BrickColor,
        NumberRange: NumberRange,
        NumberSequence: NumberSequence,
        ColorSequence: ColorSequence,
        PhysicalProperties: PhysicalProperties,
        TweenInfo: TweenInfo,
        Random: Random,
        DateTime: DateTime,
        Enum: Enum,
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

    // `require` stub — returns exports of a named script if available via
    // api. Real Roblox require() takes a ModuleScript *instance* (or an asset
    // id), not a string name, so `name` here is usually an Instance proxy -
    // describe it sensibly either way instead of printing "[object Object]".
    ctx.require = (name) => {
        if (api.require) return api.require(name);
        const label = (name && typeof name === 'object') ? (name.Name ? `Instance "${name.Name}"` : String(name)) : String(name);
        console.warn('[Script] require(' + label + ') is not supported in this context');
        return {};
    };

    // loadstring(code) - compiles a string of Lua as a new chunk and returns
    // a callable function, matching Lua's (fn, nil) on success / (nil, err)
    // on failure return signature. The loaded chunk runs with the same
    // globals (game/workspace/script/etc) as the script that loaded it,
    // since there's no separate sandboxing concept in this simplified engine.
    ctx.loadstring = (src, chunkName) => {
        try {
            const compiledJs = luaToJS(src);
            const runner = new Function(
                'exports', 'game', 'workspace', 'script',
                'Instance', 'Color3', 'Vector3', 'Vector2', 'CFrame', 'Ray', 'Region3', 'RaycastParams', 'OverlapParams',
                'BrickColor', 'NumberRange', 'NumberSequence', 'ColorSequence', 'PhysicalProperties', 'TweenInfo', 'Random', 'DateTime',
                'UDim2', 'UDim', 'Enum', 'RunService', 'Players', 'Workspace', 'ReplicatedStorage', 'ServerScriptService',
                'print', 'warn', 'error', 'assert',
                'wait', 'spawn', 'delay', 'task', 'coroutine',
                'pcall', 'xpcall',
                'setmetatable', 'getmetatable', 'rawget', 'rawset', 'rawequal',
                'ipairs', 'pairs', 'unpack', 'select', 'next',
                'string', 'table', 'math', 'Math', 'os', 'bit32', 'utf8',
                '_G', '_VERSION', 'loadstring',
                'tostring', 'tonumber', '_luaType', '_luaTypeOf', '_asMulti', 'require',
                'character',
                `"use strict"; return (async () => {\n${compiledJs}\n})();`
            );
            const fn = (...args) => runner(
                ctx.exports, ctx.game, ctx.workspace, createInstanceProxy(api.scriptInstance),
                ctx.Instance, ctx.Color3, ctx.Vector3, ctx.Vector2, ctx.CFrame, ctx.Ray, ctx.Region3, ctx.RaycastParams, ctx.OverlapParams,
                ctx.BrickColor, ctx.NumberRange, ctx.NumberSequence, ctx.ColorSequence, ctx.PhysicalProperties, ctx.TweenInfo, ctx.Random, ctx.DateTime,
                ctx.UDim2, ctx.UDim, ctx.Enum, ctx.RunService, ctx.Players, ctx.Workspace, ctx.ReplicatedStorage, ctx.ServerScriptService,
                ctx.print, ctx.warn, ctx.error, ctx.assert,
                ctx.wait, ctx.spawn, ctx.delay, ctx.task, ctx.coroutine,
                ctx.pcall, ctx.xpcall,
                ctx.setmetatable, ctx.getmetatable, ctx.rawget, ctx.rawset, ctx.rawequal,
                ctx.ipairs, ctx.pairs, ctx.unpack, ctx.select, ctx.next,
                ctx.string, ctx.table, ctx.math, ctx.Math, ctx.os, ctx.bit32, ctx.utf8,
                ctx._G, ctx._VERSION, ctx.loadstring,
                _luaToString, (v) => Number(v), _luaType, _luaTypeOf, _asMulti, ctx.require,
                api.character || null
            );
            return [fn, null];
        } catch (e) {
            return [null, String(e?.message ?? e)];
        }
    };

    return ctx;
}

export function executeScript(code, api) {
    // Track which player is "the active client" for RemoteEvent/
    // RemoteFunction handlers fired from this call (see createInstanceProxy)
    // - only meaningful for client-side (LocalScript) calls.
    if (api.side === 'client') _activeClientPlayer = api.localPlayer || null;
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
            _maybeInstantiateVisual(inst);
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
            'Instance', 'Color3', 'Vector3', 'Vector2', 'CFrame', 'Ray', 'Region3', 'RaycastParams', 'OverlapParams', 'UDim2', 'UDim', 'Enum',
            'BrickColor', 'NumberRange', 'NumberSequence', 'ColorSequence', 'PhysicalProperties', 'TweenInfo', 'Random', 'DateTime',
            'RunService', 'Players', 'Workspace', 'ReplicatedStorage', 'ServerScriptService',
            'print', 'warn', 'error', 'assert',
            'wait', 'spawn', 'delay', 'task', 'coroutine',
            'pcall', 'xpcall',
            'setmetatable', 'getmetatable', 'rawget', 'rawset', 'rawequal',
            'ipairs', 'pairs', 'unpack', 'select', 'next',
            'string', 'table', 'math', 'Math', 'os', 'bit32', 'utf8',
            '_G', '_VERSION', 'loadstring',
            'tostring', 'tonumber', '_luaType', '_luaTypeOf', '_asMulti', 'require',
            '_onError', 'character',
            wrapped
        );
        fn(
            ctx.exports, gameProxy, ctx.workspace, scriptProxy,
            proxiedInstance, ctx.Color3, ctx.Vector3, ctx.Vector2, ctx.CFrame, ctx.Ray, ctx.Region3, ctx.RaycastParams, ctx.OverlapParams, ctx.UDim2, ctx.UDim, ctx.Enum,
            ctx.BrickColor, ctx.NumberRange, ctx.NumberSequence, ctx.ColorSequence, ctx.PhysicalProperties, ctx.TweenInfo, ctx.Random, ctx.DateTime,
            ctx.RunService, ctx.Players, ctx.Workspace, ctx.ReplicatedStorage, ctx.ServerScriptService,
            ctx.print, ctx.warn, ctx.error, ctx.assert,
            ctx.wait, ctx.spawn, ctx.delay, ctx.task, ctx.coroutine,
            ctx.pcall, ctx.xpcall,
            ctx.setmetatable, ctx.getmetatable, ctx.rawget, ctx.rawset, ctx.rawequal,
            ctx.ipairs, ctx.pairs, ctx.unpack, ctx.select, ctx.next,
            ctx.string, ctx.table, ctx.math, ctx.Math, ctx.os, ctx.bit32, ctx.utf8,
            ctx._G, ctx._VERSION, ctx.loadstring,
            _luaToString, (v) => Number(v), _luaType, _luaTypeOf, _asMulti, ctx.require,
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