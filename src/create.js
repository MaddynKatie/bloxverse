import { sitePath } from './paths.js';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, banGuard, isProfane } from './firebase.js';
import { doc, onSnapshot } from 'firebase/firestore';
import { loadScriptsFromStorage, saveScriptsToStorage } from './scriptRuntime.js';
import * as studio from './studio.js';

let scripts = {};
let currentScript = null;
let isDirty = false;
let suppressHighlight = false;
let highlightRAF = null;

// Studio state
let _studioInitialized = false;
let _currentMode = 'script';

// Script editor undo/redo
let _scriptUndoStack = [];
let _scriptRedoStack = [];
const MAX_SCRIPT_UNDO = 100;
let _autocompleteBox = null;
let _suggestions = [];
let _suggestionIndex = 0;
let _autocompleteContext = { type: 'word', text: '', range: null };

const codeEditor = document.getElementById('codeEditor');
const editorArea = document.getElementById('editorArea');
const lineNumbers = document.getElementById('lineNumbers');
const scriptList = document.getElementById('scriptList');
const editorTabs = document.getElementById('editorTabs');
const saveBtn = document.getElementById('saveBtn');
const newScriptBtn = document.getElementById('newScriptBtn');
const newScriptInput = document.getElementById('newScriptInput');
const confirmNewBtn = document.getElementById('confirmNewBtn');
const cancelNewBtn = document.getElementById('cancelNewBtn');
const newScriptActions = document.getElementById('newScriptActions');
const outputContainer = document.getElementById('outputContainer');
const bottomPanel = document.getElementById('bottomPanel');

// Studio elements
const studioSidebar = document.getElementById('studioSidebar');
const studioViewport = document.getElementById('studioViewport');
const studio3DContainer = document.getElementById('studio3DContainer');
const studioExplorerList = document.getElementById('studioExplorerList');
const studioPropsContent = document.getElementById('studioPropsContent');
const studioNewBtn = document.getElementById('studioNewBtn');
const studioLoadBtn = document.getElementById('studioLoadBtn');
const studioExportBtn = document.getElementById('studioExportBtn');
const studioPublishBtn = document.getElementById('studioPublishBtn');
const studioPlayBtn = document.getElementById('studioPlayBtn');
const studioStopBtn = document.getElementById('studioStopBtn');
const studioAddBtn = document.getElementById('studioAddBtn');
const studioFileInput = document.getElementById('studioFileInput');
const modeTabs = document.querySelectorAll('.mode-tab');
const docsLink = document.getElementById('docsLink');
const scriptSidebar = document.getElementById('scriptSidebar');
const codeEditorPanel = document.getElementById('codeEditorPanel');

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = sitePath('auth.html');
        return;
    }
    if (await banGuard(user.uid)) return;
    // ── Real-time ban listener ──────────────────────────────────────
    onSnapshot(doc(db, 'bans', user.uid), (snap) => {
      if (snap.exists() && snap.data().banned) {
        window.location.href = sitePath('ban.html');
      }
    });
    // ────────────────────────────────────────────────────────────────
    initializeEditor();
});

