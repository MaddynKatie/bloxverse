local ball = game:GetPart("PhysicsBall")
local ballInst = workspace:FindFirstChild("PhysicsBall")

local BOUNCE = 0.6
local BASE_KICK_POWER = 30

ball:SetBounciness(BOUNCE)
local BASE_KICK_UP = 15
local CHARGED_KICK_POWER = 75
local CHARGED_KICK_UP = 50
local CHARGE_TIME = 1.5
local WALK_SPEED = 16
local MAX_SPEED_BONUS = 3
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
end

return {
    onUpdate = onUpdate,
}