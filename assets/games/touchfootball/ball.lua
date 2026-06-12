local ball = game:GetPart("PhysicsBall")
local ballInst = workspace:FindFirstChild("PhysicsBall")

local TEXTURES = {
    default = {
        texture = "assets/textures/ball.png",
        color   = nil,
    },
    adidastrionda = {
        texture = "assets/textures/fifaadidastrionda.png",
        color   = 0xFFFFFF,
    },
    shiny = {
        texture = "assets/textures/shinyball.png",
        color   = nil,
    },
    alrihla = {
        texture = "assets/textures/alrihla.jpg",
        color   = nil,
    },
}

local COMMAND_PREFIX = "TT"
local lastProtocol = ""

local applyTexture = function(entry)
    ball:SetTexture(entry.texture)
    if entry.color ~= nil then
        ballInst.Color = entry.color
    end
end

applyTexture(TEXTURES.default)

local function onChat(player, message, data)
    local parts = message:split("|")
    if parts[0] == COMMAND_PREFIX then
        if parts[1] == "SYSTEM" then
            game:Broadcast(parts[2])
            return
        end
        if message ~= lastProtocol then
            ; lastProtocol = message
            if parts[1] == "TEXTURE" then
                local entry = TEXTURES[parts[2]]
                if entry then
                    applyTexture(entry)
                end
            end
        end
        return
    end

    if not data.local then return end

    local wordParts = message:split(" ")
    if wordParts[0] ~= "/texture" and wordParts[0] ~= "/textures" then return end

    local listTextures = function()
        local names = {}
        for k, _ in pairs(TEXTURES) do
            table.insert(names, k)
        end
        table.sort(names)
        game:SendChat(COMMAND_PREFIX .. "|SYSTEM|Available textures: " .. table.concat(names, ", "))
    end

    if wordParts[0] == "/textures" then listTextures(); return end

    local texName = wordParts[1]
    if not texName or texName == "" then listTextures(); return end

    texName = string.lower(texName)
    local entry = TEXTURES[texName]
    if entry then
        applyTexture(entry)
        game:SendChat(COMMAND_PREFIX .. "|TEXTURE|" .. texName)
        game:SendChat(COMMAND_PREFIX .. "|SYSTEM|Ball texture changed to: " .. texName)
    else
        game:SendChat(COMMAND_PREFIX .. "|SYSTEM|Unknown texture \"" .. texName .. "\".")
        listTextures()
    end
end

local BOUNCE = 0.6
local BASE_KICK_POWER = 30

ball:SetBounciness(BOUNCE)

local BASE_KICK_UP = 15
local CHARGED_KICK_POWER = 75
local CHARGED_KICK_UP = 50
local CHARGE_TIME = 1.5
local WALK_SPEED = 16
local MAX_SPEED_BONUS = 3
local CURVE_EDGE_THRESHOLD = 2
local CURVE_POWER_MULTIPLIER = 50
local CURVE_DECAY = 2.0
local CURVE_CHARGE_BONUS = 6.0
local CURVE_SPRINT_BONUS = 3.0

local charge = 0
local METER_WIDTH = 220
local METER_HEIGHT = 14
local METER_Y = 0.82

local meterGui = game:CreateScreenGui("KickChargeGui")
local meterBack = meterGui:CreateGui("Frame", {
    PositionX = 0.5,
    PositionY = METER_Y,
    SizeX = METER_WIDTH,
    SizeY = METER_HEIGHT,
    BackgroundColor = 0x101820,
    BackgroundTransparency = 0.2,
    ZIndex = 10,
    Visible = false,
})
local meterFill = meterGui:CreateGui("Frame", {
    PositionX = 0.5,
    PositionY = METER_Y,
    SizeX = 0,
    SizeY = METER_HEIGHT,
    BackgroundColor = 0x35d07f,
    BackgroundTransparency = 0,
    ZIndex = 11,
    Visible = false,
})
local meterText = meterGui:CreateGui("TextLabel", {
    Text = "KICK 0%",
    PositionX = 0.5,
    PositionY = METER_Y - 0.035,
    SizeX = METER_WIDTH,
    SizeY = 22,
    TextColor = 0xffffff,
    BackgroundColor = "transparent",
    BackgroundTransparency = 1,
    FontSize = 13,
    ZIndex = 12,
    Visible = false,
})

local curvePower = 0
local curveDirX = 0
local curveDirZ = 0

local updateChargeGui = function()
    local chargeRatio = math.min(charge / CHARGE_TIME, 1)
    local isCharging = charge > 0
    local fillWidth = METER_WIDTH * chargeRatio
    ; meterBack.Visible = isCharging
    ; meterFill.Visible = isCharging
    ; meterText.Visible = isCharging
    ; meterFill.SizeX = fillWidth
    ; meterText.Text = "KICK " .. tostring(math.floor(chargeRatio * 100)) .. "%"
end

ballInst.Touched:Connect(function(hit)
    local char = game:GetCharacterData()
    if not char.moving then return end

    local facingX = math.sin(char.ry)
    local facingZ = math.cos(char.ry)
    local walkSpeed = game:GetWalkSpeed()
    local speedRatio = walkSpeed / WALK_SPEED
    local speedMult = speedRatio * MAX_SPEED_BONUS
    local chargeRatio = math.min(charge / CHARGE_TIME, 1)
    local basePower = BASE_KICK_POWER + ((CHARGED_KICK_POWER - BASE_KICK_POWER) * chargeRatio)
    local baseUp = BASE_KICK_UP + ((CHARGED_KICK_UP - BASE_KICK_UP) * chargeRatio)
    local power = basePower * speedMult
    local up = baseUp * speedMult

    ball:SetVelocity(facingX * power, up, facingZ * power)

    local bPos = ballInst.Position
    local bx = bPos.x or bPos.X or 0
    local bz = bPos.z or bPos.Z or 0
    local dx = bx - char.x
    local dz = bz - char.z
    local crossY = (facingZ * dx) - (facingX * dz)

    if math.abs(crossY) > CURVE_EDGE_THRESHOLD then
        local sprintBoost = 1 + ((speedRatio - 1) * CURVE_SPRINT_BONUS)
        local chargeBoost = 1 + (chargeRatio * CURVE_CHARGE_BONUS)
        local totalCurveBoost = sprintBoost * chargeBoost
        curvePower = (crossY > 0 and 1 or -1) * CURVE_POWER_MULTIPLIER * totalCurveBoost
    else
        curvePower = 0
    end

    curveDirX = facingZ
    curveDirZ = -facingX

    charge = 0
    updateChargeGui()
end)

local function onUpdate(dt)
    if game:IsKeyDown("KeyE") then
        ; charge = math.min(charge + dt, CHARGE_TIME)
    else
        ; charge = 0
    end
    updateChargeGui()

    if math.abs(curvePower) > 0.1 then
        local vel = ball:GetVelocity()
        if type(vel) == "table" then
            local vx = vel.x or vel.X or 0
            local vy = vel.y or vel.Y or 0
            local vz = vel.z or vel.Z or 0

            if vy > 0.2 or vy < -0.2 then
                ball:SetVelocity(vx + curveDirX * curvePower * dt, vy, vz + curveDirZ * curvePower * dt)
                curvePower = curvePower * (1 - dt * CURVE_DECAY)
            else
                curvePower = 0
            end
        end
    end
end

return {
    onUpdate = onUpdate,
    onChat   = onChat,
}