async function initializeEditor() {
    const stored = loadScriptsFromStorage();
    scripts = stored;
    if (Object.keys(scripts).length > 0) {
        currentScript = Object.keys(scripts)[0];
    } else {
        currentScript = null;
    }

    codeEditor.addEventListener('beforeinput', _saveScriptUndo);
    codeEditor.addEventListener('input', handleCodeInput);
    codeEditor.addEventListener('keydown', handleEditorKey);
    codeEditor.addEventListener('blur', () => {
        // Small delay to allow mousedown on suggestions to work first
        setTimeout(() => {
            if (_autocompleteBox) _autocompleteBox.style.display = 'none';
        }, 200);
    });
    codeEditor.addEventListener('paste', handlePaste);
    editorArea.addEventListener('scroll', syncLineNumbers);
    saveBtn.addEventListener('click', saveScript);
    newScriptBtn.addEventListener('click', showNewScriptInput);
    confirmNewBtn.addEventListener('click', createNewScript);
    cancelNewBtn.addEventListener('click', hideNewScriptInput);

    docsLink.textContent = '📚 Script Docs';
    docsLink.href = sitePath('docs.html');

    studioPlayBtn.addEventListener('click', startStudioTest);
    studioStopBtn.addEventListener('click', stopStudioTest);

    // Tab switching
    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });

    // Studio button wiring
    studioNewBtn.addEventListener('click', () => {
        if (confirm('Create a new blank map? Current changes will be lost.')) {
            studio.clearAllParts();
        }
    });
    studioLoadBtn.addEventListener('click', () => studioFileInput.click());
    studioFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                studio.loadMapData(data);
                addOutput('Loaded map data from JSON', 'info');
            } catch (err) {
                addOutput('Failed to load map data: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    });

    window.addOutput = addOutput;

    studioExportBtn.addEventListener('click', () => studio.exportMapJSON());
    // Publish modal
    const publishModal = document.getElementById('publishModal');
    const publishName = document.getElementById('publishName');
    const publishGenre = document.getElementById('publishGenre');
    const publishDescription = document.getElementById('publishDescription');
    const publishConfirmBtn = document.getElementById('publishConfirmBtn');
    const publishCancelBtn = document.getElementById('publishCancelBtn');
    const publishModalClose = document.getElementById('publishModalClose');
    const publishThumbPicker = document.getElementById('publishThumbPicker');
    const publishUploadThumbBtn = document.getElementById('publishUploadThumbBtn');
    const publishThumbInput = document.getElementById('publishThumbInput');

    const { THUMB_PRESETS } = await import('./thumb-presets.generated.js');
    let _selectedThumb = THUMB_PRESETS[0];
    let _uploadedThumbUrl = null;

    function buildThumbPicker() {
        publishThumbPicker.innerHTML = '';
        THUMB_PRESETS.forEach(src => {
            const img = document.createElement('img');
            img.className = 'thumb-option' + (src === _selectedThumb ? ' selected' : '');
            img.src = src;
            img.addEventListener('click', () => {
                publishThumbPicker.querySelectorAll('.thumb-option').forEach(el => el.classList.remove('selected'));
                img.classList.add('selected');
                _selectedThumb = src;
                _uploadedThumbUrl = null;
            });
            publishThumbPicker.appendChild(img);
        });
    }

    async function uploadThumb(file) {
        const CLOUD_NAME = 'dvkbiobph';
        const UPLOAD_PRESET = 'bloxverse_thumb';
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', UPLOAD_PRESET);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Upload failed');
        return data.secure_url;
    }

    publishUploadThumbBtn.addEventListener('click', () => publishThumbInput.click());
    publishThumbInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        publishUploadThumbBtn.textContent = 'Uploading...';
        publishUploadThumbBtn.disabled = true;
        try {
            const url = await uploadThumb(file);
            _uploadedThumbUrl = url;
            _selectedThumb = url;
            // Add uploaded thumb as a selected option
            publishThumbPicker.querySelectorAll('.thumb-option').forEach(el => el.classList.remove('selected'));
            const img = document.createElement('img');
            img.className = 'thumb-option selected';
            img.src = url;
            img.addEventListener('click', () => {
                publishThumbPicker.querySelectorAll('.thumb-option').forEach(el => el.classList.remove('selected'));
                img.classList.add('selected');
                _selectedThumb = url;
                _uploadedThumbUrl = url;
            });
            publishThumbPicker.appendChild(img);
        } catch (err) {
            alert('Upload failed: ' + err.message);
        }
        publishUploadThumbBtn.textContent = 'Upload Image';
        publishUploadThumbBtn.disabled = false;
        e.target.value = '';
    });

    function openPublishModal() {
        publishName.value = '';
        publishGenre.value = 'Sandbox';
        publishDescription.value = '';
        _selectedThumb = THUMB_PRESETS[0];
        _uploadedThumbUrl = null;
        buildThumbPicker();
        publishModal.style.display = 'flex';
        publishName.focus();
    }
    function closePublishModal() {
        publishModal.style.display = 'none';
    }

    studioPublishBtn.addEventListener('click', () => {
        if (!auth.currentUser) {
            alert('You must be logged in to publish.');
            return;
        }
        openPublishModal();
    });

    function checkPublishProfanity() {
        const name = publishName.value.trim();
        const desc = publishDescription.value.trim();
        
        if (isProfane(name) || isProfane(desc)) {
            publishConfirmBtn.disabled = true;
            publishConfirmBtn.textContent = '❌ Profanity Detected';
            publishConfirmBtn.style.background = '#c0392b';
        } else {
            publishConfirmBtn.disabled = false;
            publishConfirmBtn.textContent = '🚀 Publish';
            publishConfirmBtn.style.background = '';
        }
    }
    
    publishName.addEventListener('input', checkPublishProfanity);
    publishDescription.addEventListener('input', checkPublishProfanity);

    publishCancelBtn.addEventListener('click', closePublishModal);
    publishModalClose.addEventListener('click', closePublishModal);
    publishModal.addEventListener('click', (e) => {
        if (e.target === publishModal) closePublishModal();
    });

    publishConfirmBtn.addEventListener('click', async () => {
        const name = publishName.value.trim();
        if (!name) { publishName.focus(); return; }
        const genre = publishGenre.value;
        const desc = publishDescription.value.trim();
        publishConfirmBtn.disabled = true;
        publishConfirmBtn.textContent = 'Publishing...';
        try {
            const { publishGame } = await import('./firebase.js');
            const { auth } = await import('./firebase.js');
            const user = auth.currentUser;
            if (!user) { alert('You must be logged in.'); closePublishModal(); return; }
            const gameData = studio.getGameData();
            const publishedScripts = {};
            for (const [sname, sdata] of Object.entries(scripts)) {
                publishedScripts[sname] = sdata.code || sdata;
            }
            const gameId = await publishGame({
                name,
                description: desc || '',
                category: genre,
                gameContent: {
                    parts: gameData.parts,
                    scripts: publishedScripts,
                    lighting: gameData.lighting,
                },
                authorId: user.uid,
                authorName: 'Player',
                icon: _selectedThumb || './assets/icons/demo.png',
            });
            closePublishModal();
            alert(`Published! Play it at /game-detail?id=${gameId}`);
        } catch (err) {
            alert('Failed to publish: ' + err.message);
        } finally {
            publishConfirmBtn.disabled = false;
            publishConfirmBtn.textContent = '🚀 Publish';
        }
    });
    studioAddBtn.addEventListener('click', () => {
        studio.addPart('Part', 4, 4, 4, 0x808080, 0, 0, 0, false);
    });

    // Global keyboard shortcuts (Ctrl+Z / Ctrl+Y)
    document.addEventListener('keydown', handleGlobalKey);

    updateUI();
}

