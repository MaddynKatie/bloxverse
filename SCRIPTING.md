# BloxVerse Scripting Documentation

Welcome to BloxVerse! This guide explains how to write scripts for your BloxVerse games. BloxVerse uses **Lua** scripting (like Roblox), but with some differences tailored to BloxVerse's architecture.

---

## Table of Contents
1. [Getting Started](#getting-started)
2. [Script Types](#script-types)
3. [Global Functions](#global-functions)
4. [Game Object](#game-object)
5. [Player Object](#player-object)
6. [The Instance Tree](#instance-tree)
7. [Part/Object System](#partobject-system)
8. [Key Press Detection](#key-press-detection)
9. [GUI System](#gui-system)
10. [Events and Signals](#events-and-signals)
11. [Networking & Multiplayer](#networking-multiplayer)
12. [Best Practices](#best-practices)
13. [Examples](#examples)
14. [FAQ](#faq)

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
-- Your script
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
Print messages to the server console and all players' chat.

```lua
print("Hello, world!")
print("Player count:", game:GetPlayers())
```

### `warn(...)`
Print a warning message (appears in yellow in logs).

```lua
warn("This might cause issues!")
```

### `error(message, [level])`
Throw an error and stop script execution.

```lua
error("Invalid configuration!")
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
Find a player by their user ID.

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

### `game:GetProperty(key)`
Get a game property (custom configuration).

```lua
local maxPlayers = game:GetProperty("maxPlayers")
local difficulty = game:GetProperty("difficulty")
```

### `game:SetProperty(key, value)`
Set a game property (shared across all players).

```lua
game:SetProperty("score", 100)
game:SetProperty("roundNumber", 2)
```

### `game:Broadcast(message)`
Send a message to all players' chat.

```lua
game:Broadcast("Game will end in 60 seconds!")
```

### `game:Fire(eventName, ...)`
Fire a custom event that can be listened to by scripts.

```lua
game:Fire("PlayerScored", player.id, 50)
```

### `game:IsKeyDown(keyCode)`
Check if a keyboard key is currently held down:

```lua
if game:IsKeyDown("Space") then
    print("Jumping!")
end
if game:IsKeyDown("ShiftLeft") then
    game:SetWalkSpeed(25)
end
```

### `game:SetWalkSpeed(speed)` / `game:GetWalkSpeed()`
Control the local player's walk speed in studs per second (default 16):

```lua
game:SetWalkSpeed(32)  -- Double speed
print("Current speed:", game:GetWalkSpeed())
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

#### `player:GetProperty(key)`
Get a player-specific property.

```lua
local score = player:GetProperty("score") or 0
```

#### `player:SetProperty(key, value)`
Set a player-specific property.

```lua
player:SetProperty("score", score + 50)
```

#### `player:Message(message)`
Send a message to this player only.

```lua
player:Message("Welcome to the game!")
```

#### `player:Teleport(x, y, z)`
Move player to a location.

```lua
player:Teleport(0, 10, 0)
```

#### `player:Damage(amount)`
Reduce player health.

```lua
player:Damage(10)
```

#### `player:Heal(amount)`
Increase player health.

```lua
player:Heal(20)
```

#### `player:Respawn()`
Respawn the player.

```lua
if player.health <= 0 then
    player:Respawn()
end
```

<a id="instance-tree"></a>
## The Instance Tree

Objects are organized in a hierarchy (Parent/Child relationship).

```lua
game.Workspace           -- Container for physical objects
game.Lighting            -- Container for environmental settings
game.ReplicatedStorage   -- Data shared between server and client
game.StarterGui          -- UI templates for players
game.Players             -- List of connected players
```

### Navigating the Hierarchy

You can use dot notation to traverse the tree, just like in Roblox:

```lua
local myPart = game.Workspace.Part1
local sky = game.Lighting.Sky
```

### Common Properties

All objects (Instances) have these properties:

- `Name`: The name of the object.
- `Parent`: The parent object in the tree.
- `ClassName`: The type of the object (e.g., "Part", "Script", "Folder").

```lua
print(game.Workspace.Name) -- "Workspace"
game.Workspace.Part1.Name = "NewName"
```

### Instance Methods

All objects support these methods for navigating and manipulating the hierarchy:

| Method | Description |
|--------|-------------|
| `instance:FindFirstChild(name, recursive)` | Returns the first child with the given name, or nil |
| `instance:GetChildren()` | Returns an array of all direct children |
| `instance:IsA(className)` | Returns true if the instance is of the given class |
| `instance:WaitForChild(name, timeout)` | Waits for a child to appear (async), with optional timeout |
| `instance:GetFullName()` | Returns the full hierarchy path (e.g. "Workspace.Part.SurfaceGui") |
| `instance:Destroy()` | Destroys the instance and all children |
| `instance:ClearAllChildren()` | Destroys all children of this instance |
| `instance:GetAttribute(name)` | Returns a custom attribute value |
| `instance:SetAttribute(name, value)` | Sets a custom attribute value |
| `instance:GetAttributes()` | Returns all custom attributes as a table |

```lua
-- Find a child by name
local part = game.Workspace:FindFirstChild("Baseplate")
if part then
    print("Found:", part:GetFullName())
end

-- Get all children
local objects = game.Workspace:GetChildren()
for _, obj in ipairs(objects) do
    print(obj.Name, obj.ClassName)
end

-- Check class type
if part:IsA("Part") then
    part.Color = Color3.fromRGB(255, 0, 0)
end

-- Wait for a child to appear
local gui = game.StarterGui:WaitForChild("ScreenGui")
print("ScreenGui found!")

-- Custom attributes
part:SetAttribute("Health", 100)
part:SetAttribute("Owner", "Player1")
print(part:GetAttribute("Health")) -- 100
```

### Constructors

Use `Instance.new(className)` to create new objects:

```lua
-- Parts and organization
local part = Instance.new("Part")
local folder = Instance.new("Folder")
local model = Instance.new("Model")

-- Scripts and audio
local script = Instance.new("Script")
local sound = Instance.new("Sound")

-- Lighting
local sky = Instance.new("Sky")
local atmosphere = Instance.new("Atmosphere")
local light = Instance.new("PointLight")

-- GUI
local screenGui = Instance.new("ScreenGui")
local surfaceGui = Instance.new("SurfaceGui")
local frame = Instance.new("Frame")
local label = Instance.new("TextLabel")
local button = Instance.new("TextButton")

-- Value objects (data storage, leaderstats)
local intVal = Instance.new("IntValue")
local strVal = Instance.new("StringValue")
local numVal = Instance.new("NumberValue")
local boolVal = Instance.new("BoolValue")

-- Players
local player = Instance.new("Player")
```

### Signals

| Signal | Fires When |
|--------|------------|
| `part.Touched` | Another part touches this part |
| `button.MouseButton1Click` | The button is clicked |
| `sound.Ended` | The sound finishes playing |
| `player.CharacterAdded` | A Character is assigned to the player |

```lua
-- Connect to part touch
local part = game.Workspace.Part
part.Touched:Connect(function(otherPart)
    print("Touched by:", otherPart.Name)
end)

-- Connect to button click
local button = game.StarterGui.ScreenGui.Button
button.MouseButton1Click:Connect(function()
    print("Button clicked!")
end)
```

---

<a id="partobject-system"></a>
## Part/Object System

Parts are physical objects in your game. In BloxVerse, everything is organized in a hierarchical tree starting from the `game` object.

### Classes and Properties

#### `Part`
A physical 3D object in the world.

- `Position`: Vector3 position.
- `Size`: Vector3 size.
- `Color`: The color of the part.
- `Anchored`: If true, the part stays in place and isn't affected by physics.
- `CanCollide`: If true, other objects will collide with this part.
- `Transparency`: 0 (opaque) to 1 (invisible).

```lua
local part = game.Workspace.Part
part.Color = Color3.fromRGB(255, 0, 0)
part.Anchored = true
```

#### `Lighting` Services

##### `Sky`
Controls the skybox and sun.

- `SkyboxColor`: The color of the sky background.
- `SunColor`: The color of the sun light.
- `Brightness`: The intensity of the sun light.
- `SunPosition`: The position of the sun in the sky.

```lua
local sky = game.Lighting.Sky
sky.SunColor = Color3.fromRGB(255, 200, 150)
sky.Brightness = 2.5
```

##### `Atmosphere`
Controls the fog and air effects.

- `Density`: How thick the fog is (0 to 1).
- `FogColor`: The color of the fog.
- `Offset`: Vertical offset for the fog effect.

```lua
local atm = game.Lighting.Atmosphere
atm.Density = 0.5
atm.FogColor = Color3.fromRGB(200, 200, 255)
```

#### Other Classes

- `Folder`: Used to organize objects in the explorer.
- `Sound`: Represents an audio track. Properties: `SoundId`, `Volume`, `Playing`, `Looped`.
- `PointLight`: A light source that shines in all directions. Properties: `Color`, `Brightness`, `Range`, `Shadows`.
- `Script`: A script object containing code.
- `SpawnLocation`: A special Part where players spawn.

### Creating Objects

Use `Instance.new(className)` to create a new object:

```lua
local folder = Instance.new("Folder")
folder.Name = "MyFolder"
folder.Parent = game.Workspace

local part = Instance.new("Part")
part.Name = "NewPart"
part.Size = Vector3.new(4, 4, 4)
part.Position = Vector3.new(0, 5, 0)
part.Anchored = false
part.Parent = workspace
```

When a Part is parented to the Workspace, it is automatically added to the physics world with a physical body. You can set properties like `Size`, `Position`, `Color`, `Transparency`, and `Anchored` either before or after parenting.

### Vector3

Used for 3D positions and sizes:

```lua
local pos = Vector3.new(10, 5, 0)
part.Position = pos
part.Size = Vector3.new(4, 8, 2)
print(part.Position.x, part.Position.y, part.Position.z)
```

### Color3

Used to represent colors:

```lua
local red = Color3.fromRGB(255, 0, 0)
part.Color = red

-- Also accepts hex numbers:
part.Color = 0xff4400
```

### Part Methods

#### `part:SetVelocity(x, y, z)`
Set the velocity of a dynamic (unanchored) part.

```lua
local ball = game:GetPart("Ball")
ball:SetVelocity(10, 5, 0)  -- Move the ball
```

#### `part:GetVelocity()`
Get a part's current velocity.

```lua
local vx, vy, vz = part:GetVelocity()
print("Speed:", math.sqrt(vx*vx + vy*vy + vz*vz))
```

#### `part:SetPosition(x, y, z)`
Teleport a part to a position (only for anchored parts).

```lua
local part = game:GetPart("MyPart")
part:SetPosition(0, 5, 0)
```

#### `part:GetPosition()`
Get a part's current position.

```lua
local x, y, z = part:GetPosition()
```

### Creating Parts at Runtime

You can create new parts and add them to the game world during gameplay.

#### `Instance.new("Part")`
Create a new part using the standard Instance system (like Roblox):

```lua
local part = Instance.new("Part")
part.Name = "MyPlatform"
part.Size = Vector3.new(10, 1, 10)
part.Position = Vector3.new(0, 5, 0)
part.Color = Color3.fromRGB(128, 128, 128)
part.Anchored = true
part.Parent = game.Workspace
```

Your new part appears in the world as soon as `.Parent` is set.

#### `game:GetPart(name)`
Find a part by name:

```lua
local platform = game:GetPart("MyPlatform")
if platform then
    print("Found platform at", platform.x, platform.y, platform.z)
end
```

#### `game:GetAllParts()`
Get a list of all parts currently in the world.

#### `game:RemovePart(name)`
Remove a part from the game world (including its physics body).

```lua
game:RemovePart("MyPlatform")
```

#### `game:IsKeyDown(keyCode)`
Check if a keyboard key is currently held down:

```lua
if game:IsKeyDown("Space") then
    print("Jumping!")
end
if game:IsKeyDown("ShiftLeft") then
    game:SetWalkSpeed(25)
end
```

### Part Properties

Each part has properties you can read and modify in real time.

| Property | Type | Description |
|----------|------|-------------|
| `part.Name` | string | The part's name |
| `part.Position` | Vector3 | Position as `{x, y, z}` object |
| `part.Size` | Vector3 | Size as `{x, y, z}` object |
| `part.Color` | number/Color3 | Color (hex like `0xff4400` or Color3) |
| `part.Transparency` | number | 0 (opaque) to 1 (invisible) |
| `part.Anchored` | boolean | If true, part doesn't move with physics |
| `part.CanCollide` | boolean | If true, other objects collide with it |
| `part.x` | number | X position (shorthand) |
| `part.y` | number | Y position (shorthand) |
| `part.z` | number | Z position (shorthand) |
| `part.width` | number | Width (X axis, shorthand) |
| `part.height` | number | Height (Y axis, shorthand) |
| `part.depth` | number | Depth (Z axis, shorthand) |
| `part.mass` | number | Physics mass (read-only if anchored) |

### Modifying Parts

Change part properties at runtime to create dynamic effects.

```lua
local platform = game:GetPart("MyPlatform")
if platform then
    -- Move the platform
    platform.Position = Vector3.new(10, 20, -5)

    -- Change color (hex)
    platform.Color = 0xff4400

    -- Make it semi-transparent
    platform.Transparency = 0.5

    -- Toggle physics
    platform.Anchored = false
end
```

### Animating Parts

Combine position and property changes in `onUpdate` to animate parts.

```lua
local time = 0

local function onUpdate(dt)
    time = time + dt

    -- Make a part bob up and down
    local part = game:GetPart("MyPart")
    if part then
        part.Position = Vector3.new(10, 10 + math.sin(time * 2) * 3, 0)

        -- Cycle color
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

Detect real-time keyboard input in your scripts using `game:IsKeyDown()`. This is useful for custom controls, ability triggers, or debug toggles.

### `game:IsKeyDown(keyCode)`

Returns `true` if the specified key is currently held down. Key codes follow the standard [KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code) values.

```lua
-- Movement keys
game:IsKeyDown("KeyW")       -- Forward
game:IsKeyDown("KeyA")       -- Left
game:IsKeyDown("KeyS")       -- Backward
game:IsKeyDown("KeyD")       -- Right

-- Action keys
game:IsKeyDown("Space")      -- Jump
game:IsKeyDown("ShiftLeft")  -- Shift lock toggle
game:IsKeyDown("KeyE")       -- Interact
game:IsKeyDown("KeyF")       -- Use

-- Arrow keys
game:IsKeyDown("ArrowUp")
game:IsKeyDown("ArrowDown")
game:IsKeyDown("ArrowLeft")
game:IsKeyDown("ArrowRight")
```

### Example: Sprint Mechanic

```lua
local function onUpdate(dt)
    local speed = game:GetWalkSpeed()
    if game:IsKeyDown("ShiftLeft") then
        game:SetWalkSpeed(28)  -- Sprint
    else
        game:SetWalkSpeed(16)  -- Normal walk
    end
end
```

### Example: Ability on Key Press (with cooldown)

```lua
local dashCooldown = 0

local function onUpdate(dt)
    dashCooldown = math.max(0, dashCooldown - dt)

    if game:IsKeyDown("KeyE") and dashCooldown <= 0 then
        game:Broadcast("Dashing!")
        game:SetWalkSpeed(48)
        dashCooldown = 3
        -- Reset speed after 0.5 seconds
        delay(0.5, function()
            game:SetWalkSpeed(16)
        end)
    end
end
```

---

<a id="gui-system"></a>
## GUI System

Create on-screen text labels, buttons, and containers from your scripts.

### `game:CreateScreenGui(name)`
Create a screen-wide canvas that holds your GUI elements. Returns a GUI container.

```lua
local gui = game:CreateScreenGui("MyGui")
```

### `gui:CreateGui(type, properties)`
Create a GUI element inside a ScreenGui. Supported types: `TextLabel`, `TextButton`, `Frame`.

```lua
local gui = game:CreateScreenGui("HUD")

-- Text label
local label = gui:CreateGui("TextLabel", {
    Text = "Score: 0",
    PositionX = 0.5,
    PositionY = 0.1,
    SizeX = 200,
    SizeY = 40,
    TextColor = "#ffffff",
    BackgroundColor = "#333333",
    FontSize = 18,
})

-- Button
local button = gui:CreateGui("TextButton", {
    Text = "Click Me",
    PositionX = 0.5,
    PositionY = 0.5,
    SizeX = 150,
    SizeY = 40,
    BackgroundColor = "#ff4400",
    TextColor = "#ffffff",
    FontSize = 16,
})
```

Position and size values between 0 and 1 are treated as **percentages** of the screen. Values > 1 are treated as **pixels**.

### GUI Properties

Read and modify these properties at any time:

| Property | Type | Description |
|----------|------|-------------|
| `element.Text` | string | The displayed text |
| `element.Visible` | boolean | Show/hide the element |
| `element.PositionX` | number | X position (0-1 = % of screen, >1 = px) |
| `element.PositionY` | number | Y position (0-1 = % of screen, >1 = px) |
| `element.SizeX` | number | Width (0-1 = % of screen, >1 = px) |
| `element.SizeY` | number | Height (0-1 = % of screen, >1 = px) |
| `element.TextColor` | string | CSS color (e.g. `"#ffffff"`, `"red"`) |
| `element.BackgroundColor` | string | CSS background color |
| `element.BackgroundTransparency` | number | 0 (opaque) to 1 (invisible) |
| `element.FontSize` | number | Font size in pixels |
| `element.ZIndex` | number | Stacking order |

```lua
-- Update properties at runtime
label.Text = "Score: 100"
label.PositionY = 0.2
label.BackgroundColor = "#444444"
```

### Events

Connect functions to GUI events using `:Connect()`:

```lua
button:Connect("click", function()
    game:Broadcast("Button clicked!")
end)

-- Common events: click, mouseenter, mouseleave, mousedown, mouseup
```

### Destroy

Remove a GUI element or entire screen when no longer needed:

```lua
-- Remove a single element
label:Destroy()

-- Remove entire GUI screen
gui:Destroy()
```

### Example: Interactive HUD

```lua
local gui = game:CreateScreenGui("HUD")
local score = 0

-- Score label
local scoreLabel = gui:CreateGui("TextLabel", {
    Text = "Score: 0",
    PositionX = 0.5,
    PositionY = 0.05,
    SizeX = 300,
    SizeY = 40,
    TextColor = "#ffffff",
    BackgroundColor = "transparent",
    FontSize = 24,
})

-- Instructions
local instruct = gui:CreateGui("TextLabel", {
    Text = "Press E to score a point",
    PositionX = 0.5,
    PositionY = 0.12,
    SizeX = 300,
    SizeY = 30,
    TextColor = "#aaaaaa",
    BackgroundColor = "transparent",
    FontSize = 14,
})

-- Button
local btn = gui:CreateGui("TextButton", {
    Text = "Reset",
    PositionX = 0.5,
    PositionY = 0.2,
    SizeX = 100,
    SizeY = 30,
    BackgroundColor = "#ff4400",
    TextColor = "#ffffff",
    FontSize = 14,
})

btn:Connect("click", function()
    score = 0
    scoreLabel.Text = "Score: 0"
    game:Broadcast("Score reset!")
end)

local function onUpdate(dt)
    if game:IsKeyDown("KeyE") then
        score = score + 1
        scoreLabel.Text = "Score: " .. score
    end
end

-- Clean up later if needed:
-- gui:Destroy()
-- or game:CleanupGui()
```

### `game:CleanupGui()`
Remove all script-created GUI elements at once.

```lua
game:CleanupGui()
```


<a id="events-and-signals"></a>
## Events and Signals

Scripts can listen to and respond to events.

### Built-in Events

#### `onGameStart()`
Called once when the game loads. Perfect for initialization.

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
Called every frame (60 times per second by default).
- `dt` = delta time in seconds

```lua
local function onUpdate(dt)
    -- Update game logic
    local players = game:GetPlayers()
    print("Frame update, players:", #players)
end
```

#### `onPlayerJoin(player)`
Called when a player joins the game.

```lua
local function onPlayerJoin(player)
    game:Broadcast(player.name .. " joined!")
    player:SetProperty("score", 0)
end
```

#### `onPlayerLeave(player)`
Called when a player leaves the game.

```lua
local function onPlayerLeave(player)
    game:Broadcast(player.name .. " left!")
end
```

### Custom Events

Fire custom events and listen to them:

```lua
-- In script 1: Fire an event
game:Fire("BossDefeated", bossName, timeElapsed)

-- In script 2: Listen to the event
game:On("BossDefeated", function(bossName, timeElapsed)
    print(bossName, "defeated in", timeElapsed, "seconds")
    game:Broadcast("Victory!")
end)
```

---

<a id="networking-multiplayer"></a>
## Networking & Multiplayer

BloxVerse is built for multiplayer. Scripts run on the server and sync with all players.

### Important: Execution Model

**All scripts run on each player's browser.** State is synced between players via the multiplayer system.

- Each player's browser runs the same scripts independently
- Player positions and physics are synced in real-time
- Game properties set with `game:SetProperty()` are local to each client

### Example: Multiplayer Scoring

```lua
local function onPlayerJoin(player)
    player:SetProperty("score", 0)
end

local function onUpdate(dt)
    local players = game:GetPlayers()
    for _, player in ipairs(players) do
        -- Check if player did something that earned points
        -- This would be triggered by player input or game logic
        local currentScore = player:GetProperty("score") or 0
        player:SetProperty("score", currentScore + 1)  -- Give 1 point per frame
    end
end

return {
    onGameStart = onGameStart,
    onUpdate = onUpdate,
    onPlayerJoin = onPlayerJoin,
}
```

---

<a id="best-practices"></a>
## Best Practices

### 1. Use Local Variables in Functions
```lua
-- Good
local function checkScore(player)
    local score = player:GetProperty("score") or 0
    return score > 100
end

-- Avoid
function checkScore(player)
    score = player:GetProperty("score") or 0
    return score > 100
end
```

### 2. Validate Player Actions
```lua
local function onPlayerAction(player, action)
    if not player then return end
    if action == "jump" then
        if player.health > 0 then
            -- Allow jump
        end
    end
end
```

### 3. Use Tables for Organization
```lua
local GameConfig = {
    MaxPlayers = 10,
    StartingHealth = 100,
    PointsPerKill = 50,
}

local function onGameStart()
    game:SetProperty("maxPlayers", GameConfig.MaxPlayers)
end
```

### 4. Handle Errors Gracefully
```lua
local success, err = pcall(function()
    local player = game:FindPlayer(userId)
    if player then
        player:Teleport(0, 10, 0)
    end
end)

if not success then
    warn("Error:", err)
end
```

### 5. Use Meaningful Names
```lua
-- Good
local isPlayerAlive = player.health > 0
local pointsEarned = 50

-- Avoid
local a = player.health > 0
local p = 50
```

---

<a id="examples"></a>
## Examples

### Example 1: Simple Respawner
```lua
local function onPlayerJoin(player)
    player:SetProperty("deaths", 0)
end

local function onUpdate(dt)
    local players = game:GetPlayers()
    for _, player in ipairs(players) do
        if player.health <= 0 then
            local deaths = (player:GetProperty("deaths") or 0) + 1
            player:SetProperty("deaths", deaths)
            wait(2)
            player:Respawn()
        end
    end
end

return {
    onPlayerJoin = onPlayerJoin,
    onUpdate = onUpdate,
}
```

### Example 2: Team System
```lua
local function onPlayerJoin(player)
    local teamNumber = math.random(1, 2)  -- Team 1 or 2
    player:SetProperty("team", teamNumber)
    local teamName = teamNumber == 1 and "Red" or "Blue"
    game:Broadcast(player.name .. " joined Team " .. teamName)
end

return {
    onPlayerJoin = onPlayerJoin,
}
```

### Example 3: Timed Game Mode
```lua
local GAME_DURATION = 300  -- 5 minutes

local function onGameStart()
    game:SetProperty("gameTime", 0)
    game:SetProperty("gameActive", true)
end

local function onUpdate(dt)
    if not game:GetProperty("gameActive") then return end
    
    local currentTime = (game:GetProperty("gameTime") or 0) + dt
    game:SetProperty("gameTime", currentTime)
    
    if currentTime >= GAME_DURATION then
        game:Broadcast("Game Over!")
        game:SetProperty("gameActive", false)
    end
end

return {
    onGameStart = onGameStart,
    onUpdate = onUpdate,
}
```

### Example 4: Score Tracker
```lua
local function onPlayerJoin(player)
    player:SetProperty("score", 0)
    player:Message("Welcome! Your score: " .. player:GetProperty("score"))
end

local function onUpdate(dt)
    -- Simulate score changes
    local players = game:GetPlayers()
    for _, player in ipairs(players) do
        local score = player:GetProperty("score") or 0
        -- Add points based on game logic
        player:SetProperty("score", score + 0.1)  -- 0.1 points per frame
    end
end

return {
    onPlayerJoin = onPlayerJoin,
    onUpdate = onUpdate,
}
```

---

## Performance Tips

1. **Cache frequently used values:**
   ```lua
   local players = game:GetPlayers()  -- Cache this
   for _, player in ipairs(players) do
       -- Use cached players list
   end
   ```

2. **Avoid expensive operations in onUpdate:**
   ```lua
   local lastCheck = 0
   local function onUpdate(dt)
       lastCheck = lastCheck + dt
       if lastCheck >= 1 then  -- Check every second
           lastCheck = 0
           -- Do expensive check
       end
   end
   ```

3. **Use local variables for closures:**
   ```lua
   local players = game:GetPlayers()
   spawn(function()
       wait(5)
       for _, player in ipairs(players) do
           -- Use captured players list
       end
   end)
   ```

---

---

## Math & Utility Functions

BloxVerse exposes standard Lua math and utility functions for use in your scripts.

### `math.random([m, n])`
Generate a random number. With no arguments returns a float in [0,1). With one argument returns an integer in [1, m]. With two arguments returns an integer in [m, n].

```lua
local randomFloat = math.random()       -- 0.0 to 1.0
local diceRoll = math.random(6)         -- 1 to 6
local range = math.random(10, 20)       -- 10 to 20
```

### `math.floor(x)` / `math.ceil(x)`
Round numbers down or up.

```lua
local score = 15.7
print(math.floor(score))  -- 15
print(math.ceil(score))   -- 16
```

### `math.clamp(value, min, max)`
Clamp a value between a minimum and maximum (inclusive).

```lua
local health = 150
health = math.clamp(health, 0, 100)  -- 100
```

### `math.abs(x)`
Return the absolute value of x.

### `table.insert(table, value)` / `table.remove(table, index)`
Insert or remove elements from a table.

```lua
local players = {}
table.insert(players, "Alice")
table.insert(players, "Bob")
table.remove(players, 1)  -- Removes Alice
```

### `string.sub(string, start, end)`
Extract a substring.

```lua
local name = "BloxVerse"
print(string.sub(name, 1, 4))  -- "Blox"
```

### `string.lower(string)` / `string.upper(string)`
Convert string case.

---

## Advanced Patterns

### Object-Oriented Programming

Create reusable class-like structures using Lua tables and metatables.

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
    if self.cooldown > 0 then
        return false
    end
    target:Damage(self.damage)
    self.cooldown = 1.0
    return true
end

function Weapon:Update(dt)
    if self.cooldown > 0 then
        self.cooldown = self.cooldown - dt
    end
end

-- Usage
local sword = Weapon.new("Sword", 25)
local bow = Weapon.new("Bow", 15)
```

### Module Pattern

Organize code by splitting logic into separate scripts that export functions.

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

function ScoreManager.reset(playerId)
    scores[playerId] = 0
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
    local players = game:GetPlayers()
    for _, player in ipairs(players) do
        local score = ScoreManager.get(player.id)
        if score >= 100 then
            game:Broadcast(player.name .. " wins!")
        end
    end
end
```

### State Machines

Use a state machine pattern to manage complex game states (menus, rounds, game over).

```lua
local GameState = {
    current = "waiting",
    states = {}
}

function GameState.setState(name)
    if GameState.states[GameState.current] and GameState.states[GameState.current].onExit then
        GameState.states[GameState.current]:onExit()
    end
    GameState.current = name
    if GameState.states[name] and GameState.states[name].onEnter then
        GameState.states[name]:onEnter()
    end
end

function GameState.register(name, state)
    GameState.states[name] = state
end

-- Register states
GameState.register("waiting", {
    onEnter = function()
        game:Broadcast("Waiting for players...")
    end,
    onUpdate = function(dt)
        local count = #game:GetPlayers()
        if count >= 2 then
            GameState.setState("playing")
        end
    end
})

GameState.register("playing", {
    onEnter = function()
        game:SetProperty("roundTime", 60)
    end,
    onUpdate = function(dt)
        local time = game:GetProperty("roundTime") or 60
        time = time - dt
        game:SetProperty("roundTime", time)
        if time <= 0 then
            GameState.setState("results")
        end
    end
})

GameState.register("results", {
    onEnter = function()
        game:Broadcast("Game over!")
    end
})
```

---

## Complete Game Example: Capture the Flag

This example combines multiple concepts into a working game.

```lua
-- CaptureTheFlag.lua
local FLAG_POSITION = { x = 0, y = 3, z = 20 }
local BASE_POSITION = { x = 0, y = 1, z = -20 }
local GAME_DURATION = 300

local scores = {}
local flagCarrier = nil

function onGameStart()
    game:SetProperty("gameTime", GAME_DURATION)
    game:SetProperty("flagAtBase", true)
    game:Broadcast("Capture the Flag started!")
end

function onPlayerJoin(player)
    scores[player.id] = 0
    player:SetProperty("hasFlag", false)
    player:Teleport(BASE_POSITION.x, BASE_POSITION.y, BASE_POSITION.z)
end

function onPlayerLeave(player)
    if flagCarrier == player.id then
        returnFlag()
    end
    scores[player.id] = nil
end

function onUpdate(dt)
    local timeLeft = game:GetProperty("gameTime") or GAME_DURATION
    timeLeft = timeLeft - dt
    game:SetProperty("gameTime", timeLeft)

    if timeLeft <= 0 then
        endGame()
        return
    end

    local players = game:GetPlayers()

    -- Check for flag capture
    for _, player in ipairs(players) do
        if player:GetProperty("hasFlag") then
            local dx = player.x - BASE_POSITION.x
            local dz = player.z - BASE_POSITION.z
            local dist = math.sqrt(dx * dx + dz * dz)

            if dist < 3 then
                scores[player.id] = (scores[player.id] or 0) + 1
                game:Broadcast(player.name .. " scored! Total: " .. scores[player.id])
                returnFlag()
            end
        end
    end
end

function returnFlag()
    flagCarrier = nil
    game:SetProperty("flagAtBase", true)
    for _, player in ipairs(game:GetPlayers()) do
        player:SetProperty("hasFlag", false)
    end
end

function onPlayerTouchFlag(player)
    if not game:GetProperty("flagAtBase") then return end
    if flagCarrier then return end

    flagCarrier = player.id
    player:SetProperty("hasFlag", true)
    game:SetProperty("flagAtBase", false)
    game:Broadcast(player.name .. " picked up the flag!")
end

function endGame()
    local winner = ""
    local highest = 0
    for id, score in pairs(scores) do
        if score > highest then
            highest = score
            winner = id
        end
    end

    if winner ~= "" then
        local player = game:FindPlayer(winner)
        if player then
            game:Broadcast(player.name .. " wins with " .. highest .. " captures!")
        end
    else
        game:Broadcast("No winner this round!")
    end

    game:SetProperty("gameActive", false)
end

return {
    onGameStart = onGameStart,
    onUpdate = onUpdate,
    onPlayerJoin = onPlayerJoin,
    onPlayerLeave = onPlayerLeave,
    onPlayerTouchFlag = onPlayerTouchFlag
}
```

---

<a id="leaderstats"></a>
## Leaderstats System

BloxVerse automatically tracks **leaderstats** for all players. To add leaderboards to your game:

1. Create a **Script** in **Workspace** (or attach one in Studio)
2. In the script, create a **Folder** named `"leaderstats"` inside the **Player**
3. Add **IntValue**, **StringValue**, **NumberValue**, or **BoolValue** children with the stat names

### Example

```lua
-- This would run when a player joins (connect to PlayerAdded)
local player = game.Players:GetChildren()[1] -- for testing

local stats = Instance.new("Folder")
stats.Name = "leaderstats"
stats.Parent = player

local coins = Instance.new("IntValue")
coins.Name = "Coins"
coins.Value = 0
coins.Parent = stats

local gems = Instance.new("IntValue")
gems.Name = "Gems"
gems.Value = 0
gems.Parent = stats

local guild = Instance.new("StringValue")
guild.Name = "Guild"
guild.Value = "None"
guild.Parent = stats
```

The leaderboard **automatically appears** in the top-right corner of the game window. Updating a leaderstat value instantly updates the display:

```lua
local stats = player:FindFirstChild("leaderstats")
if stats then
    local coins = stats:FindFirstChild("Coins")
    if coins then
        coins.Value = coins.Value + 10
    end
end
```

---

<a id="gui-system-roblox"></a>
## GUI System (Instance-based)

BloxVerse supports Roblox-style GUI using ScreenGui and SurfaceGui containers.

### ScreenGui (2D Overlay)
- Place inside **StarterGui**
- All child elements render as a fixed overlay on the screen
- **Enabled** property controls visibility

```lua
local gui = Instance.new("ScreenGui")
gui.Name = "HUD"
gui.Parent = game.StarterGui

local label = Instance.new("TextLabel")
label.Name = "ScoreLabel"
label.Text = "Score: 0"
label.Size = {200, 50}
label.Position = {0.5, 0.1}
label.Parent = gui
```

### SurfaceGui (3D Surface UI)
SurfaceGui renders on a part's surface in 3D space and follows the camera:

- Place inside a **Part** in Workspace, or set **Adornee** to the target part
- **Face** property: `Front`, `Back`, `Left`, `Right`, `Top`, `Bottom`
- **CanvasSize** controls the pixel dimensions of the surface

```lua
local part = game.Workspace.Part
local gui = Instance.new("SurfaceGui")
gui.Adornee = part
gui.Face = "Front"
gui.CanvasSize = {300, 200}
gui.Parent = part

local frame = Instance.new("Frame")
frame.Size = {300, 200}
frame.BackgroundColor = Color3.fromRGB(30, 30, 30)
frame.BackgroundTransparency = 0.3
frame.Parent = gui

local label = Instance.new("TextLabel")
label.Text = "Hello Surface!"
label.Size = {300, 50}
label.Position = {0, 80}
label.Parent = gui
```

### GUI Element Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Visible` | boolean | true | Show/hide the element |
| `BackgroundColor` | Color3 | varies | Background color |
| `BackgroundTransparency` | number (0-1) | 0 | 0 = opaque, 1 = invisible |
| `Position` | [x, y] | [0, 0] | Position (px or 0-1 fraction) |
| `Size` | [w, h] | varies | Size (px or 0-1 fraction) |
| `Text` | string | "Label" | Text content (TextLabel/TextButton) |
| `TextColor` | Color3 | white | Text color |
| `TextTransparency` | number (0-1) | 0 | 0 = solid text, 1 = invisible text |
| `FontSize` | number | 14 | Font size in pixels |

### BackgroundTransparency
Works exactly like Roblox:
- **0.0** = fully opaque background
- **0.5** = half transparent (background only, text stays solid)
- **1.0** = fully invisible (background doesn't render)

---

<a id="part-properties"></a>
## Part Properties Reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `Size` | [w, h, d] | [4, 4, 4] | Width, height, depth in studs |
| `Position` | [x, y, z] | [0, 0, 0] | World position |
| `Color` | Color3 | gray | Part color |
| `Transparency` | number (0-1) | 0 | 0 = solid, 1 = invisible |
| `Anchored` | boolean | true | If true, part doesn't move with physics |
| `CanCollide` | boolean | true | If true, other parts collide with it |
| `Shape` | string | "Block" | `Block`, `Sphere`, or `Cylinder` |

### Part Methods

| Method | Description |
|--------|-------------|
| `part:SetVelocity(x, y, z)` | Sets the part's velocity |
| `part:GetVelocity()` | Returns the current velocity as a Vector3 |

---

<a id="faq"></a>
## FAQ

### Q: Can I run scripts on the server?
**A:** All scripts currently run on each player's browser (client-side). Server-side scripting is planned for future versions.

### Q: How often does `onUpdate` run?
**A:** Approximately 60 times per second (60 FPS). The `dt` parameter tells you the actual delta time.

### Q: Are there data limits?
**A:** Yes. Keep properties reasonably sized. Storing massive amounts of data in properties can cause performance issues.

### Q: Can I use external APIs or HTTP requests?
**A:** Not from Lua scripts. For server-side integrations, contact the BloxVerse team.

### Q: What happens if my script has an error?
**A:** The script stops executing, and an error is logged. Other scripts continue running.

### Q: Can I delete or modify parts with scripts?
**A:** Yes. Use `Instance.new("Part")` to create parts and `game:RemovePart(name)` to delete them. All properties (position, size, color, transparency, anchored, velocity) can be modified at runtime.

### Q: How do I debug my scripts?
**A:** Use `print()` and `warn()` to output to the server console. Check the bottom panel in the script editor for output.

### Q: Can scripts communicate with each other?
**A:** Yes! Use `game:Fire()` and `game:On()` for custom events between scripts.

### Q: What's the difference between BloxVerse and Roblox scripting?
**A:** 
- BloxVerse uses a subset of Roblox APIs for simplicity
- `Instance.new()` works for creating Parts, Folders, Scripts, and more
- Part properties use `Position`/`Size` as Vector3 objects and `Color` as Color3/hex
- GUI/ScreenGui support is limited (planned for future)
- Networking is automatically handled

---

<a id="getting-help"></a>
## Getting Help

- Check the **View Scripting Docs** link in the script editor
- Review the examples above
- Test your code with `print()` statements
- Join the BloxVerse community for help

Happy scripting! 🚀
