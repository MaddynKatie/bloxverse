-- Static mimic — spawns far away facing the player, stands still

local RESPAWN_MIN = 30
local RESPAWN_MAX = 60
local SPAWN_MIN   = 80
local SPAWN_MAX   = 150
local DESPAWN_DIST = 10

local mimicRef = nil
local cooldown = 0

local createMimic = function()
    if mimicRef then return end
    local lp = game:GetLocalPlayer()
    if not lp then return end

    local angle = math.random() * 2 * 3.1415926535898
    local dist = SPAWN_MIN + math.random() * (SPAWN_MAX - SPAWN_MIN)
    local px = lp.x + math.sin(angle) * dist
    local pz = lp.z + math.cos(angle) * dist
    local py = lp.y or 0

    local mimic = game:CloneCharacter("Mimic", px, py, pz)
    if mimic then
        mimicRef = mimic
        local ry = math.atan2(lp.x - px, lp.z - pz)
        game:RotateCharacterClone(mimicRef, ry)
    end
end

local destroyMimic = function()
    if not mimicRef then return end
    game:RemoveCharacterClone(mimicRef)
    mimicRef = nil
    cooldown = RESPAWN_MIN + math.random() * (RESPAWN_MAX - RESPAWN_MIN)
end

local onUpdate = function(dt)
    if cooldown > 0 then
        cooldown = cooldown - dt
        return
    end

    if not mimicRef then
        -- ~5% chance each time cooldown elapses
        if math.random() > 0.05 then
            cooldown = 5
            return
        end
        createMimic()
        return
    end

    local pos = mimicRef.Position
    if not pos then
        destroyMimic()
        return
    end

    local players = game:GetPlayers()
    if #players == 0 then
        local lp = game:GetLocalPlayer()
        if lp then players = { lp } end
    end

    local nearDist2 = 999999
    local nearX = 0
    local nearZ = 0
    for _, p in ipairs(players) do
        local dx = p.x - pos.x
        local dz = p.z - pos.z
        local d2 = dx * dx + dz * dz
        if d2 < nearDist2 then
            nearDist2 = d2
            nearX = p.x
            nearZ = p.z
        end
    end

    if nearDist2 == 999999 then return end
    if math.sqrt(nearDist2) < DESPAWN_DIST then
        destroyMimic()
    end
end

local onChat = function(player, message)
    if message == "!mimic" then
        if mimicRef then destroyMimic() end
        cooldown = 0
        createMimic()
    end
end

return {
    onUpdate = onUpdate,
    onChat   = onChat,
}