function _saveScriptUndo() {
  _scriptUndoStack.push(getCode());
  if (_scriptUndoStack.length > MAX_SCRIPT_UNDO) _scriptUndoStack.shift();
  _scriptRedoStack = [];
}

function handleGlobalKey(e) {
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    if (_currentMode === 'studio') {
      studio.undo();
    } else {
      if (_scriptUndoStack.length > 0) {
        _scriptRedoStack.push(getCode());
        const prev = _scriptUndoStack.pop();
        const saved = currentScript;
        scripts[currentScript].code = prev;
        updateUI();
        currentScript = saved;
        setCode(prev);
        isDirty = true;
        updateSaveButton();
      }
    }
  } else if (e.ctrlKey && e.key === 'y') {
    e.preventDefault();
    if (_currentMode === 'studio') {
      studio.redo();
    } else {
      if (_scriptRedoStack.length > 0) {
        _scriptUndoStack.push(getCode());
        const next = _scriptRedoStack.pop();
        const saved = currentScript;
        scripts[currentScript].code = next;
        updateUI();
        currentScript = saved;
        setCode(next);
        isDirty = true;
        updateSaveButton();
      }
    }
  }
}

function switchMode(mode) {
    if (mode === _currentMode) return;
    _currentMode = mode;

    modeTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    const scriptModePanels = [scriptSidebar, editorTabs, codeEditorPanel];
    const studioModePanels = [studioSidebar, studioViewport];
    const scriptButtons = [saveBtn];
    const studioButtons = [studioNewBtn, studioLoadBtn, studioExportBtn, studioPlayBtn, studioStopBtn, studioPublishBtn, studioAddBtn];

    if (mode === 'script') {
        scriptModePanels.forEach(el => el.style.display = '');
        studioModePanels.forEach(el => el.style.display = 'none');
        scriptButtons.forEach(el => el.style.display = '');
        studioButtons.forEach(el => el.style.display = 'none');
        bottomPanel.style.display = '';
        docsLink.href = sitePath('docs.html');
        docsLink.textContent = '📚 Script Docs';
    } else {
        scriptModePanels.forEach(el => el.style.display = 'none');
        studioModePanels.forEach(el => el.style.display = '');
        scriptButtons.forEach(el => el.style.display = 'none');
        studioButtons.forEach(el => el.style.display = '');
        bottomPanel.style.display = '';
        docsLink.href = sitePath('studio-docs.html');
        docsLink.textContent = '📚 Studio Docs';

        if (!_studioInitialized) {
            _studioInitialized = true;
            // Delay init so the container has layout
            requestAnimationFrame(() => {
                try {
                studio.initStudio(studio3DContainer, studioExplorerList, studioPropsContent);
                studio.setCallbacks({
                    onAddPart: (name, sw, sh, sd, colorHex, px, py, pz, anchored, shape) => {
                        studio.addPart(name, sw, sh, sd, colorHex, px, py, pz, anchored, shape);
                    },
                    onOpenScript: (scriptName) => {
                        const hScripts = studio.getScriptsFromHierarchy();
                        scripts = { ...scripts, ...hScripts };
                        if (scripts[scriptName]) {
                            switchMode('script');
                            selectScript(scriptName);
                        }
                    },
                    onScriptAction: (action, scriptName) => {
                        if (action === 'delete') {
                            if (!confirm(`Delete script "${scriptName}"?`)) return;
                            delete scripts[scriptName];
                            saveScriptsToStorage(scripts);
                            if (currentScript === scriptName) currentScript = null;
                            updateUI();
                        } else if (action === 'rename') {
                            const newName = prompt('New script name:', scriptName);
                            if (!newName || newName === scriptName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName)) return;
                            scripts[newName] = scripts[scriptName];
                            delete scripts[scriptName];
                            saveScriptsToStorage(scripts);
                            if (currentScript === scriptName) currentScript = newName;
                            updateUI();
                        } else if (action === 'create') {
                            showNewScriptInput();
                        }
                    },
                });
                
                studio.setChangeCallback(() => {
                    updateUI();
                });

                // Migrate existing editor scripts to hierarchy
                for (const [name, data] of Object.entries(scripts)) {
                    studio.addScriptToHierarchy(name, data.code || data);
                }
                
                // Refresh from hierarchy to ensure perfect sync
                const hScripts = studio.getScriptsFromHierarchy();
                scripts = hScripts;
                updateUI();
                } catch (e) {
                    console.error('Studio init error:', e);
                }
            });
        }
    }
}

