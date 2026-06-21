local parts = {}
local totalSpawned = 0
local MAX_ACTIVE_PARTS = 15
local SPAWN_INTERVAL = 5
local SPAWN_AREA = 100
local bestScores = {}

-- Upgrade system (server-wide — same for all players)
local upgrades = { spawnRate = 0, spawnLevel = 0 }
local playerCash = {} -- userId -> total cash
local CASH_PER_LEVEL = 5

local function getSpawnInterval()
    return math.max(0.5, SPAWN_INTERVAL - upgrades.spawnRate * 0.75)
end

local function getSpawnLevel()
    return 1 + upgrades.spawnLevel
end

local function getUpgradePrice(upgradeType)
    local level = upgrades[upgradeType] or 0
    return 100 * (level + 1)
end

local serializeParts = function()
    local chunks = {}
    for _, p in ipairs(parts) do
        if not p.destroyed and not p.heldBy then
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
    local x = math.random() * (SPAWN_AREA * 2) - SPAWN_AREA
    local z = math.random() * (SPAWN_AREA * 2) - SPAWN_AREA
    local name = "srv_" .. totalSpawned
    totalSpawned = totalSpawned + 1
    local r = math.random()
    local g = math.random()
    local b = math.random()
    table.insert(parts, {name = name, x = x, y = 0.5, z = z, level = getSpawnLevel(), cr = r, cg = g, cb = b, ry = 0, destroyed = false})
end

local countActive = function()
    local count = 0
    for _, p in ipairs(parts) do
        if not p.destroyed then count = count + 1 end
    end
    return count
end

local spawnTimer = function()
    if countActive() < MAX_ACTIVE_PARTS then
        spawnPart()
        broadcastState()
    end
    delay(getSpawnInterval(), spawnTimer)
end

local onGameStart = function()
    delay(getSpawnInterval(), spawnTimer)
end

local onPlayerJoin = function(player)
    broadcastState()
    game:SendChat("TT|MG|UPGRADE_STATE|" .. upgrades.spawnRate .. "|" .. upgrades.spawnLevel)
    local cash = playerCash[player.userId] or 0
    game:SendChat("TT|MG|CASH|" .. player.userId .. "|" .. cash)
    for uid, level in pairs(bestScores) do
        game:SendChat("TT|STAT|" .. uid .. "|Best|" .. level)
    end
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
            p.heldBy = data.userId
        end
        return
    end

    if cmd == "DROP" then
        local name = partsArr[3]
        if not name then return end
        local x = tonumber(partsArr[4])
        local y = tonumber(partsArr[5])
        local z = tonumber(partsArr[6])
        local level = tonumber(partsArr[7])
        local cr = tonumber(partsArr[8])
        local cg = tonumber(partsArr[9])
        local cb = tonumber(partsArr[10])
        local ry = tonumber(partsArr[11])
        local p = findPart(name)
        if p then
            p.x = x; p.y = y; p.z = z; p.level = level
            p.cr = cr; p.cg = cg; p.cb = cb; p.ry = ry
            p.destroyed = false; p.heldBy = nil
        else
            table.insert(parts, {name = name, x = x, y = y, z = z, level = level, cr = cr, cg = cg, cb = cb, ry = ry, destroyed = false})
        end
        return
    end

    if cmd == "MERGE" then
        local targetName = partsArr[3]
        local destroyedName = partsArr[4]
        if not targetName or not destroyedName then return end
        local x = tonumber(partsArr[5])
        local y = tonumber(partsArr[6])
        local z = tonumber(partsArr[7])
        local level = tonumber(partsArr[8])
        local cr = tonumber(partsArr[9])
        local cg = tonumber(partsArr[10])
        local cb = tonumber(partsArr[11])
        local ry = tonumber(partsArr[12])
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
        -- Award cash on merge (more cash for higher level merges)
        if level then
            local earned = level * CASH_PER_LEVEL
            playerCash[data.userId] = (playerCash[data.userId] or 0) + earned
            game:SendChat("TT|MG|CASH|" .. data.userId .. "|" .. playerCash[data.userId])
            -- Track best merge score
            local sb = bestScores[data.userId] or 0
            if level > sb then
                bestScores[data.userId] = level
                game:SendChat("TT|STAT|" .. data.userId .. "|Best|" .. level)
            end
        end
        return
    end

    if cmd == "UPGRADE" then
        local userId = partsArr[3]
        local upgradeType = partsArr[4]
        if not userId or not upgradeType then return end
        if upgradeType ~= "spawnRate" and upgradeType ~= "spawnLevel" then return end
        local price = getUpgradePrice(upgradeType)
        local cash = playerCash[userId] or 0
        if cash < price then return end
        playerCash[userId] = cash - price
        upgrades[upgradeType] = upgrades[upgradeType] + 1
        game:SendChat("TT|MG|UPGRADE_STATE|" .. upgrades.spawnRate .. "|" .. upgrades.spawnLevel)
        game:SendChat("TT|MG|CASH|" .. userId .. "|" .. playerCash[userId])
        return
    end
end

return { onGameStart = onGameStart, onPlayerJoin = onPlayerJoin, onChat = onChat }
