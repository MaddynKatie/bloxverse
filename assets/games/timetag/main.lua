local ROUND_TIME = 45
local PASS_DISTANCE = 2
local PASS_COOLDOWN = 1.2
local COMMAND_PREFIX = "TT"
local BAR_WIDTH = 360
local SPAWN_RADIUS = 50
local TELEPORT_MIN_Y = 20
local TELEPORT_MAX_Y = 40

local running = false
local holderId = ""
local holderName = ""
local timeLeft = 0
local initialTime = ROUND_TIME
local lastPassTime = 0
local lastWholeSecond = -1
local lastProtocol = ""

local ui = game:CreateScreenGui("TimeTagGui")
local title = ui:CreateGui("TextLabel", {
    Text = "Type /start to begin Time Tag",
    PositionX = 0.5,
    PositionY = 0.045,
    SizeX = 460,
    SizeY = 26,
    TextColor = 0xffffff,
    BackgroundColor = "transparent",
    BackgroundTransparency = 1,
    FontSize = 16,
    ZIndex = 20,
    Visible = true,
})
local barBack = ui:CreateGui("Frame", {
    PositionX = 0.5,
    PositionY = 0.085,
    SizeX = BAR_WIDTH,
    SizeY = 12,
    BackgroundColor = 0x111827,
    BackgroundTransparency = 0.15,
    ZIndex = 20,
    Visible = true,
})
local barFill = ui:CreateGui("Frame", {
    PositionX = 0.5,
    PositionY = 0.085,
    SizeX = 0,
    SizeY = 12,
    BackgroundColor = 0x38bdf8,
    BackgroundTransparency = 0,
    ZIndex = 21,
    Visible = true,
})

local sendState = function(command)
    game:SendChat(COMMAND_PREFIX .. "|" .. command)
end

local setHolder = function(id, name)
    ; holderId = id
    ; holderName = name
    ; lastPassTime = game:GetGameTime()
end

local teleportRandom = function()
    local x = math.floor(math.random() * (SPAWN_RADIUS * 2 + 1)) - SPAWN_RADIUS
    local z = math.floor(math.random() * (SPAWN_RADIUS * 2 + 1)) - SPAWN_RADIUS
    local y = math.floor(math.random() * (TELEPORT_MAX_Y - TELEPORT_MIN_Y + 1)) + TELEPORT_MIN_Y
    game:TeleportPlayer(x, y, z)
end

local flingPlayer = function()
    local x = math.floor(math.random() * 121) - 60
    local localPlayer = game:GetLocalPlayer()
    if localPlayer then
        game:SetPlayerVelocity(x, 200, 0)
    end
end

local startRound = function(id, name, time)
    ; running = true
    ; timeLeft = time or ROUND_TIME
    ; initialTime = timeLeft
    ; lastWholeSecond = -1
    setHolder(id, name)
    teleportRandom()
    game:Broadcast("Time Tag: " .. holderName .. " has the time bomb. Run.")
end

local stopRound = function(message)
    ; running = false
    ; holderId = ""
    ; holderName = ""
    ; timeLeft = 0
    ; initialTime = ROUND_TIME
    ; lastWholeSecond = -1
    game:Broadcast(message)
end

local updateGui = function()
    local localPlayer = game:GetLocalPlayer()
    local localId = ""
    if localPlayer then
        ; localId = localPlayer.id
    end

    local ratio = math.max(0, math.min(timeLeft / initialTime, 1))
    ; barFill.SizeX = BAR_WIDTH * ratio

    if running then
        if tostring(localId) == holderId then
            ; title.Text = "YOU HAVE THE TIME BOMB - " .. tostring(math.ceil(timeLeft)) .. "s"
            ; barFill.BackgroundColor = 0xef4444
        else
            ; title.Text = holderName .. " has the time bomb - " .. tostring(math.ceil(timeLeft)) .. "s"
            ; barFill.BackgroundColor = 0x38bdf8
        end
    else
        local playerCount = 0
        local players = game:GetPlayers()
        if players then
            for _, p in pairs(players) do
                playerCount = playerCount + 1
            end
        end
        if playerCount < 2 then
            ; title.Text = "Need 2+ players to start - " .. tostring(playerCount) .. " player" .. (playerCount == 1 and "" or "s")
        else
            ; title.Text = "Type /start to begin Time Tag"
        end
        ; barFill.BackgroundColor = 0x38bdf8
    end