function startStudioTest() {
    studioPlayBtn.style.display = 'none';
    studioStopBtn.style.display = 'block';
    studioSidebar.style.display = 'none';
    studioPropsPanel.style.display = 'none';
    
    // Ensure current editor code is saved to hierarchy before running
    if (currentScript) {
        const code = getCode();
        studio.updateScriptSource(currentScript, code);
    }
    
    addOutput('Starting test mode...', 'info');
    studio.startTestMode();
}

function stopStudioTest() {
    studioPlayBtn.style.display = 'block';
    studioStopBtn.style.display = 'none';
    studioSidebar.style.display = 'block';
    studioPropsPanel.style.display = 'block';
    
    addOutput('Stopped test mode.', 'info');
    studio.stopTestMode();
}

function getCode() {
    return codeEditor.textContent;
}

function setCode(code, rehighlight = true) {
    if (rehighlight) {
        try {
            const result = hljs.highlight(code, { language: 'lua', ignoreIllegals: true });
            codeEditor.innerHTML = result.value;
        } catch (e) {
            codeEditor.textContent = code;
        }
    } else {
        codeEditor.textContent = code;
    }
}

function saveCursorPosition() {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(codeEditor);
    preRange.setEnd(range.endContainer, range.endOffset);
    return preRange.toString().length;
}

