# BloxVerse Scripting Documentation

Welcome to BloxVerse! This guide explains how to write scripts for your BloxVerse games. BloxVerse uses **Lua** scripting (like Roblox), but with some differences tailored to BloxVerse's architecture.

---

## Table of Contents
1. [Getting Started](#getting-started)
2. [Script Types](#script-types)
3. [Global Functions](#global-functions)
4. [Game Object](#game-object)
5. [Player Object](#player-object)
6. [Part/Object System](#partobject-system)
7. [Key Press Detection](#key-press-detection)
8. [GUI System](#gui-system)
9. [Events and Signals](#events-and-signals)
10. [Networking & Multiplayer](#networking-multiplayer)
11. [Best Practices](#best-practices)
12. [Examples](#examples)
13. [FAQ](#faq)

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

### Speed Control

#### `game:SetWalkSpeed(speed)`
Set the local player's movement speed in studs per second. Default is 16.

```lua
-- Double speed
game:SetWalkSpeed(32)

-- Slow motion
game:SetWalkSpeed(4)
```

#### `game:GetWalkSpeed()`
Returns the current walk speed.

```lua
local speed = game:GetWalkSpeed()
if speed > 20 then
    print("Moving fast!")
end
```

#### Example: Speed Power-Up

```lua
local powerUpTimer = 0
local hasPowerUp = false

local function onUpdate(dt)
    if hasPowerUp then
        powerUpTimer = powerUpTimer - dt
        if powerUpTimer <= 0 then
            game:SetWalkSpeed(16)
            hasPowerUp = false
            game:Broadcast("Speed boost expired!")
        end
    end
end

local function onPlayerTouchSpeedBoost()
    game:SetWalkSpeed(40)
    powerUpTimer = 10
    hasPowerUp = true
    game:Broadcast("Speed boost activated!")
end
```

---

<a id="partobject-system"></a>
## Part/Object System

Parts are physical objects in your game. You can interact with them through scripts.

### `game:GetPart(name)`
Find a part by name.

```lua
local platform = game:GetPart("Platform1")
if platform then
    print("Position:", platform.x, platform.y, platform.z)
end
```

### `game:GetAllParts()`
Get all parts in the game.

```lua
local parts = game:GetAllParts()
for _, part in ipairs(parts) do
    print(part.name)
end
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

#### `game:CreatePart(name, x, y, z, width, height, depth, color, transparency, anchored, mass)`
Create a new part at a position with specified dimensions. Returns the part object.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | Unique name for the part |
| `x` | number | 0 | X position |
| `y` | number | 0 | Y position |
| `z` | number | 0 | Z position |
| `width` | number | — | Width (X axis) |
| `height` | number | — | Height (Y axis) |
| `depth` | number | — | Depth (Z axis) |
| `color` | number | `0x808080` | Hex color (e.g. `0xff4400`) |
| `transparency` | number | `0` | 0 (opaque) to 1 (invisible) |
| `anchored` | boolean | `true` | If true, part doesn't move with physics |
| `mass` | number or `"auto"` | `"auto"` | Physics mass; `"auto"` calculates from size |

```lua
-- Simple part
local platform = game:CreatePart("MyPlatform", 0, 5, 0, 10, 1, 10)
if platform then
    print("Created platform at", platform.x, platform.y, platform.z)
end

-- Colored, semi-transparent, unanchored part with custom mass
local ball = game:CreatePart("MyBall", 0, 10, 0, 2, 2, 2, 0xff4400, 0.3, false, 5)
```

#### `game:RemovePart(name)`
Remove a part from the game world.

```lua
game:RemovePart("MyPlatform")
```

### Part Properties

Each part has properties you can read and modify in real time.

| Property | Type | Description |
|----------|------|-------------|
| `part.name` | string | The part's name |
| `part.x` | number | X position |
| `part.y` | number | Y position |
| `part.z` | number | Z position |
| `part.width` | number | Width (X axis) |
| `part.height` | number | Height (Y axis) |
| `part.depth` | number | Depth (Z axis) |
| `part.color` | string | Color as hex string (e.g. `"#ff4400"`) |
| `part.transparency` | number | 0 (opaque) to 1 (invisible) |
| `part.anchored` | boolean | If true, part doesn't move with physics |
| `part.mass` | number | Physics mass (read-only if anchored) |
| `part.canCollide` | boolean | If true, other objects collide with it |

### Modifying Parts

Change part properties at runtime to create dynamic effects.

```lua
local platform = game:GetPart("MyPlatform")
if platform then
    -- Move the platform
    platform.x = 10
    platform.y = 20
    platform.z = -5

    -- Change color
    platform.color = "#ff4400"

    -- Make it semi-transparent
    platform.transparency = 0.5

    -- Toggle physics
    platform.anchored = false
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
        part.y = 10 + math.sin(time * 2) * 3

        -- Cycle color
        local r = math.floor(128 + 127 * math.sin(time))
        local g = math.floor(128 + 127 * math.sin(time + 2))
        local b = math.floor(128 + 127 * math.sin(time + 4))
        part.color = string.format("#%02x%02x%02x", r, g, b)
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

### Important: Server Authority

**All scripts run on the server.** This prevents cheating and ensures consistency across all players.

- The server is the source of truth
- Client sends input, server validates and applies it
- Server broadcasts state changes to all clients

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

<a id="faq"></a>
## FAQ

### Q: Can I run scripts on the client (player's browser)?
**A:** Not yet. All scripts currently run on the server. Client-side scripting is planned for future versions.

### Q: How often does `onUpdate` run?
**A:** Approximately 60 times per second (60 FPS). The `dt` parameter tells you the actual delta time.

### Q: Are there data limits?
**A:** Yes. Keep properties reasonably sized. Storing massive amounts of data in properties can cause performance issues.

### Q: Can I use external APIs or HTTP requests?
**A:** Not from Lua scripts. For server-side integrations, contact the BloxVerse team.

### Q: What happens if my script has an error?
**A:** The script stops executing, and an error is logged. Other scripts continue running.

### Q: Can I delete or modify parts with scripts?
**A:** Modifying part properties (position, velocity) is supported. Creating/deleting parts requires engine support (planned).

### Q: How do I debug my scripts?
**A:** Use `print()` and `warn()` to output to the server console. Check the bottom panel in the script editor for output.

### Q: Can scripts communicate with each other?
**A:** Yes! Use `game:Fire()` and `game:On()` for custom events between scripts.

### Q: What's the difference between BloxVerse and Roblox scripting?
**A:** 
- BloxVerse uses fewer APIs for simplicity
- No `Instance` objects; properties are key-value pairs
- Player and part objects are simpler
- No GUI/ScreenGui system (UI is HTML/CSS based)
- Networking is automatically handled

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

## Troubleshooting

### Script won't save
- Make sure your script name has no special characters (only letters, numbers, underscores)
- Check that you're logged in

### `onUpdate` not running
- Verify your script exports the function correctly in the `return` table
- Check the output panel for syntax errors

### Player data not persisting
- Player properties are per-session and reset when the game restarts
- Use `game:SetProperty()` for global data that should persist for the round

### "Unexpected end" error
- Every `function`, `if`, `for`, `while`, and `do` must have a matching `end`
- Use the Lua linter in the script editor to find missing `end` statements

### Script runs but doesn't do anything
- Use `print()` statements to debug execution flow
- Check the output panel for error messages
- Make sure your script is assigned to the correct game

---

## Performance Tips (Advanced)

### Object Pooling
Reuse objects instead of creating new ones every frame to reduce garbage collection.

```lua
local bulletPool = {}

function getBullet()
    local bullet = table.remove(bulletPool)
    if not bullet then
        bullet = { x = 0, y = 0, z = 0, active = false }
    end
    bullet.active = true
    return bullet
end

function returnBullet(bullet)
    bullet.active = false
    table.insert(bulletPool, bullet)
end
```

### Throttling Expensive Operations
Spread expensive operations across multiple frames.

```lua
local updateIndex = 0

local function onUpdate(dt)
    local players = game:GetPlayers()
    updateIndex = updateIndex + 1

    -- Only process 5 players per frame
    local startIndex = updateIndex % 5
    for i = startIndex, math.min(startIndex + 4, #players) do
        local player = players[i]
        -- Expensive check on this player
    end
end
```

### Memory Management
Avoid creating large temporary tables in frequently called functions.

```lua
-- Avoid: Creates new table every frame
local function onUpdate(dt)
    local data = { x = 0, y = 0, z = 0 }
    -- Use data...
end

-- Better: Reuse table
local data = { x = 0, y = 0, z = 0 }
local function onUpdate(dt)
    data.x = 0
    data.y = 0
    data.z = 0
    -- Use data...
end
```

---

## Getting Help

- Check the **View Scripting Docs** link in the script editor
- Review the examples above
- Test your code with `print()` statements
- Join the BloxVerse community for help

Happy scripting! 🚀
