local ROUND_TIME = 45
local PASS_DISTANCE = 8
local PASS_COOLDOWN = 1.2
local COMMAND_PREFIX = "TT"
local BAR_WIDTH = 360

local running = false
local holderId = ""
local holderName = ""
local timeLeft = 0
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

local startRound = function(id, name)
    ; running = true
    ; timeLeft = ROUND_TIME
    ; lastWholeSecond = -1
    setHolder(id, name)
    game:Broadcast("Time Tag: " .. holderName .. " has the time bomb. Run.")
end

local stopRound = function(message)
    ; running = false
    ; holderId = ""
    ; holderName = ""
    ; timeLeft = 0
    ; lastWholeSecond = -1
    game:Broadcast(message)
end

local updateGui = function()
    local localPlayer = game:GetLocalPlayer()
    local localId = ""
    if localPlayer then
        ; localId = localPlayer.id
    end

    local ratio = math.max(0, math.min(timeLeft / ROUND_TIME, 1))
    ; barFill.SizeX = BAR_WIDTH * ratio

    if running then
        if localId == holderId then
            ; title.Text = "YOU HAVE THE TIME BOMB - " .. tostring(math.ceil(timeLeft)) .. "s"
            ; barFill.BackgroundColor = 0xef4444
        else
            ; title.Text = holderName .. " has the time bomb - " .. tostring(math.ceil(timeLeft)) .. "s"
            ; barFill.BackgroundColor = 0x38bdf8
        end
    else
        ; title.Text = "Type /start to begin Time Tag"
        ; barFill.BackgroundColor = 0x38bdf8
    end
end

local tryPassBomb = function()
    local localPlayer = game:GetLocalPlayer()
    if localPlayer then
        if localPlayer.id == holderId then
            local now = game:GetGameTime()
            if now - lastPassTime >= PASS_COOLDOWN then
                local players = game:GetPlayers()
                local passed = false
                players:forEach(function(player)
                    if not passed and player.id ~= localPlayer.id then
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
                    startRound(parts[2], parts[3])
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
        end
    end

    if handled then
        return
    end

    if message == "/start" then
        if not data.local then
            return
        end

        if running then
            game:Broadcast("Time Tag: A round is already running.")
            return
        end

        local players = game:GetPlayers()
        if #players <= 0 then
            game:Broadcast("Time Tag: Need at least one player to start.")
            return
        end

        local starter = players[0]
        sendState("START|" .. starter.id .. "|" .. starter.name)
    end
end

local function onUpdate(dt)
    if running then
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
            if timeLeft <= 0 and localPlayer.id == holderId then
                sendState("BOOM|" .. holderName)
            end
        end
    end

    updateGui()
end

return {
    onChat = onChat,
    onUpdate = onUpdate,
}