function restoreCursorPosition(savedOffset) {
    const sel = window.getSelection();
    const range = document.createRange();
    let offset = 0;
    const walker = document.createTreeWalker(codeEditor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const len = node.textContent.length;
        if (offset + len >= savedOffset) {
            range.setStart(node, savedOffset - offset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
        offset += len;
    }
    range.selectNodeContents(codeEditor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
}

function updateUI() {
    // Sync any dirty code to hierarchy before refreshing from it
    if (_studioInitialized && isDirty && currentScript) {
        studio.updateScriptSource(currentScript, getCode());
        isDirty = false;
    }

    // If studio is initialized, sync scripts from hierarchy
    if (_studioInitialized) {
        const hScripts = studio.getScriptsFromHierarchy();
        
        // We want to keep any scripts that are in the hierarchy.
        // If a script is removed from hierarchy, it should be removed from our local object.
        // For now, we'll replace the local scripts with the hierarchy ones to ensure perfect sync.
        scripts = hScripts;

        // Ensure currentScript still exists
        if (currentScript && !scripts[currentScript]) {
            currentScript = Object.keys(scripts)[0] || null;
        }
    }

    updateScriptList();
    updateEditorTabs();

    if (currentScript && scripts[currentScript]) {
        setCode(scripts[currentScript].code || '');
        isDirty = false;
    } else {
        setCode('');
    }

    updateLineNumbers();
    updateSaveButton();
    clearErrors();
}

function updateScriptList() {
    scriptList.innerHTML = '';
    Object.keys(scripts).forEach(scriptName => {
        const item = document.createElement('div');
        item.className = `script-item ${scriptName === currentScript ? 'active' : ''}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'script-name';
        nameSpan.textContent = scriptName;
        nameSpan.addEventListener('click', () => selectScript(scriptName));
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            startRename(scriptName);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'script-delete';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Delete script';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteScript(scriptName);
        });

        item.appendChild(nameSpan);
        item.appendChild(deleteBtn);
        scriptList.appendChild(item);
    });
}

function startRename(scriptName) {
    const items = scriptList.children;
    let targetItem = null;
    for (const item of items) {
        const nameSpan = item.querySelector('.script-name');
        if (nameSpan && nameSpan.textContent === scriptName) {
            targetItem = item;
            break;
        }
    }
    if (!targetItem) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = scriptName;

    const nameSpan = targetItem.querySelector('.script-name');
    const deleteBtn = targetItem.querySelector('.script-delete');
    targetItem.replaceChild(input, nameSpan);

    input.focus();
    input.select();

    function finishRename() {
        const newName = input.value.trim();
        if (newName && newName !== scriptName) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName)) {
                addOutput('Script names can only contain letters, numbers, and underscores', 'error');
                updateUI();
                return;
            }
            if (scripts[newName]) {
                addOutput(`Script "${newName}" already exists`, 'error');
                updateUI();
                return;
            }
            scripts[newName] = scripts[scriptName];
            delete scripts[scriptName];
            if (currentScript === scriptName) {
                currentScript = newName;
            }
            saveScriptsToStorage(scripts);
        }
        updateUI();
    }

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') updateUI();
    });
}

function updateEditorTabs() {
    editorTabs.innerHTML = '';
    Object.keys(scripts).forEach(scriptName => {
        const tab = document.createElement('div');
        tab.className = `editor-tab ${scriptName === currentScript ? 'active' : ''}`;
        tab.textContent = scriptName;
        tab.addEventListener('click', () => selectScript(scriptName));
        editorTabs.appendChild(tab);
    });
}

function selectScript(scriptName) {
    if (currentScript === scriptName) return;
    if (isDirty && currentScript) {
        scripts[currentScript].code = getCode();
    }
    currentScript = scriptName;
    updateUI();
}

function handleCodeInput() {
    if (suppressHighlight) return;
    isDirty = true;
    updateLineNumbers();
    updateSaveButton();
    if (highlightRAF) cancelAnimationFrame(highlightRAF);
    const cursorPos = saveCursorPosition();
    highlightRAF = requestAnimationFrame(() => {
        highlightRAF = null;
        const code = getCode();
        
        // Sync to hierarchy if possible
        if (_studioInitialized && currentScript) {
            const hScripts = studio.getScriptsFromHierarchy();
            if (hScripts[currentScript]) {
                studio.updateScriptSource(currentScript, code);
            }
        }

        try {
            const result = hljs.highlight(code, { language: 'lua', ignoreIllegals: true });
            suppressHighlight = true;
            codeEditor.innerHTML = result.value;
            suppressHighlight = false;
        } catch (e) {}
        restoreCursorPosition(cursorPos);
        _updateAutocomplete();
    });
}

const LUA_KEYWORDS = [
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if',
    'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'
];

const ENGINE_GLOBALS = [
    { name: 'game', type: 'Class', isMethod: false },
    { name: 'workspace', type: 'Class', isMethod: false },
    { name: 'script', type: 'Class', isMethod: false },
    { name: 'Instance', type: 'Class', isMethod: false },
    { name: 'print', type: 'Function', isMethod: true },
    { name: 'warn', type: 'Function', isMethod: true },
    { name: 'wait', type: 'Function', isMethod: true },
    { name: 'spawn', type: 'Function', isMethod: true },
    { name: 'math', type: 'Class', isMethod: false },
    { name: 'table', type: 'Class', isMethod: false },
    { name: 'string', type: 'Class', isMethod: false }
];

const INSTANCE_MEMBERS = [
    { name: 'Parent', type: 'Property', isMethod: false },
    { name: 'Name', type: 'Property', isMethod: false },
    { name: 'ClassName', type: 'Property', isMethod: false },
    { name: 'Children', type: 'Property', isMethod: false },
    { name: 'Position', type: 'Property', isMethod: false },
    { name: 'Size', type: 'Property', isMethod: false },
    { name: 'Transparency', type: 'Property', isMethod: false },
    { name: 'Color', type: 'Property', isMethod: false },
    { name: 'Anchored', type: 'Property', isMethod: false },
    { name: 'CanCollide', type: 'Property', isMethod: false },
    { name: 'Transparency', type: 'Property', isMethod: false },
    { name: 'Destroy', type: 'Method', isMethod: true },
    { name: 'Clone', type: 'Method', isMethod: true },
    { name: 'GetChildren', type: 'Method', isMethod: true },
    { name: 'FindFirstChild', type: 'Method', isMethod: true },
    { name: 'WaitForChild', type: 'Method', isMethod: true },
    { name: 'IsA', type: 'Method', isMethod: true },
    { name: 'Connect', type: 'Method', isMethod: true }
];

function _updateAutocomplete() {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const textBefore = range.startContainer.textContent.substring(0, range.startOffset);
    
    const lastDot = textBefore.lastIndexOf('.');
    const lastColon = textBefore.lastIndexOf(':');
    const lastSpace = Math.max(textBefore.lastIndexOf(' '), textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\t'), textBefore.lastIndexOf('('));
    
    let query = '';
    let context = '';
    let type = 'word';
    let startPos = 0;

    if (lastDot > lastSpace && lastDot > lastColon) {
        context = textBefore.substring(lastSpace + 1, lastDot);
        query = textBefore.substring(lastDot + 1);
        type = 'dot';
        startPos = lastDot + 1;
    } else if (lastColon > lastSpace && lastColon > lastDot) {
        context = textBefore.substring(lastSpace + 1, lastColon);
        query = textBefore.substring(lastColon + 1);
        type = 'colon';
        startPos = lastColon + 1;
    } else {
        query = textBefore.substring(lastSpace + 1);
        type = 'word';
        startPos = lastSpace + 1;
    }

    if (query.length === 0 && type === 'word') {
        if (_autocompleteBox) _autocompleteBox.style.display = 'none';
        return;
    }

    _suggestions = [];
    if (type === 'dot') {
        const hierarchySuggestions = studio.getInstanceSuggestions(context);
        _suggestions = hierarchySuggestions.filter(s => s.name.toLowerCase().startsWith(query.toLowerCase()));
        if (_suggestions.length === 0) {
           _suggestions = INSTANCE_MEMBERS.filter(s => s.name.toLowerCase().startsWith(query.toLowerCase()));
        }
    } else if (type === 'colon') {
        _suggestions = INSTANCE_MEMBERS.filter(s => s.name.toLowerCase().startsWith(query.toLowerCase()) && s.isMethod);
    } else {
        _suggestions = [
            ...LUA_KEYWORDS.map(k => ({ name: k, type: 'Keyword', isMethod: false })),
            ...ENGINE_GLOBALS
        ].filter(s => s.name.toLowerCase().startsWith(query.toLowerCase()));
    }

    if (_suggestions.length > 0) {
        // If there's only one suggestion and it's an exact match, hide the box
        if (_suggestions.length === 1 && _suggestions[0].name === query) {
            if (_autocompleteBox) _autocompleteBox.style.display = 'none';
            return;
        }

        if (!_autocompleteBox) {
            _autocompleteBox = document.createElement('div');
            _autocompleteBox.style.cssText = `
                position: fixed; background: #1e1e1e; border: 1px solid #454545;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 10000;
                min-width: 150px; max-height: 200px; overflow-y: auto;
                border-radius: 4px; padding: 2px 0;
            `;
            document.body.appendChild(_autocompleteBox);
        }
        
        const rect = range.getBoundingClientRect();
        _autocompleteBox.style.left = rect.left + 'px';
        _autocompleteBox.style.top = (rect.bottom + 2) + 'px';
        
        _autocompleteContext = { 
            type, query, 
            range: { 
                startContainer: range.startContainer,
                startOffset: startPos,
                endOffset: range.startOffset
            }
        };
        
        _suggestionIndex = 0;
        _renderSuggestions();
    } else if (_autocompleteBox) {
        _autocompleteBox.style.display = 'none';
    }
}

function handleEditorKey(e) {
    if (e.key === 'Tab') {
        if (_autocompleteBox && _autocompleteBox.style.display !== 'none') {
            e.preventDefault();
            _confirmSuggestion();
            return;
        }
        e.preventDefault();
        document.execCommand('insertText', false, '\t');
        handleCodeInput();
    } else if (e.key === 'Enter' && !e.shiftKey) {
        if (_autocompleteBox && _autocompleteBox.style.display !== 'none') {
            e.preventDefault();
            _confirmSuggestion();
            return;
        }
        e.preventDefault();
        document.execCommand('insertLineBreak');
        handleCodeInput();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (_autocompleteBox && _autocompleteBox.style.display !== 'none') {
            e.preventDefault();
            _suggestionIndex = (e.key === 'ArrowDown') ? 
                (_suggestionIndex + 1) % _suggestions.length : 
                (_suggestionIndex - 1 + _suggestions.length) % _suggestions.length;
            _renderSuggestions();
        }
    } else if (e.key === 'Escape') {
        if (_autocompleteBox) _autocompleteBox.style.display = 'none';
    }
}

function _confirmSuggestion() {
    const suggestion = _suggestions[_suggestionIndex];
    if (!suggestion) return;
    
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    
    // Remove the current typing context
    const textNode = _autocompleteContext.range.startContainer;
    const startOffset = _autocompleteContext.range.startOffset;
    const endOffset = _autocompleteContext.range.endOffset;
    
    textNode.textContent = textNode.textContent.substring(0, startOffset) + 
                          suggestion.name + 
                          textNode.textContent.substring(endOffset);
    
    // Move cursor to end of inserted suggestion
    const newRange = document.createRange();
    newRange.setStart(textNode, startOffset + suggestion.name.length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    
    if (_autocompleteBox) _autocompleteBox.style.display = 'none';
    handleCodeInput();
}

function _renderSuggestions() {
    if (!_autocompleteBox) return;
    _autocompleteBox.innerHTML = '';
    
    if (_suggestions.length === 0) {
        _autocompleteBox.style.display = 'none';
        return;
    }
    
    _suggestions.forEach((s, i) => {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 4px 8px; cursor: pointer; display: flex; align-items: center; gap: 6px;
            background: ${i === _suggestionIndex ? '#007acc' : 'transparent'};
            color: ${i === _suggestionIndex ? '#fff' : '#ccc'};
            font-size: 12px; white-space: nowrap;
        `;
        
        const icon = document.createElement('span');
        icon.style.fontSize = '12px';
        const icons = {
            'method': '📦', 'property': '📝', 'keyword': '🔑', 'class': '🧱', 'instance': '🧱'
        };
        icon.textContent = s.isMethod ? icons.method : (icons[s.type.toLowerCase()] || icons.instance);
        if (s.type === 'Keyword') icon.textContent = icons.keyword;
        
        const name = document.createElement('span');
        name.textContent = s.name;
        
        item.appendChild(icon);
        item.appendChild(name);
        
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            _suggestionIndex = i;
            _confirmSuggestion();
        });
        
        item.addEventListener('mouseenter', () => {
            _suggestionIndex = i;
            _renderSuggestions();
        });
        
        _autocompleteBox.appendChild(item);
    });
    
    _autocompleteBox.style.display = 'block';
}

function handlePaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    handleCodeInput();
}