end

local tryPassBomb = function()
    local localPlayer = game:GetLocalPlayer()
    if localPlayer then
        if tostring(localPlayer.id) == holderId then
            local now = game:GetGameTime()
            if now - lastPassTime >= PASS_COOLDOWN then
                local players = game:GetPlayers()
                local passed = false
                players:forEach(function(player)
                    if not passed and tostring(player.id) ~= tostring(localPlayer.id) then
                        local dx = localPlayer.x - player.x
                        local dy = localPlayer.y - player.y
                        local dz = localPlayer.z - player.z
                        local dist = math.sqrt((dx * dx) + (dy * dy) + (dz * dz))
                        if dist <= PASS_DISTANCE then
                            ; passed = true
                            ; lastPassTime = now
                            sendState("PASS|" .. localPlayer.id .. "|" .. localPlayer.name .. "|" .. player.id .. "|" .. player.name)
                        end
                    end
                end)
            end
        end
    end
end

local function onChat(player, message, data)
    local handled = false
    local parts = message:split("|")

    if parts[0] == COMMAND_PREFIX then
        ; handled = true
        if message ~= lastProtocol then
            ; lastProtocol = message
            local command = parts[1]

            if command == "START" then
                if not running then
                    local t = tonumber(parts[4])
                    startRound(parts[2], parts[3], t)
                end
            end

            if command == "TIME" then
                if running then
                    local t = tonumber(parts[2])
                    if t and t > 0 then
                        ; timeLeft = t
                        ; initialTime = t
                    end
                end
            end

            if command == "PASS" then
                if running then
                    setHolder(parts[4], parts[5])
                    game:Broadcast("Time Tag: " .. parts[3] .. " passed the bomb to " .. holderName .. ".")
                end
            end

            if command == "BOOM" then
                stopRound("Time Tag: BOOM. " .. parts[2] .. " ran out of time.")
            end

            if command == "END" then
                if running then
                    stopRound("Time Tag: Round ended by " .. parts[2] .. ".")
                end
            end
        end
    end

    if handled then
        return
    end

    local wordParts = message:split(" ")
    if wordParts[0] == "/start" then
        if not data.local then
            return
        end

        if running then
            game:Broadcast("Time Tag: A round is already running.")
            return
        end

        local players = game:GetPlayers()
        if #players < 2 then
            game:Broadcast("Time Tag: Need at least 2 players to start.")
            return
        end

        local rTime = ROUND_TIME
        local n = tonumber(wordParts[1])
        if n and n > 0 then
            ; rTime = n
        end

        local idx = math.floor(math.random() * #players)
        local tagger = players[idx]
        sendState("START|" .. tagger.id .. "|" .. tagger.name .. "|" .. tostring(rTime))
        ; running = true
        ; timeLeft = rTime
        ; initialTime = rTime
        ; lastWholeSecond = -1
        setHolder(tagger.id, tagger.name)
        teleportRandom()
        if rTime ~= ROUND_TIME then
            sendState("TIME|" .. tostring(rTime))
        end
    end

    if message == "/end" then
        if not data.local then
            return
        end

        if not running then
            return
        end

        sendState("END|" .. player.name)
    end
end

local function onUpdate(dt)
    if running then
        local players = game:GetPlayers()
        if #players < 2 then
            stopRound("Time Tag: Not enough players. Round ended.")
            updateGui()
            return
        end

        ; timeLeft = math.max(0, timeLeft - dt)
        local whole = math.ceil(timeLeft)
        if whole ~= lastWholeSecond then
            ; lastWholeSecond = whole
            if whole == 10 or whole == 5 or whole == 3 or whole == 2 or whole == 1 then
                game:Broadcast("Time Tag: " .. tostring(whole) .. " seconds left.")
            end
        end

        tryPassBomb()

        local localPlayer = game:GetLocalPlayer()
        if localPlayer then
            if timeLeft <= 0 and tostring(localPlayer.id) == holderId then
                sendState("BOOM|" .. holderName)
                flingPlayer()
                ; running = false
            end
        end
    end

    updateGui()
end

return {
    onChat = onChat,
    onUpdate = onUpdate,
}