# BloxVerse Scripting Documentation

Welcome to BloxVerse! This guide explains how to write scripts for your BloxVerse games. BloxVerse uses **Lua** scripting (like Roblox), but runs in the browser with some differences tailored to BloxVerse's architecture.

---

## Table of Contents
1. [Getting Started](#getting-started)
2. [Script Types](#script-types)
3. [Global Functions](#global-functions)
4. [Game Object](#game-object) — includes `TeleportPlayer`, `SetPlayerVelocity`, `GetPartPosition`, `GetCharacterData`
5. [Player Object](#player-object)
6. [The Instance Tree](#instance-tree)
7. [Part/Object System](#partobject-system)
8. [Key Press Detection](#key-press-detection)
9. [GUI System](#gui-system)
10. [Leaderstats System](#leaderstats)
11. [Events and Signals](#events-and-signals)
12. [Networking & Multiplayer](#networking-multiplayer)
13. [Math & Utility Functions](#math-utility)
14. [Advanced Patterns](#advanced-patterns)
15. [Best Practices](#best-practices)
16. [Examples](#examples)
17. [FAQ](#faq)

---

<a id="getting-started"></a>
## Getting Started

### Creating Your First Script

1. Click the **✨ Create** button in the top navigation
2. Click **+ New Script** to create a new script
3. Name your script (e.g., `GameLogic`, `SpawnSystem`)
4. Write your Lua code with live syntax highlighting
5. Click **💾 Save** to download your script as a `.lua` file

### Script Structure

Every script should export event handlers:

```lua
local function onGameStart()
    print("Game started!")
end

local function onUpdate(dt)
    -- Called every frame
    -- dt = delta time in seconds
end

-- Export your handlers
return {
    onGameStart = onGameStart,
    onUpdate = onUpdate,
    onPlayerJoin = onPlayerJoin,
    onPlayerLeave = onPlayerLeave,
}
```

---

<a id="script-types"></a>
## Script Types

BloxVerse supports different contexts where scripts run:

### Server Scripts
- Run on the server
- Have access to all game data and players
- Can modify game state
- **Recommended for:** Game logic, spawning, scoring, balance

### Client Scripts
- Run on each player's client (browser)
- Limited to local player information
- Used for UI and client-side effects
- **Recommended for:** HUD updates, sound effects, animations

### Local Scripts
- Run only on the local player's machine
- Similar to client scripts
- **Recommended for:** Input handling, local UI

**Default:** Scripts are **Server Scripts** unless specified otherwise.

---

<a id="global-functions"></a>
## Global Functions

### `print(...)`
Print messages to the console and chat output.

```lua
print("Hello, world!")
print("Player count:", #game:GetPlayers())
```

### `warn(...)`
Print a warning message (appears highlighted in logs).

```lua
warn("This might cause issues!")
```

### `error(message)`
Throw an error and stop script execution.

```lua
error("Invalid configuration!")
```

### `assert(value, message)`
Throw an error if `value` is falsy.

```lua
assert(player ~= nil, "Player must not be nil")
```

### `wait(seconds)`
Pause execution for N seconds.

```lua
wait(2.5)
print("2.5 seconds have passed")
```

### `spawn(function)`
Run a function asynchronously (non-blocking).

```lua
spawn(function()
    wait(1)
    print("This runs later")
end)
```

### `delay(seconds, function)`
Run a function after N seconds.

```lua
delay(3, function()
    print("Running after 3 seconds")
end)
```

### `pcall(function, ...)` / `xpcall(function, handler, ...)`
Call a function in protected mode; catches errors instead of crashing.

```lua
local ok, err = pcall(function()
    error("oops")
end)
if not ok then
    warn("Caught:", err)
end
```

### `tostring(value)` / `tonumber(value)`
Convert values to string or number.

```lua
print(tostring(42))     -- "42"
print(tonumber("3.14")) -- 3.14
```

### `type(value)`
Returns the Lua type of a value as a string: `"nil"`, `"boolean"`, `"number"`, `"string"`, `"table"`, `"function"`.

```lua
print(type(42))      -- "number"
print(type("hello")) -- "string"
print(type(nil))     -- "nil"
```

### `ipairs(table)` / `pairs(table)`
Iterate over arrays (`ipairs`) or all key-value pairs (`pairs`).

```lua
local fruits = {"apple", "banana", "cherry"}
for i, v in ipairs(fruits) do
    print(i, v)
end

local config = { speed = 16, health = 100 }
for k, v in pairs(config) do
    print(k, v)
end
```

### `unpack(table, [i, j])`
Expand a table into multiple return values.

```lua
local pos = {10, 20, 30}
local x, y, z = unpack(pos)
```

### `select(index, ...)`
Return arguments from index onwards, or `"#"` to get the count.

```lua
print(select(2, "a", "b", "c"))  -- b  c
print(select("#", "a", "b", "c")) -- 3
```

### `setmetatable(table, metatable)` / `getmetatable(table)`
Attach or retrieve a metatable (used for OOP patterns — see [Advanced Patterns](#advanced-patterns)).

---

<a id="game-object"></a>
## Game Object

The `game` object represents the current game instance.

### `game:GetPlayers()`
Returns a list of all active players.

```lua
local players = game:GetPlayers()
print("Player count:", #players)
for _, player in ipairs(players) do
    print(player.name)
end
```

### `game:FindPlayer(userId)`
Find a player by their user ID or username.

```lua
local player = game:FindPlayer("user123")
if player then
    print("Found:", player.name)
end
```

### `game:GetGameTime()`
Get elapsed time since game started (in seconds).

```lua
local timeElapsed = game:GetGameTime()
print("Game has been running for", timeElapsed, "seconds")
```

### `game:GetProperty(key)` / `game:SetProperty(key, value)`
Get or set a named game property. Values are local to each client.

```lua
game:SetProperty("score", 100)
game:SetProperty("roundNumber", 2)

local maxPlayers = game:GetProperty("maxPlayers")
```

### `game:Broadcast(message)`
Send a message to all players' chat.

```lua
game:Broadcast("Game will end in 60 seconds!")
```

### `game:Fire(eventName, ...)` / `game:On(eventName, callback)`
Fire and listen to custom events between scripts.

```lua
-- Fire an event
game:Fire("PlayerScored", player.id, 50)

-- Listen to it (can be in a different script)
game:On("PlayerScored", function(playerId, points)
    print("Player", playerId, "scored", points, "points")
end)
```

### `game:IsKeyDown(keyCode)`
Check if a keyboard key is currently held down. Uses [KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code) values.

```lua
if game:IsKeyDown("Space") then
    print("Jumping!")
end
if game:IsKeyDown("ShiftLeft") then
    game:SetWalkSpeed(25)
end
```

### `game:SetWalkSpeed(speed)` / `game:GetWalkSpeed()`
Control the local player's walk speed in studs per second (default: 16).

```lua
game:SetWalkSpeed(32)  -- Double speed
print("Current speed:", game:GetWalkSpeed())
```

### `game:GetPart(name)` / `game:GetAllParts()` / `game:RemovePart(name)`
Find, list, or remove parts from the world. Returns a **part proxy** with full physics methods (`SetVelocity`, `GetVelocity`, `SetPosition`, `GetPosition`).

```lua
local platform = game:GetPart("MyPlatform")
local allParts = game:GetAllParts()
game:RemovePart("MyPlatform")
```

> **Note:** `workspace:FindFirstChild(name)` returns a `PartInstance` (for signals like `Touched`), while `game:GetPart(name)` returns a part proxy (for physics methods). Use both together when needed — see [Touched Events on Unanchored Parts](#touched-unanchored).

### `game:GetPartPosition(name)`
Get the world position of a named part as `{x, y, z}`. Works on both anchored and unanchored parts.

```lua
local pos = game:GetPartPosition("SpawnPoint")
game:TeleportPlayer(pos.x, pos.y + 5, pos.z)
```

### `game:TeleportPlayer(x, y, z)`
Instantly move the local player to the given world coordinates.

```lua
-- Teleport to a named part's location
local pos = game:GetPartPosition("Field2")
game:TeleportPlayer(pos.x, pos.y + 5, pos.z)
```

### `game:SetPlayerVelocity(vx, vy, vz)`
Apply an instantaneous velocity to the local player, launching them with physics-based momentum. Horizontal velocity decays over time; vertical velocity is affected by gravity.

```lua
-- Launch the player upward and to the side (like a knockback/fling)
game:SetPlayerVelocity(30, 100, 0)

-- Apply only horizontal momentum (no vertical launch)
game:SetPlayerVelocity(-50, 0, 20)
```

### `game:GetCharacterData()`
Returns a table of the local player's current character state.

| Field | Type | Description |
|-------|------|-------------|
| `x, y, z` | number | World position |
| `ry` | number | Facing direction in radians |
| `moving` | boolean | True if player is pressing movement keys |
| `grounded` | boolean | True if player is on the ground |

```lua
local char = game:GetCharacterData()
local facingX = math.sin(char.ry)
local facingZ = math.cos(char.ry)
if char.moving then
    print("Player is running")
end
```

### `game:CreateScreenGui(name)`
Create a screen-wide GUI canvas for on-screen elements. See the [GUI System](#gui-system) section.

```lua
local gui = game:CreateScreenGui("HUD")
```

### `game:CleanupGui()`
Remove all GUI elements created by `game:CreateScreenGui` at once.

```lua
game:CleanupGui()
```

---

<a id="player-object"></a>
## Player Object

When you receive a player object, it has these properties and methods:

### Properties
```lua
player.id           -- User ID (string)
player.name         -- Display name (string)
player.x            -- Position X (number)
player.y            -- Position Y (number)
player.z            -- Position Z (number)
player.health       -- Current health (number)
player.maxHealth    -- Maximum health (number)
```

### Methods

#### `player:GetProperty(key)` / `player:SetProperty(key, value)`
Get or set a player-specific property.

```lua
local score = player:GetProperty("score") or 0
player:SetProperty("score", score + 50)
```

#### `player:Message(message)`
Send a message to this player only.

```lua
player:Message("Welcome to the game!")
```

#### `player:Teleport(x, y, z)`
Move the player to a location.

```lua
player:Teleport(0, 10, 0)
```

#### `player:Damage(amount)` / `player:Heal(amount)`
Reduce or increase player health.

```lua
player:Damage(10)
player:Heal(20)
```

#### `player:Respawn()`
Respawn the player.

```lua
if player.health <= 0 then
    player:Respawn()
end
```

---

<a id="instance-tree"></a>
## The Instance Tree

Objects are organized in a hierarchy (Parent/Child relationship), just like Roblox.

```lua
game.Workspace           -- Container for physical objects
game.Lighting            -- Container for environmental settings
game.ReplicatedStorage   -- Data shared between server and client
game.StarterGui          -- UI templates for players
game.Players             -- List of connected players
```

### Navigating the Hierarchy

Use dot notation to traverse the tree:

```lua
local myPart = game.Workspace.Part1
local sky = game.Lighting.Sky
```

### Common Properties

All instances have these properties:

- `Name` — the object's name
- `Parent` — its parent in the tree
- `ClassName` — the type, e.g. `"Part"`, `"Folder"`, `"TextLabel"`

```lua
print(game.Workspace.Name)     -- "Workspace"
game.Workspace.Part1.Name = "NewName"
```

### Instance Methods

| Method | Description |
|--------|-------------|
| `instance:FindFirstChild(name, recursive)` | First child with the given name, or nil |
| `instance:GetChildren()` | Array of all direct children |
| `instance:IsA(className)` | True if the instance is of the given class |
| `instance:WaitForChild(name, timeout)` | Waits (async) for a child to appear |
| `instance:GetFullName()` | Full hierarchy path, e.g. `"Workspace.Part"` |
| `instance:Destroy()` | Destroys the instance and all its children |
| `instance:ClearAllChildren()` | Destroys all children, keeps the instance |
| `instance:GetAttribute(name)` | Returns a custom attribute value |
| `instance:SetAttribute(name, value)` | Sets a custom attribute value |
| `instance:GetAttributes()` | Returns all custom attributes as a table |

```lua
local part = game.Workspace:FindFirstChild("Baseplate")
if part then
    print("Found:", part:GetFullName())
end

for _, obj in ipairs(game.Workspace:GetChildren()) do
    print(obj.Name, obj.ClassName)
end

if part:IsA("Part") then
    part.Color = Color3.fromRGB(255, 0, 0)
end

part:SetAttribute("Health", 100)
print(part:GetAttribute("Health"))  -- 100
```

### Constructors

Use `Instance.new(className)` to create new objects:

```lua
-- Parts and organization
local part     = Instance.new("Part")
local folder   = Instance.new("Folder")
local model    = Instance.new("Model")

-- Audio
local sound    = Instance.new("Sound")

-- Lighting
local sky      = Instance.new("Sky")
local atm      = Instance.new("Atmosphere")
local light    = Instance.new("PointLight")

-- GUI (Instance-based — see GUI System section)
local screenGui = Instance.new("ScreenGui")
local frame     = Instance.new("Frame")
local label     = Instance.new("TextLabel")
local button    = Instance.new("TextButton")

-- Value objects (used for leaderstats and data storage)
local intVal    = Instance.new("IntValue")
local strVal    = Instance.new("StringValue")
local numVal    = Instance.new("NumberValue")
local boolVal   = Instance.new("BoolValue")
```

### Signals

| Signal | Fires When |
|--------|------------|
| `part.Touched` | The local player touches this part |
| `button.MouseButton1Click` | The button is clicked |
| `sound.Ended` | The sound finishes playing |
| `player.CharacterAdded` | A Character is assigned to the player |

```lua
-- Anchored part touch (e.g. a teleport pad)
local pad = workspace:FindFirstChild("TeleportPad")
pad.Touched:Connect(function(hit)
    print("Player stepped on the pad!")
end)

local button = game.StarterGui.ScreenGui.Button
button.MouseButton1Click:Connect(function()
    print("Button clicked!")
end)
```

<a id="touched-unanchored"></a>
#### Touched Events on Unanchored Parts

Unanchored (physics) parts also support `Touched`. Retrieve the `PartInstance` via `workspace:FindFirstChild` for the signal, and use `game:GetPart` for physics methods.

```lua
-- Use FindFirstChild for the Touched signal
local ballInst = workspace:FindFirstChild("PhysicsBall")
-- Use GetPart for SetVelocity / GetVelocity
local ball = game:GetPart("PhysicsBall")

ballInst.Touched:Connect(function(hit)
    local char = game:GetCharacterData()
    local facingX = math.sin(char.ry)
    local facingZ = math.cos(char.ry)
    ball:SetVelocity(facingX * 60, 18, facingZ * 60)
end)
```

---

<a id="partobject-system"></a>
## Part/Object System

Parts are physical objects in your game world.

### Part Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Name` | string | — | The part's name |
| `Position` | Vector3 | `{0,0,0}` | World position |
| `Size` | Vector3 | `{4,4,4}` | Width, height, depth in studs |
| `Color` | Color3 / hex | gray | Part color |
| `Transparency` | number (0–1) | 0 | 0 = solid, 1 = invisible |
| `Anchored` | boolean | true | If true, physics won't move it |
| `CanCollide` | boolean | true | If true, other parts collide with it |
| `Shape` | string | `"Block"` | `"Block"`, `"Sphere"`, or `"Cylinder"` |
| `x`, `y`, `z` | number | — | Position shorthand |
| `width`, `height`, `depth` | number | — | Size shorthand |
| `mass` | number | — | Physics mass (read-only if anchored) |

### Creating Parts

```lua
local part = Instance.new("Part")
part.Name = "MyPlatform"
part.Size = Vector3.new(10, 1, 10)
part.Position = Vector3.new(0, 5, 0)
part.Color = Color3.fromRGB(128, 128, 128)
part.Anchored = true
part.Parent = game.Workspace  -- spawns in the world when parented
```

### Modifying Parts

```lua
local platform = game:GetPart("MyPlatform")
if platform then
    platform.Position = Vector3.new(10, 20, -5)
    platform.Color = 0xff4400       -- hex color
    platform.Transparency = 0.5
    platform.Anchored = false
end
```

### Part Methods

#### `part:SetVelocity(x, y, z)` / `part:GetVelocity()`
Set or get the velocity of an unanchored part.

```lua
local ball = game:GetPart("Ball")
ball:SetVelocity(10, 5, 0)

local vel = ball:GetVelocity()
print("Speed:", math.sqrt(vel.x^2 + vel.y^2 + vel.z^2))
```

#### `part:SetPosition(x, y, z)` / `part:GetPosition()`
Teleport a part or read its position.

```lua
part:SetPosition(0, 5, 0)
local pos = part:GetPosition()
print(pos.x, pos.y, pos.z)
```

### Vector3

```lua
local pos = Vector3.new(10, 5, 0)
part.Position = pos
part.Size = Vector3.new(4, 8, 2)
print(part.Position.x, part.Position.y, part.Position.z)
```

### Color3

```lua
local red = Color3.fromRGB(255, 0, 0)
part.Color = red

-- Hex shorthand
part.Color = 0xff4400

-- HSV
part.Color = Color3.fromHSV(0.6, 1, 1)
```

### Lighting Services

#### `Sky`
```lua
local sky = game.Lighting.Sky
sky.SunColor = Color3.fromRGB(255, 200, 150)
sky.Brightness = 2.5
-- Properties: SkyboxColor, SunColor, Brightness, SunPosition
```

#### `Atmosphere`
```lua
local atm = game.Lighting.Atmosphere
atm.Density = 0.5
atm.FogColor = Color3.fromRGB(200, 200, 255)
-- Properties: Density, FogColor, Offset
```

### Animating Parts

```lua
local time = 0

local function onUpdate(dt)
    time = time + dt

    local part = game:GetPart("MyPart")
    if part then
        part.Position = Vector3.new(10, 10 + math.sin(time * 2) * 3, 0)

        local r = math.floor(128 + 127 * math.sin(time))
        local g = math.floor(128 + 127 * math.sin(time + 2))
        local b = math.floor(128 + 127 * math.sin(time + 4))
        part.Color = Color3.fromRGB(r, g, b)
    end
end
```

---

<a id="key-press-detection"></a>
## Key Press Detection

Detect real-time keyboard input using `game:IsKeyDown()`. Key codes follow the [KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code) standard.

```lua
-- Movement
game:IsKeyDown("KeyW")       -- Forward
game:IsKeyDown("KeyA")       -- Left
game:IsKeyDown("KeyS")       -- Backward
game:IsKeyDown("KeyD")       -- Right

-- Actions
game:IsKeyDown("Space")      -- Jump
game:IsKeyDown("ShiftLeft")  -- Sprint / shift lock
game:IsKeyDown("KeyE")       -- Interact
game:IsKeyDown("KeyF")       -- Use

-- Arrows
game:IsKeyDown("ArrowUp")
game:IsKeyDown("ArrowDown")
game:IsKeyDown("ArrowLeft")
game:IsKeyDown("ArrowRight")
```

### Example: Sprint Mechanic

```lua
local function onUpdate(dt)
    if game:IsKeyDown("ShiftLeft") then
        game:SetWalkSpeed(28)
    else
        game:SetWalkSpeed(16)
    end
end
```

### Example: Ability with Cooldown

```lua
local dashCooldown = 0

local function onUpdate(dt)
    dashCooldown = math.max(0, dashCooldown - dt)

    if game:IsKeyDown("KeyE") and dashCooldown <= 0 then
        game:Broadcast("Dashing!")
        game:SetWalkSpeed(48)
        dashCooldown = 3
        delay(0.5, function()
            game:SetWalkSpeed(16)
        end)
    end
end
```

---

<a id="gui-system"></a>
## GUI System

BloxVerse supports two ways to create on-screen UI: the **imperative API** (`game:CreateScreenGui`) and the **instance-based API** (`Instance.new("ScreenGui")`). Both render to the same overlay and can be used in the same script.

---

### Imperative API

Quick and simple. Best for dynamic HUDs created at runtime.

#### `game:CreateScreenGui(name)`
Creates a screen-wide canvas. Returns a container with a `CreateGui` method.

#### `container:CreateGui(type, properties)`
Adds a GUI element. Supported types: `"TextLabel"`, `"TextButton"`, `"Frame"`.

```lua
local gui = game:CreateScreenGui("HUD")

local label = gui:CreateGui("TextLabel", {
    Text = "Score: 0",
    PositionX = 0.5,    -- 50% across the screen (centered)
    PositionY = 0.05,   -- 5% from the top
    SizeX = 300,        -- 300px wide
    SizeY = 40,         -- 40px tall
    TextColor = "#ffffff",
    BackgroundColor = "transparent",
    FontSize = 22,
})

local button = gui:CreateGui("TextButton", {
    Text = "Reset",
    PositionX = 0.5,
    PositionY = 0.15,
    SizeX = 120,
    SizeY = 36,
    BackgroundColor = "#ff4400",
    TextColor = "#ffffff",
    FontSize = 15,
})
```

**Position and size:** values between 0 and 1 are treated as a fraction of the screen. Values greater than 1 are treated as pixels.

#### GUI Element Properties

| Property | Type | Description |
|----------|------|-------------|
| `Text` | string | Displayed text (TextLabel / TextButton) |
| `Visible` | boolean | Show or hide the element |
| `PositionX` | number | X position (0–1 = % of screen width, >1 = px) |
| `PositionY` | number | Y position (0–1 = % of screen height, >1 = px) |
| `SizeX` | number | Width (0–1 = % of screen width, >1 = px) |
| `SizeY` | number | Height (0–1 = % of screen height, >1 = px) |
| `TextColor` | string / Color3 | Text color — CSS string or Color3 |
| `BackgroundColor` | string / Color3 | Background color |
| `BackgroundTransparency` | number (0–1) | 0 = opaque, 1 = invisible |
| `TextTransparency` | number (0–1) | 0 = solid text, 1 = invisible text |
| `FontSize` | number | Font size in pixels |
| `ZIndex` | number | Stacking order (higher = on top) |

All properties can be read and written at any time:

```lua
label.Text = "Score: 100"
label.Visible = false
label.BackgroundColor = "#444444"
```

#### Connecting Events

```lua
button:Connect("click", function()
    game:Broadcast("Clicked!")
end)

-- Available events: click, mouseenter, mouseleave, mousedown, mouseup
```

You can also use the Roblox signal style on TextButton elements:

```lua
button.MouseButton1Click:Connect(function()
    print("Button pressed!")
end)
```

#### Destroying Elements

```lua
label:Destroy()   -- removes just this element
gui:Destroy()     -- removes the whole ScreenGui
game:CleanupGui() -- removes all script-created GUIs at once
```

#### Full Example: Interactive HUD

```lua
local gui = game:CreateScreenGui("HUD")
local score = 0

local scoreLabel = gui:CreateGui("TextLabel", {
    Text = "Score: 0",
    PositionX = 0.5, PositionY = 0.05,
    SizeX = 300, SizeY = 40,
    TextColor = "#ffffff", BackgroundColor = "transparent",
    FontSize = 24,
})

local instrLabel = gui:CreateGui("TextLabel", {
    Text = "Press E to score",
    PositionX = 0.5, PositionY = 0.12,
    SizeX = 300, SizeY = 28,
    TextColor = "#aaaaaa", BackgroundColor = "transparent",
    FontSize = 14,
})

local resetBtn = gui:CreateGui("TextButton", {
    Text = "Reset",
    PositionX = 0.5, PositionY = 0.2,
    SizeX = 100, SizeY = 32,
    BackgroundColor = "#ff4400", TextColor = "#ffffff",
    FontSize = 14,
})

resetBtn:Connect("click", function()
    score = 0
    scoreLabel.Text = "Score: 0"
end)

local eWasDown = false
local function onUpdate(dt)
    local eDown = game:IsKeyDown("KeyE")
    if eDown and not eWasDown then
        score = score + 1
        scoreLabel.Text = "Score: " .. score
    end
    eWasDown = eDown
end

return { onUpdate = onUpdate }
```

---

### Instance-Based API

The Roblox-compatible approach. Use `Instance.new` to build GUIs as part of the instance tree. GUI elements automatically render to the screen when parented to a `ScreenGui` that is parented to `game.StarterGui`.

```lua
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "HUD"
screenGui.Parent = game.StarterGui  -- this mounts it to the overlay

local label = Instance.new("TextLabel")
label.Name = "ScoreLabel"
label.Text = "Score: 0"
label.Size = {200, 50}
label.Position = {0.5, 0.1}
label.FontSize = 18
label.Parent = screenGui            -- renders immediately

-- Updating text works directly:
label.Text = "Score: 10"
```

#### TextButton with Signal

```lua
local button = Instance.new("TextButton")
button.Text = "Click Me"
button.Size = {150, 40}
button.Position = {0.5, 0.5}
button.BackgroundColor = Color3.fromRGB(88, 101, 242)
button.Parent = screenGui

button.MouseButton1Click:Connect(function()
    print("Button was clicked!")
end)
```

#### Frame as a container

```lua
local frame = Instance.new("Frame")
frame.Size = {300, 200}
frame.Position = {0.5, 0.3}
frame.BackgroundColor = Color3.fromRGB(30, 30, 30)
frame.BackgroundTransparency = 0.3
frame.Parent = screenGui

local innerLabel = Instance.new("TextLabel")
innerLabel.Text = "Hello!"
innerLabel.Size = {280, 40}
innerLabel.Position = {10, 10}
innerLabel.Parent = frame
```

#### GUI Element Properties (Instance-based)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Text` | string | `"Label"` | Text content (TextLabel / TextButton) |
| `Visible` | boolean | true | Show / hide |
| `BackgroundColor` | Color3 | varies | Background color |
| `BackgroundTransparency` | number (0–1) | 0 | 0 = opaque, 1 = invisible |
| `TextColor` | Color3 | white | Text color |
| `TextTransparency` | number (0–1) | 0 | 0 = solid, 1 = invisible |
| `FontSize` | number | 14 | Font size in pixels |
| `Position` | `{x, y}` | `{0, 0}` | Position in pixels or 0–1 fraction |
| `Size` | `{w, h}` | varies | Size in pixels or 0–1 fraction |

All of these can be set at runtime and will update the display immediately:

```lua
label.Text = "Updated!"
label.Visible = false
label.BackgroundTransparency = 0.5
```

---

<a id="leaderstats"></a>
## Leaderstats System

BloxVerse automatically displays **leaderstats** in the player list. To show stats next to player names, create a `Folder` named `"leaderstats"` inside a player instance, then add value objects as children.

### Setup

```lua
local function onPlayerJoin(player)
    -- Find the player instance in the Players service
    local playerInst = game.Players:FindFirstChild(player.name)
    if not playerInst then return end

    local stats = Instance.new("Folder")
    stats.Name = "leaderstats"
    stats.Parent = playerInst

    local coins = Instance.new("IntValue")
    coins.Name = "Coins"
    coins.Value = 0
    coins.Parent = stats

    local kills = Instance.new("IntValue")
    kills.Name = "Kills"
    kills.Value = 0
    kills.Parent = stats

    local rank = Instance.new("StringValue")
    rank.Name = "Rank"
    rank.Value = "Rookie"
    rank.Parent = stats
end

return { onPlayerJoin = onPlayerJoin }
```

The stat columns appear automatically in the leaderboard panel on the right side of the screen. Updates to `.Value` are reflected within half a second.

### Updating Stats

```lua
local playerInst = game.Players:FindFirstChild(player.name)
if playerInst then
    local stats = playerInst:FindFirstChild("leaderstats")
    if stats then
        local coins = stats:FindFirstChild("Coins")
        if coins then
            coins.Value = coins.Value + 10
        end
    end
end
```

### Supported Value Types

| Class | Value type | Example use |
|-------|-----------|-------------|
| `IntValue` | integer | Kills, Coins, Score |
| `NumberValue` | float | Time, Distance |
| `StringValue` | string | Rank, Team, Guild |
| `BoolValue` | boolean | VIP, Alive |

---

<a id="events-and-signals"></a>
## Events and Signals

### Built-in Lifecycle Events

Export these from your script's `return` table to hook into the game loop:

#### `onGameStart()`
Called once when the game loads.

```lua
local function onGameStart()
    print("Game initialized!")
    game:SetProperty("score", 0)
end
```

#### `onGameEnd()`
Called when the game ends.

```lua
local function onGameEnd()
    game:Broadcast("Game Over!")
end
```

#### `onUpdate(dt)`
Called every frame (~60 times per second). `dt` is delta time in seconds.

```lua
local function onUpdate(dt)
    -- game logic here
end
```

#### `onPlayerJoin(player)` / `onPlayerLeave(player)`

```lua
local function onPlayerJoin(player)
    game:Broadcast(player.name .. " joined!")
end

local function onPlayerLeave(player)
    game:Broadcast(player.name .. " left.")
end
```

### Custom Events

```lua
-- Fire from one script
game:Fire("BossDefeated", bossName, timeElapsed)

-- Listen from another (or the same) script
game:On("BossDefeated", function(name, time)
    print(name, "defeated in", time, "seconds")
    game:Broadcast("Victory!")
end)
```

---

<a id="networking-multiplayer"></a>
## Networking & Multiplayer

**All scripts run on each player's browser.** BloxVerse does not have a traditional authoritative server — each client runs the same scripts independently.

- Player positions and physics are synced in real-time
- `game:SetProperty()` values are local to each client
- Use `game:Broadcast()` for visual messages visible to everyone

### Example: Multiplayer Scoring

```lua
local function onPlayerJoin(player)
    player:SetProperty("score", 0)
end

local function onUpdate(dt)
    for _, player in ipairs(game:GetPlayers()) do
        local s = (player:GetProperty("score") or 0) + dt
        player:SetProperty("score", s)
    end
end

return { onPlayerJoin = onPlayerJoin, onUpdate = onUpdate }
```

---

<a id="math-utility"></a>
## Math & Utility Functions

### Math

| Function | Description |
|----------|-------------|
| `math.random()` | Float in [0, 1) |
| `math.random(n)` | Integer in [1, n] |
| `math.random(m, n)` | Integer in [m, n] |
| `math.floor(x)` | Round down |
| `math.ceil(x)` | Round up |
| `math.clamp(v, min, max)` | Clamp value |
| `math.abs(x)` | Absolute value |
| `math.sqrt(x)` | Square root |
| `math.sin(x)` / `math.cos(x)` / `math.tan(x)` | Trig |
| `math.max(...)` / `math.min(...)` | Maximum / minimum |
| `math.huge` | Infinity |
| `math.pi` | π |

```lua
local roll = math.random(1, 6)
local health = math.clamp(health + 20, 0, 100)
local dist = math.sqrt(dx*dx + dy*dy + dz*dz)
```

### String

| Function | Description |
|----------|-------------|
| `string.format(fmt, ...)` | Printf-style formatting |
| `string.sub(s, i, j)` | Substring (1-indexed, negative from end) |
| `string.lower(s)` / `string.upper(s)` | Case conversion |
| `string.len(s)` | Length (same as `#s`) |
| `string.rep(s, n, sep)` | Repeat s n times |
| `string.reverse(s)` | Reverse a string |
| `string.byte(s, i)` | Byte value at index i |
| `string.char(...)` | Character from byte values |
| `string.find(s, pattern)` | Find a pattern, returns start/end index |
| `string.match(s, pattern)` | Return the matched substring |
| `string.gsub(s, pattern, repl)` | Global replace, returns new string + count |

```lua
local msg = string.format("Player %s scored %d points!", name, score)
local initials = string.sub(name, 1, 2)
print(string.upper("hello"))  -- "HELLO"
```

### Table

| Function | Description |
|----------|-------------|
| `table.insert(t, value)` | Append value to end |
| `table.insert(t, pos, value)` | Insert at position |
| `table.remove(t, pos)` | Remove at position (default: last) |
| `table.sort(t, fn)` | Sort in-place (optional comparator) |
| `table.concat(t, sep, i, j)` | Join elements into a string |
| `table.unpack(t, i, j)` | Expand table into values |

```lua
local items = {"apple", "cherry", "banana"}
table.sort(items)
print(table.concat(items, ", "))  -- apple, banana, cherry

table.insert(items, "date")
table.remove(items, 1)
```

---

<a id="advanced-patterns"></a>
## Advanced Patterns

### Object-Oriented Programming

BloxVerse supports Lua metatables and `setmetatable` for OOP.

```lua
local Weapon = {}
Weapon.__index = Weapon

function Weapon.new(name, damage)
    local self = setmetatable({}, Weapon)
    self.name = name
    self.damage = damage
    self.cooldown = 0
    return self
end

function Weapon:Attack(target)
    if self.cooldown > 0 then return false end
    target:Damage(self.damage)
    self.cooldown = 1.0
    return true
end

function Weapon:Update(dt)
    self.cooldown = math.max(0, self.cooldown - dt)
end

local sword = Weapon.new("Sword", 25)
```

### Numeric For Loops

```lua
-- Count up
for i = 1, 10 do
    print(i)
end

-- Count down
for i = 10, 1, -1 do
    print(i)
end

-- Custom step
for x = 0, 100, 10 do
    print(x)
end
```

### Repeat Until

```lua
local attempts = 0
repeat
    attempts = attempts + 1
until attempts >= 5 or game:GetProperty("ready")
```

### Module Pattern

Organize code by splitting into scripts that return tables of functions.

```lua
-- ScoreManager.lua
local ScoreManager = {}
local scores = {}

function ScoreManager.init(player)
    scores[player.id] = 0
end

function ScoreManager.add(playerId, points)
    scores[playerId] = (scores[playerId] or 0) + points
end

function ScoreManager.get(playerId)
    return scores[playerId] or 0
end

return ScoreManager
```

```lua
-- GameLogic.lua
local ScoreManager = require("ScoreManager")

local function onPlayerJoin(player)
    ScoreManager.init(player)
end

local function onUpdate(dt)
    for _, player in ipairs(game:GetPlayers()) do
        if ScoreManager.get(player.id) >= 100 then
            game:Broadcast(player.name .. " wins!")
        end
    end
end
```

### State Machines

```lua
local GameState = { current = "waiting", states = {} }

function GameState.setState(name)
    local cur = GameState.states[GameState.current]
    if cur and cur.onExit then cur:onExit() end
    GameState.current = name
    local next = GameState.states[name]
    if next and next.onEnter then next:onEnter() end
end

function GameState.register(name, state)
    GameState.states[name] = state
end

GameState.register("waiting", {
    onEnter = function() game:Broadcast("Waiting for players...") end,
    onUpdate = function(dt)
        if #game:GetPlayers() >= 2 then
            GameState.setState("playing")
        end
    end
})

GameState.register("playing", {
    onEnter = function() game:SetProperty("roundTime", 60) end,
    onUpdate = function(dt)
        local t = (game:GetProperty("roundTime") or 60) - dt
        game:SetProperty("roundTime", t)
        if t <= 0 then GameState.setState("results") end
    end
})

GameState.register("results", {
    onEnter = function() game:Broadcast("Round over!") end
})
```

---

<a id="best-practices"></a>
## Best Practices

### Use local variables

```lua
-- Good
local function checkScore(player)
    local score = player:GetProperty("score") or 0
    return score > 100
end
```

### Throttle expensive work in onUpdate

```lua
local checkTimer = 0

local function onUpdate(dt)
    checkTimer = checkTimer + dt
    if checkTimer >= 1 then
        checkTimer = 0
        -- run something expensive once per second
    end
end
```

### Validate before acting

```lua
local function onPlayerAction(player, action)
    if not player then return end
    if player.health <= 0 then return end
    -- proceed
end
```

### Catch errors with pcall

```lua
local ok, err = pcall(function()
    local player = game:FindPlayer(userId)
    if player then player:Teleport(0, 10, 0) end
end)
if not ok then warn("Error:", err) end
```

### Use tables for configuration

```lua
local Config = {
    MaxPlayers = 10,
    StartingHealth = 100,
    PointsPerKill = 50,
}
```

### Cache GetPlayers() in onUpdate

```lua
local function onUpdate(dt)
    local players = game:GetPlayers()
    for _, p in ipairs(players) do
        -- use cached list
    end
end
```

---

<a id="examples"></a>
## Examples

### Example 1: Teleporter Pads

```lua
local field1 = workspace:FindFirstChild("Field1")
local field2 = workspace:FindFirstChild("Field2")

field1.Touched:Connect(function(hit)
    local pos = game:GetPartPosition("Field2")
    game:TeleportPlayer(pos.x, pos.y + 5, pos.z)
end)

field2.Touched:Connect(function(hit)
    local pos = game:GetPartPosition("Field1")
    game:TeleportPlayer(pos.x, pos.y + 5, pos.z)
end)
```

> **Tip:** Make sure teleporter pads have `Anchored: true` in your map JSON — unanchored parts don't register as static colliders and won't fire `Touched` reliably.

### Example 2: Kickable Physics Ball

```lua
local ballInst = workspace:FindFirstChild("PhysicsBall")
local ball = game:GetPart("PhysicsBall")

local KICK_POWER    = 60
local KICK_UP       = 18
local MOVING_MULT   = 1.4
local STANDING_MULT = 0.8

ballInst.Touched:Connect(function(hit)
    local char = game:GetCharacterData()
    local facingX = math.sin(char.ry)
    local facingZ = math.cos(char.ry)
    local speedMult = char.moving and MOVING_MULT or STANDING_MULT
    ball:SetVelocity(facingX * KICK_POWER * speedMult, KICK_UP * speedMult, facingZ * KICK_POWER * speedMult)
end)
```

### Example 3: Simple Respawner

```lua
local function onPlayerJoin(player)
    player:SetProperty("deaths", 0)
end

local function onUpdate(dt)
    for _, player in ipairs(game:GetPlayers()) do
        if player.health <= 0 then
            local deaths = (player:GetProperty("deaths") or 0) + 1
            player:SetProperty("deaths", deaths)
            delay(2, function()
                player:Respawn()
            end)
        end
    end
end

return { onPlayerJoin = onPlayerJoin, onUpdate = onUpdate }
```

### Example 4: Team System with Leaderstats

```lua
local playerCount = 0

local function onGameStart()
    local p = game:GetLocalPlayer()
    if p then
        playerCount = playerCount + 1
        local teamNum = (playerCount % 2 == 1) and 1 or 2
        p:SetProperty("team", teamNum)
        local teamName = teamNum == 1 and "Red" or "Blue"
        game:Broadcast("You joined Team " .. teamName)
    end
end

local function onPlayerJoin(player)
    playerCount = playerCount + 1
    local teamNum = (playerCount % 2 == 1) and 1 or 2
    player:SetProperty("team", teamNum)
    local teamName = teamNum == 1 and "Red" or "Blue"
    game:Broadcast(player.name .. " joined Team " .. teamName)

    local playerInst = game.Players:FindFirstChild(player.name)
    if playerInst then
        local stats = Instance.new("Folder")
        stats.Name = "leaderstats"
        stats.Parent = playerInst

        local team = Instance.new("StringValue")
        team.Name = "Team"
        team.Value = teamName
        team.Parent = stats

        local score = Instance.new("IntValue")
        score.Name = "Score"
        score.Value = 0
        score.Parent = stats
    end
end

return { onPlayerJoin = onPlayerJoin }
```

### Example 5: Timed Game Mode with HUD

```lua
local GAME_DURATION = 300
local gui, timerLabel

local function onGameStart()
    game:SetProperty("gameTime", GAME_DURATION)
    game:SetProperty("gameActive", true)

    gui = game:CreateScreenGui("TimerHUD")
    timerLabel = gui:CreateGui("TextLabel", {
        Text = "5:00",
        PositionX = 0.5, PositionY = 0.03,
        SizeX = 160, SizeY = 36,
        TextColor = "#ffffff", BackgroundColor = "transparent",
        FontSize = 22,
    })
end

local function onUpdate(dt)
    if not game:GetProperty("gameActive") then return end

    local t = (game:GetProperty("gameTime") or 0) - dt
    game:SetProperty("gameTime", t)

    if timerLabel then
        local mins = math.floor(math.max(0, t) / 60)
        local secs = math.floor(math.max(0, t) % 60)
        timerLabel.Text = string.format("%d:%02d", mins, secs)
    end

    if t <= 0 then
        game:Broadcast("Time's up!")
        game:SetProperty("gameActive", false)
        if gui then gui:Destroy() end
    end
end

return { onGameStart = onGameStart, onUpdate = onUpdate }
```

### Example 6: Capture the Flag

```lua
local FLAG_POS   = { x = 0, y = 3, z = 20 }
local BASE_POS   = { x = 0, y = 1, z = -20 }
local GAME_TIME  = 300

local scores     = {}
local flagCarrier = nil

local function returnFlag()
    flagCarrier = nil
    game:SetProperty("flagAtBase", true)
    for _, p in ipairs(game:GetPlayers()) do
        p:SetProperty("hasFlag", false)
    end
end

local function endGame()
    local winner, highest = "", 0
    for id, s in pairs(scores) do
        if s > highest then highest = s; winner = id end
    end
    local p = winner ~= "" and game:FindPlayer(winner)
    if p then
        game:Broadcast(p.name .. " wins with " .. highest .. " captures!")
    else
        game:Broadcast("No winner this round!")
    end
    game:SetProperty("gameActive", false)
end

local function onGameStart()
    game:SetProperty("gameTime", GAME_TIME)
    game:SetProperty("flagAtBase", true)
    game:Broadcast("Capture the Flag started!")
end

local function onPlayerJoin(player)
    scores[player.id] = 0
    player:SetProperty("hasFlag", false)
    player:Teleport(BASE_POS.x, BASE_POS.y, BASE_POS.z)
end

local function onPlayerLeave(player)
    if flagCarrier == player.id then returnFlag() end
    scores[player.id] = nil
end

local function onUpdate(dt)
    local t = (game:GetProperty("gameTime") or GAME_TIME) - dt
    game:SetProperty("gameTime", t)
    if t <= 0 then endGame(); return end

    for _, player in ipairs(game:GetPlayers()) do
        if player:GetProperty("hasFlag") then
            local dx = player.x - BASE_POS.x
            local dz = player.z - BASE_POS.z
            if math.sqrt(dx*dx + dz*dz) < 3 then
                scores[player.id] = (scores[player.id] or 0) + 1
                game:Broadcast(player.name .. " scored! (" .. scores[player.id] .. ")")
                returnFlag()
            end
        end
    end
end

return {
    onGameStart = onGameStart,
    onUpdate = onUpdate,
    onPlayerJoin = onPlayerJoin,
    onPlayerLeave = onPlayerLeave,
}
```

---

<a id="faq"></a>
## FAQ

### Q: Can I run scripts on the server?
**A:** All scripts currently run on each player's browser (client-side). Server-side scripting is planned for a future update.

### Q: How often does `onUpdate` run?
**A:** Approximately 60 times per second. The `dt` parameter gives you the actual elapsed time so your logic stays frame-rate independent.

### Q: How do I update a TextLabel's text from a script?
**A:** Assign directly to `.Text` — `label.Text = "New text"`. This works with both the imperative API (`gui:CreateGui`) and the instance-based API (`Instance.new("TextLabel")`).

### Q: What's the difference between the two GUI APIs?
**A:** `game:CreateScreenGui` is simpler and better for dynamic HUDs built at runtime. `Instance.new("ScreenGui")` mirrors the Roblox hierarchy approach and is better when you want to build GUI as part of the instance tree. Both render to the same overlay.

### Q: How do leaderstats work?
**A:** Create a `Folder` named `"leaderstats"` inside a player instance under `game.Players`, then add `IntValue`, `StringValue`, etc. as children. The leaderboard panel updates automatically within ~500ms.

### Q: Are there data limits?
**A:** Yes. Keep properties small. Large amounts of data in properties can cause performance issues.

### Q: Can I use external APIs or HTTP requests?
**A:** Not from Lua scripts. For server-side integrations, contact the BloxVerse team.

### Q: What happens if my script has an error?
**A:** The error is logged to chat output. Other scripts continue running.

### Q: Can scripts communicate with each other?
**A:** Yes — use `game:Fire()` and `game:On()` to pass custom events between scripts.

### Q: What's the difference between BloxVerse and Roblox scripting?
**A:**
- BloxVerse uses a subset of Roblox APIs — most common patterns work
- `Instance.new()` supports Part, Folder, ScreenGui, TextLabel, TextButton, Frame, Value objects, and more
- `setmetatable` and OOP patterns are fully supported
- `for i = 1, 10 do` numeric loops and `repeat...until` both work
- `string.find`, `string.gsub`, `string.match`, `table.sort`, and `table.concat` are all available
- GUI renders to a DOM overlay; SurfaceGui (3D surface rendering) is not yet supported

---

## Getting Help

- Check the **View Scripting Docs** link in the script editor
- Review the examples above
- Use `print()` and `warn()` to debug — output appears in chat
- Join the BloxVerse community for support

Happy scripting! 🚀