function syncLineNumbers() {
    lineNumbers.scrollTop = editorArea.scrollTop;
}

function updateLineNumbers() {
    const lines = getCode().split('\n').length;
    lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}

function updateSaveButton() {
    saveBtn.textContent = isDirty ? '💾 Save *' : '💾 Save';
    saveBtn.classList.toggle('dirty', isDirty);
}

function showNewScriptInput() {
    newScriptInput.style.display = 'block';
    newScriptActions.style.display = 'flex';
    newScriptBtn.style.display = 'none';
    newScriptInput.focus();
}

function hideNewScriptInput() {
    newScriptInput.style.display = 'none';
    newScriptActions.style.display = 'none';
    newScriptBtn.style.display = 'block';
    newScriptInput.value = '';
}

function createNewScript() {
    const name = newScriptInput.value.trim();
    if (!name) {
        alert('Please enter a script name');
        return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        alert('Script names must start with a letter or underscore and contain only letters, numbers, and underscores');
        return;
    }
    if (scripts[name]) {
        alert('A script with this name already exists');
        return;
    }

    if (_studioInitialized) {
        studio.addScriptToHierarchy(name, `-- ${name}\n\n`);
    } else {
        scripts[name] = { code: `-- ${name}\n\n` };
    }

    currentScript = name;
    hideNewScriptInput();
    updateUI();
    saveScriptsToStorage(scripts);
    addOutput(`Created new script "${name}"`, 'info');
}

