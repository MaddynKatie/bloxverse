local PUNCH_RANGE = 5
local PUNCH_DAMAGE = 10
local PUNCH_COOLDOWN = 0.4
local lastPunchTime = 0
local wasQDown = false
local isPunching = false
local punchEndTime = 0
local playerStats = {}
local wasAlive = true
local lastAttackerId = nil
local reportDelayedKill

local function checkPunch()
    local isDown = game:IsKeyDown("KeyQ")
    local localPlayer = game:GetLocalPlayer()
    if not localPlayer then return end

    local now = os.clock()

    if isPunching and now >= punchEndTime then
        isPunching = false
    end

    if isDown and not wasQDown then
        if now - lastPunchTime >= PUNCH_COOLDOWN then
            lastPunchTime = now
            isPunching = true
            punchEndTime = now + 0.2

            local players = game:GetPlayers()
            local hit = false
            for _, other in pairs(players) do
                if other.id ~= localPlayer.id then
                    local dx = other.x - localPlayer.x
                    local dz = other.z - localPlayer.z
                    local dist = math.sqrt(dx * dx + dz * dz)
                    if dist <= PUNCH_RANGE then
                        hit = true
                        localPlayer:ShowPunchIndicator()
                        game:SendChat("TT|PUNCH|" .. other.id .. "|" .. tostring(PUNCH_DAMAGE) .. "|" .. tostring(localPlayer.id))
                    end
                end
            end
            if not hit then
                localPlayer:ShowMissIndicator()
            end
        end
    end
    wasQDown = isDown

    reportDelayedKill(localPlayer)

    if localPlayer.health > 0 then
        wasAlive = true
    end
end

local function onChat(player, message, data)
    local parts = message:split("|")
    if parts[0] == "TT" and parts[1] == "PUNCH" then
        local targetId = parts[2]
        local damage = tonumber(parts[3])
        local attackerId = parts[4]
        local localPlayer = game:GetLocalPlayer()
        if localPlayer and targetId == tostring(localPlayer.id) and damage and damage > 0 then
            lastAttackerId = attackerId
            localPlayer:Damage(damage)
            if localPlayer.health <= 0 and wasAlive then
                wasAlive = false
                game:SendChat("TT|STREAK|" .. tostring(localPlayer.id) .. "|0")
                if attackerId and attackerId ~= tostring(localPlayer.id) then
                    game:SendChat("TT|STAT|" .. attackerId .. "|Kills|+1")
                    game:SendChat("TT|STREAK|" .. attackerId .. "|+1")
                    game:SendChat("TT|FIN|" .. attackerId)
                    lastAttackerId = nil
                end
            end
        end
    end
    if parts[0] == "TT" and parts[1] == "FIN" then
        local attackerId = parts[2]
        local localPlayer = game:GetLocalPlayer()
        if localPlayer and attackerId == tostring(localPlayer.id) then
            localPlayer:ShowFinisherIndicator()
        end
    end
    if parts[0] == "TT" and parts[1] == "STAT" then
        local pid = parts[2]
        local statName = parts[3]
        local raw = parts[4]
        if pid and statName and raw then
            playerStats[pid] = playerStats[pid] or {}
            local current = playerStats[pid][statName] or 0
            local parsed = tonumber(raw)
            if raw:sub(1,1) == '+' and parsed then
                parsed = current + parsed
            else
                if not parsed then
                    parsed = raw
                end
            end
            playerStats[pid][statName] = parsed

            local localPlayer = game:GetLocalPlayer()
            if localPlayer and pid == tostring(localPlayer.id) and statName == "Kills" then
                localPlayer:ShowFinisherIndicator()
            end
        end
    end
    if parts[0] == "TT" and parts[1] == "STREAK" then
        local pid = parts[2]
        local raw = parts[3]
        if pid and raw then
            playerStats[pid] = playerStats[pid] or {}
            local current = playerStats[pid].Streak or 0
            local parsed = tonumber(raw)
            if raw:sub(1,1) == '+' and parsed then
                parsed = current + parsed
            else
                if not parsed then
                    parsed = raw
                end
            end
            playerStats[pid].Streak = parsed
        end
    end
end

reportDelayedKill = function(localPlayer)
    if wasAlive and localPlayer.health <= 0 then
        wasAlive = false
        game:SendChat("TT|STREAK|" .. tostring(localPlayer.id) .. "|0")
        if lastAttackerId and lastAttackerId ~= tostring(localPlayer.id) then
            game:SendChat("TT|STAT|" .. lastAttackerId .. "|Kills|+1")
            game:SendChat("TT|STREAK|" .. lastAttackerId .. "|+1")
            game:SendChat("TT|FIN|" .. lastAttackerId)
            lastAttackerId = nil
        end
    end
end

return {
    onUpdate = checkPunch,
    onChat = onChat,
}