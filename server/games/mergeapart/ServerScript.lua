local parts = {}
local totalSpawned = 0
local SPAWN_COUNT = 20
local SPAWN_AREA  = 100

local serializeParts = function()
    local chunks = {}
    for _, p in ipairs(parts) do
        if not p.destroyed then
            table.insert(chunks, p.name .. "," .. p.x .. "," .. p.y .. "," .. p.z .. "," .. p.level .. "," .. p.cr .. "," .. p.cg .. "," .. p.cb .. "," .. (p.ry or 0))
        end
    end
    local result = ""
    for _, s in ipairs(chunks) do
        if result ~= "" then result = result .. "|" end
        result = result .. s
    end
    return result
end

-- SendChat reaches all players via WebSocket; Broadcast is local-only
local broadcastState = function()
    game:SendChat("TT|MG|STATE|" .. serializeParts())
end

local findPart = function(name)
    for _, p in ipairs(parts) do
        if p.name == name then return p end
    end
    return nil
end

local spawnPart = function()
    local x    = math.random() * (SPAWN_AREA * 2) - SPAWN_AREA
    local z    = math.random() * (SPAWN_AREA * 2) - SPAWN_AREA
    local name = "srv_" .. totalSpawned
    totalSpawned = totalSpawned + 1
    local r = math.random()
    local g = math.random()
    local b = math.random()
    table.insert(parts, {name = name, x = x, y = 0.5, z = z, level = 1, cr = r, cg = g, cb = b, ry = 0, destroyed = false})
end

local onGameStart = function()
    for i = 1, SPAWN_COUNT do
        spawnPart()
    end
    broadcastState()
end

local onPlayerJoin = function(player)
    -- Send current state to all (new player will receive it too)
    broadcastState()
end

local onChat = function(player, message, data)
    local partsArr = message:split("|")
    if partsArr[0] ~= "TT" or partsArr[1] ~= "MG" then return end
    local cmd = partsArr[2]

    if cmd == "PICKUP" then
        local name = partsArr[3]
        if not name then return end
        local p = findPart(name)
        if p then
            -- Mark as held so STATE broadcasts don't include it
            p.heldBy = data.userId
            p.destroyed = true
        end
        -- No broadcastState needed — LocalScript.onChat handles PICKUP directly
        return
    end

    if cmd == "DROP" then
        local name  = partsArr[3]
        if not name then return end
        local x     = tonumber(partsArr[4])
        local y     = tonumber(partsArr[5])
        local z     = tonumber(partsArr[6])
        local level = tonumber(partsArr[7])
        local cr    = tonumber(partsArr[8])
        local cg    = tonumber(partsArr[9])
        local cb    = tonumber(partsArr[10])
        local ry    = tonumber(partsArr[11])
        local p = findPart(name)
        if p then
            p.x = x; p.y = y; p.z = z; p.level = level
            p.cr = cr; p.cg = cg; p.cb = cb; p.ry = ry
            p.destroyed = false; p.heldBy = nil
        else
            table.insert(parts, {name = name, x = x, y = y, z = z, level = level, cr = cr, cg = cg, cb = cb, ry = ry, destroyed = false})
        end
        -- No broadcastState — all clients handle DROP directly via onChat
        return
    end

    if cmd == "MERGE" then
        local targetName    = partsArr[3]
        local destroyedName = partsArr[4]
        if not targetName or not destroyedName then return end
        local x     = tonumber(partsArr[5])
        local y     = tonumber(partsArr[6])
        local z     = tonumber(partsArr[7])
        local level = tonumber(partsArr[8])
        local cr    = tonumber(partsArr[9])
        local cg    = tonumber(partsArr[10])
        local cb    = tonumber(partsArr[11])
        local ry    = tonumber(partsArr[12])
        local dp = findPart(destroyedName)
        if dp then dp.destroyed = true; dp.heldBy = nil end
        local tp = findPart(targetName)
        if tp then
            tp.x = x; tp.y = y; tp.z = z; tp.level = level
            tp.cr = cr; tp.cg = cg; tp.cb = cb; tp.ry = ry
            tp.destroyed = false; tp.heldBy = nil
        else
            table.insert(parts, {name = targetName, x = x, y = y, z = z, level = level, cr = cr, cg = cg, cb = cb, ry = ry, destroyed = false})
        end
        -- No broadcastState — all clients handle MERGE directly via onChat
        return
    end
end

return { onGameStart = onGameStart, onPlayerJoin = onPlayerJoin, onChat = onChat }