function deleteScript(scriptName) {
    if (!confirm(`Delete "${scriptName}"?`)) return;
    
    if (_studioInitialized) {
        studio.removeScriptFromHierarchy(scriptName);
    } else {
        delete scripts[scriptName];
    }

    if (currentScript === scriptName) {
        const keys = Object.keys(scripts);
        currentScript = keys.length > 0 ? keys[0] : null;
    }
    updateUI();
    saveScriptsToStorage(scripts);
    addOutput(`Deleted script "${scriptName}"`, 'warn');
}

function saveScript() {
    if (!currentScript) return;
    scripts[currentScript].code = getCode();
    downloadScript(getCode(), currentScript + '.lua');
    isDirty = false;
    updateSaveButton();
    saveScriptsToStorage(scripts);
    addOutput(`Downloaded ${currentScript}.lua`, 'info');
}

function downloadScript(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function addOutput(message, type = 'info') {
    bottomPanel.classList.add('active');
    const line = document.createElement('div');
    line.className = `output-line output-${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    outputContainer.appendChild(line);
    outputContainer.scrollTop = outputContainer.scrollHeight;
    while (outputContainer.children.length > 100) {
        outputContainer.removeChild(outputContainer.firstChild);
    }
}

window.addOutput = addOutput;

function clearErrors() {
    document.querySelectorAll('.error-mark').forEach(el => el.remove());
}

function checkErrors() {
    clearErrors();
    const errors = lintLua(getCode());
    const area = document.querySelector('.editor-area');

    if (errors.length === 0) {
        const existingErrors = outputContainer.querySelectorAll('.output-error');
        existingErrors.forEach(el => el.remove());
        if (outputContainer.children.length === 0) {
            bottomPanel.classList.remove('active');
        }
        return;
    }

    bottomPanel.classList.add('active');

    const existingErrorLines = outputContainer.querySelectorAll('.output-error');
    existingErrorLines.forEach(el => el.remove());

    errors.forEach(err => {
        const lineEl = document.createElement('div');
        lineEl.className = 'output-line output-error';
        lineEl.textContent = `Line ${err.line}: ${err.message}`;
        outputContainer.appendChild(lineEl);

        if (area) {
            const mark = document.createElement('div');
            mark.className = 'error-mark';
            mark.style.top = `calc(12px + ${(err.line - 1) * 19.5}px)`;
            mark.title = err.message;
            area.appendChild(mark);
        }
    });

    outputContainer.scrollTop = outputContainer.scrollHeight;
}

function lintLua(code) {
    const errors = [];
    const lines = code.split('\n');
    const blockStack = [];
    const openers = ['function', 'if', 'for', 'while', 'do'];
    const parenLine = [], brackLine = [], braceLine = [];
    let paren = 0, brack = 0, brace = 0;

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const stripped = stripStringsAndComments(lines[i]);

        for (const ch of stripped) {
            if (ch === '(') { paren++; parenLine.push(lineNum); }
            if (ch === ')') { paren--; if (parenLine.length > 0) parenLine.pop(); }
            if (ch === '[') { brack++; brackLine.push(lineNum); }
            if (ch === ']') { brack--; if (brackLine.length > 0) brackLine.pop(); }
            if (ch === '{') { brace++; braceLine.push(lineNum); }
            if (ch === '}') { brace--; if (braceLine.length > 0) braceLine.pop(); }
        }

        const trimmed = stripped.trim();

        if (trimmed.startsWith('elseif') || trimmed.startsWith('else')) {
            continue;
        }

        for (const opener of openers) {
            const regex = new RegExp('\\b' + opener + '\\b(?!\\s*\\()');
            if (regex.test(trimmed) && !trimmed.startsWith('--')) {
                // Don't push 'do' to the block stack if it follows while/for on the same line
                if (opener === 'do' && /\b(while|for)\b/.test(trimmed)) break;
                blockStack.push({ keyword: opener, line: lineNum });
                break;
            }
        }

        // Check while/for missing "do"
        if (!trimmed.startsWith('--')) {
            const wm = trimmed.match(/\b(while|for)\b(?!\s*\()/);
            if (wm && !/\bdo\b/.test(trimmed)) {
                errors.push({ line: lineNum, message: `Missing "do" after "${wm[1]}"` });
            }
        }

        if (/\bend\b/.test(trimmed) && !trimmed.startsWith('--')) {
            const endCount = (trimmed.match(/\bend\b/g) || []).length;
            for (let e = 0; e < endCount; e++) {
                if (blockStack.length === 0) {
                    errors.push({ line: lineNum, message: 'Unexpected "end" (no block to close)' });
                } else {
                    blockStack.pop();
                }
            }
        }

        if (trimmed.includes('then') && !trimmed.startsWith('--') && !/\bif\b/.test(trimmed) && !/\belseif\b/.test(trimmed)) {
            errors.push({ line: lineNum, message: '"then" without matching "if"' });
        }
    }

    if (blockStack.length > 0) {
        blockStack.forEach(b => {
            errors.push({ line: b.line, message: `Missing "end" for "${b.keyword}" at line ${b.line}` });
        });
    }

    if (paren > 0) errors.push({ line: parenLine[0] || lines.length, message: `Missing ${paren} closing parenthesis ")"` });
    if (paren < 0) errors.push({ line: lines.length, message: `Missing ${-paren} opening parenthesis "("` });
    if (brack > 0) errors.push({ line: brackLine[0] || lines.length, message: `Missing ${brack} closing bracket "]"` });
    if (brack < 0) errors.push({ line: lines.length, message: `Missing ${-brack} opening bracket "["` });
    if (brace > 0) errors.push({ line: braceLine[0] || lines.length, message: `Missing ${brace} closing brace "}"` });
    if (brace < 0) errors.push({ line: lines.length, message: `Missing ${-brace} opening brace "{"` });

    return errors;
}

function stripStringsAndComments(line) {
    let result = line.replace(/--.*$/, '');
    result = result.replace(/"[^"]*"/g, '');
    result = result.replace(/'[^']*'/g, '');
    result = result.replace(/\[\[.*?\]\]/g, '');
    return result;
}


