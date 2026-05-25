# BloxVerse Studio

BloxVerse Studio is the built-in 3D editor for creating and editing game worlds. It works alongside the Script Editor on the Create page.

---

## Getting Started

Open the **Studio** tab on the [Create](/bloxverse/create.html) page. The 3D viewport shows your game world. Use the Explorer on the left to see all parts, and the Properties panel on the right to edit the selected part.

### Default Map

When you open a new project, the world contains:
- **Baseplate** — A large green anchored block
- **Spawn** — A blue anchored block where players appear

---

## Tools

The toolbar at the top of the viewport provides these tools:

| Tool | Icon | Shortcut | Behavior |
|------|------|----------|----------|
| Select | Click (cursor) | **Q** | Click any part to select it |
| Move | Cross-arrows | **W** | Drag arrows to move a part along X/Y/Z |
| Rotate | Circle | **E** | Drag rings to rotate a part |
| Scale | Square with arrows | **R** | Drag handles to resize a part |

When using Move, Rotate, or Scale, click and drag the colored handles on the **gizmo** (the 3D widget) to transform the part. The red/green/blue handles correspond to X/Y/Z axes.

**Note:** In Move/Rotate/Scale mode, clicking on a different part in the viewport will **not** change your selection — you must switch to Select mode (Q) to pick a different part.

---

## Explorer Panel

The Explorer (left sidebar) has two sections:

### Parts
Lists every part in the world. Right-click a part to:
- **Delete** — Remove the part from the world
- **Add Object** → **Block / Sphere / Cylinder** — Create a new part

Left-click a part name to select it. Double-click to focus the camera on it.

### Scripts
Lists all scripts attached to the game. Right-click a script to:
- **Open** — Switch to the Script Editor tab and load the script
- **Rename** — Rename the script (names must start with a letter or underscore, and contain only letters, numbers, and underscores)
- **Delete** — Remove the script (asks for confirmation)
- **Add Object** → **Script** — Create a new empty script

Double-click a script to open it in the Script Editor.

---

## Properties Panel

The Properties panel (right sidebar) shows settings for the currently selected part:

| Property | Description |
|----------|-------------|
| **Name** | The part's name (must be unique) |
| **Shape** | Block, Sphere, or Cylinder |
| **Color** | RGB color of the part |
| **Transparency** | Slider from 0 (opaque) to 1 (invisible) |
| **Anchored** | When checked, the part is fixed in place and won't fall |
| **CanCollide** | When checked, players and other parts collide with this part |
| **Size** | Width, Height, and Depth in studs |
| **Position** | X, Y, Z world position (center of the part) |
| **Rotation** | Rotation in degrees around each axis |

---

## Undo / Redo

- **Ctrl+Z** — Undo the last action (part creation, deletion, move, resize, etc.)
- **Ctrl+Y** — Redo the last undone action

Undo history is maintained separately for the Studio and the Script Editor.

---

## Camera Controls

| Action | Mouse / Keyboard |
|--------|-----------------|
| Orbit | Left-click and drag on empty space |
| Pan | Right-click and drag |
| Zoom | Scroll wheel |
| Frame selected | Press **F** with a part selected |

When no part is selected, press **F** to frame the entire scene.

---

## Import / Export

- **Import** — Load a `.json` map file from your computer into the editor
- **Export** — Save the current map as a `.json` file

Map JSON format:
```json
[
  {
    "Name": "Baseplate",
    "Type": "Part",
    "Shape": "Block",
    "Position": [0, -1.6, 0],
    "Size": [320, 3.2, 320],
    "Rotation": [0, 0, 0],
    "Color": [0.3, 0.72, 0.29],
    "Anchored": true,
    "CanCollide": true,
    "Transparency": 0
  }
]
```

---

## Publishing

Click **Publish** in the toolbar to share your game with the world:

1. Enter a **Name** for your game
2. Select a **Genre**
3. Write a **Description**
4. Choose a **Thumbnail** — pick from preset images or upload your own
5. Click **Publish**

Your game will appear on the home page under **Community Games** and will be playable by anyone.

### Updating a Published Game

On the [game detail page](/bloxverse/game-detail.html), the author can:
- **Edit** — Change the name, description, genre, and thumbnail (re-uploads map data if it changed)
- **Delete** — Permanently remove the game

---

## Version History

All changes are tracked per script file with basic undo/redo. The studio uses a **full-snapshot** undo system — every modification saves the complete state of all parts.

---

## Keyboard Shortcuts Summary

| Shortcut | Action |
|----------|--------|
| **Q** | Select tool |
| **W** | Move tool |
| **E** | Rotate tool |
| **R** | Scale tool |
| **F** | Frame selected (or whole scene) |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** | Redo |
| **Delete** | Delete selected part |

---

## Tips

- Use **Anchored** parts for terrain, buildings, and static objects
- Use **un-anchored** parts for physics objects that can fall and collide
- The **Spawn** part with the name `SpawnLocation` determines where players appear when the game starts
- **CanCollide = false** is useful for trigger zones, decorations, or invisible barriers
- Name your parts descriptively to keep the Explorer organized
