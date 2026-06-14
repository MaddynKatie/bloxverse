-- Bot that plays soccer like a real player
-- Gravity: -196.2, Jump: 50, Walk: 16, Sprint: 25
-- Kick system mirrors ball.lua exactly

local bot = nil
local spawned = false
local velY = 0
local footOffset = 2
local groundY = 0
local botGrounded = false

-- movement
local WALK_SPEED   = 16
local SPRINT_SPEED = 25
local isSprinting  = false

-- kick constants (mirrors ball.lua)
local BASE_KICK_POWER    = 30
local BASE_KICK_UP       = 15
local CHARGED_KICK_POWER = 75
local CHARGED_KICK_UP    = 50
local CHARGE_TIME        = 1.5
local MAX_SPEED_BONUS    = 3
local CURVE_EDGE_THRESHOLD   = 2
local CURVE_POWER_MULTIPLIER = 50
local CURVE_DECAY            = 2.0
local CURVE_CHARGE_BONUS     = 6.0
local CURVE_SPRINT_BONUS     = 3.0

-- kick state
local charge      = 0
local curvePower  = 0
local curveDirX   = 0
local curveDirZ   = 0
local kickCooldown = 0

-- jump state
local JUMP_POWER   = 50
local GRAVITY      = -196.2
local jumpTimer    = 0   -- time since last jump attempt
local jumpCooldown = 0

-- brain
local botState    = "chase"
local stateTimer  = 0
local lastBallX   = 0
local lastBallZ   = 0
local ballVelX    = 0
local ballVelZ    = 0

local spawnBot = function(spawnerPlayer)
    if spawned then return end
    if bot then return end

    local bp = game:GetPartPosition("PhysicsBall")
    if not bp then return end

    footOffset = game:GetCharFootOffset()
    groundY = bp.y - 1.5

    local sx = bp.x + 5
    local sz = bp.z + 5
    local sy = bp.y + footOffset + 5
    local c = game:CloneCharacter("DumbBot", sx, sy, sz)
    if c then
        bot = c
        spawned = true
        velY = 0
        botGrounded = false
        lastBallX = bp.x
        lastBallZ = bp.z
        game:Broadcast("Bot spawned!")
    else
        game:Broadcast("Bot CloneCharacter FAILED")
    end
end

local applyKick = function(pos, bp, chargeRatio, currentSpeed)
    local dx = bp.x - pos.x
    local dz = bp.z - pos.z
    local dist = math.sqrt(dx * dx + dz * dz)
    if dist < 0.01 then return end
    local facingX = dx / dist
    local facingZ = dz / dist

    local speedRatio = currentSpeed / WALK_SPEED
    local speedMult = speedRatio * MAX_SPEED_BONUS
    local basePower = BASE_KICK_POWER + ((CHARGED_KICK_POWER - BASE_KICK_POWER) * chargeRatio)
    local baseUp    = BASE_KICK_UP    + ((CHARGED_KICK_UP    - BASE_KICK_UP)    * chargeRatio)
    local power = basePower * speedMult
    local up    = baseUp    * speedMult

    local ball = game:GetPart("PhysicsBall")
    if not ball then return end
    ball:SetVelocity(facingX * power, up, facingZ * power)

    -- curve: crossY = (facingZ * bRelX) - (facingX * bRelZ)
    local bRelX = bp.x - pos.x
    local bRelZ = bp.z - pos.z
    local crossY = (facingZ * bRelX) - (facingX * bRelZ)
    if math.abs(crossY) > CURVE_EDGE_THRESHOLD then
        local sprintBoost = 1 + ((speedRatio - 1) * CURVE_SPRINT_BONUS)
        local chargeBoost = 1 + (chargeRatio * CURVE_CHARGE_BONUS)
        local totalBoost  = sprintBoost * chargeBoost
        if crossY > 0 then
            curvePower = CURVE_POWER_MULTIPLIER * totalBoost
        else
            curvePower = -CURVE_POWER_MULTIPLIER * totalBoost
        end
    else
        curvePower = 0
    end
    curveDirX = facingZ
    curveDirZ = -facingX
    charge = 0
    kickCooldown = 0.6
end

local onUpdate = function(dt)
    if not spawned then return end
    if not bot then return end

    local bp = game:GetPartPosition("PhysicsBall")
    if not bp then return end

    -- track ball velocity for prediction
    ballVelX = (bp.x - lastBallX) / math.max(dt, 0.001)
    ballVelZ = (bp.z - lastBallZ) / math.max(dt, 0.001)
    lastBallX = bp.x
    lastBallZ = bp.z

    local pos = bot.Position

    -- ── Gravity & jump ───────────────────────────────────────
    velY = velY + GRAVITY * dt
    local ny = pos.y + velY * dt
    local feetY = ny - footOffset
    if feetY <= groundY then
        ny = groundY + footOffset
        velY = 0
        botGrounded = true
    else
        botGrounded = false
    end

    -- ── Goal positions ───────────────────────────────────────
    local g1 = game:GetPartPosition("goal1")
    local g2 = game:GetPartPosition("goal2")
    local myGoalX  = g1 and (g1.x or g1.X) or 0
    local myGoalZ  = g1 and (g1.z or g1.Z) or (bp.z - 60)
    local oppGoalX = g2 and (g2.x or g2.X) or 0
    local oppGoalZ = g2 and (g2.z or g2.Z) or (bp.z + 60)

    -- ── Distances ────────────────────────────────────────────
    local ballDX   = bp.x - pos.x
    local ballDZ   = bp.z - pos.z
    local ballDist = math.sqrt(ballDX * ballDX + ballDZ * ballDZ)

    -- predict where ball will be in ~0.3s
    local predBX = bp.x + ballVelX * 0.3
    local predBZ = bp.z + ballVelZ * 0.3

    -- nearest player
    local players = game:GetPlayers()
    local nearPX = nil
    local nearPZ = nil
    local nearPDist = 999999
    local playerBallDist = 999999
    for _, p in ipairs(players) do
        local pdx = p.x - pos.x
        local pdz = p.z - pos.z
        local pd  = math.sqrt(pdx * pdx + pdz * pdz)
        if pd < nearPDist then
            nearPDist = pd
            nearPX = p.x
            nearPZ = p.z
        end
    end
    if nearPX ~= nil then
        local pbdx = bp.x - nearPX
        local pbdz = bp.z - nearPZ
        playerBallDist = math.sqrt(pbdx * pbdx + pbdz * pbdz)
    end

    -- ── Decide state ─────────────────────────────────────────
    stateTimer = stateTimer + dt

    local ballToOppGoalDX = oppGoalX - bp.x
    local ballToOppGoalDZ = oppGoalZ - bp.z
    local ballToOppGoalDist = math.sqrt(ballToOppGoalDX * ballToOppGoalDX + ballToOppGoalDZ * ballToOppGoalDZ)
    local inShotRange = ballToOppGoalDist < 40

    botState = "chase"
    if ballDist < 3.5 then
        botState = "kick"
    end
    if botState ~= "kick" then
        if nearPX ~= nil then
            if playerBallDist < ballDist - 3 then
                if nearPDist < 18 then
                    botState = "intercept"
                end
            end
        end
    end
    if botState == "chase" then
        if ballDist > 35 then
            botState = "position"
        end
    end

    -- ── Sprint logic ─────────────────────────────────────────
    -- sprint when chasing or intercepting and far from ball
    -- walk near ball for control
    isSprinting = false
    if botState == "chase" then
        if ballDist > 10 then
            isSprinting = true
        end
    end
    if botState == "intercept" then
        isSprinting = true
    end
    if botState == "position" then
        isSprinting = true
    end

    local currentSpeed = WALK_SPEED
    if isSprinting then
        currentSpeed = SPRINT_SPEED
    end

    -- ── Target position ───────────────────────────────────────
    local tx = predBX
    local tz = predBZ

    if botState == "intercept" then
        if nearPX ~= nil then
            tx = (predBX + nearPX) / 2
            tz = (predBZ + nearPZ) / 2
        end
    end
    if botState == "position" then
        -- hold between ball and own goal, offset to open side
        local midX = (bp.x + myGoalX) / 2
        local midZ = (bp.z + myGoalZ) / 2
        if bp.x > 0 then
            tx = midX - 6
        else
            tx = midX + 6
        end
        tz = midZ
    end
    if botState == "chase" then
        -- approach from behind ball so we face opponent goal
        local safeD = math.max(ballDist, 0.01)
        -- get behind ball relative to opp goal direction
        local toBallNX = ballDX / safeD
        local toBallNZ = ballDZ / safeD
        tx = bp.x - toBallNX * 2
        tz = bp.z - toBallNZ * 2
    end

    -- ── Jump decision ─────────────────────────────────────────
    jumpCooldown = math.max(0, jumpCooldown - dt)
    local shouldJump = false
    -- jump if ball is elevated and we're close
    if bp.y ~= nil then
        if bp.y > groundY + 3 then
            if ballDist < 8 then
                if botGrounded then
                    if jumpCooldown <= 0 then
                        shouldJump = true
                    end
                end
            end
        end
    end
    if shouldJump then
        velY = JUMP_POWER
        botGrounded = false
        jumpCooldown = 1.5
    end

    -- ── Move bot ──────────────────────────────────────────────
    if botState ~= "kick" then
        local tdx   = tx - pos.x
        local tdz   = tz - pos.z
        local tdist = math.sqrt(tdx * tdx + tdz * tdz)
        if tdist > 0.5 then
            local step = currentSpeed * dt
            if step > tdist then step = tdist end
            local nx = pos.x + (tdx / tdist) * step
            local nz = pos.z + (tdz / tdist) * step
            game:MoveCharacterClone(bot, nx, ny, nz)
            game:RotateCharacterClone(bot, math.atan2(tdx, -tdz))
        else
            game:MoveCharacterClone(bot, pos.x, ny, pos.z)
        end
    else
        game:MoveCharacterClone(bot, pos.x, ny, pos.z)
    end

    -- ── Charge kick when closing in ───────────────────────────
    kickCooldown = math.max(0, kickCooldown - dt)
    if botState == "chase" then
        if ballDist < 12 then
            if ballDist > 3.5 then
                charge = math.min(charge + dt, CHARGE_TIME)
            end
        end
    end
    if botState ~= "chase" then
        if botState ~= "kick" then
            charge = math.max(0, charge - dt * 2)
        end
    end

    -- ── Kick ─────────────────────────────────────────────────
    if botState == "kick" then
        if kickCooldown <= 0 then
            local chargeRatio = math.min(charge / CHARGE_TIME, 1)
            -- powershot if aimed at goal and in range
            if inShotRange then
                chargeRatio = math.max(chargeRatio, 0.7)
            end
            applyKick(pos, bp, chargeRatio, currentSpeed)
        end
    end

    -- ── Apply curve (mirrors ball.lua onUpdate) ───────────────
    if math.abs(curvePower) > 0.1 then
        local ball = game:GetPart("PhysicsBall")
        if ball then
            local vel = ball:GetVelocity()
            if type(vel) == "table" then
                local vx = vel.x or vel.X or 0
                local vy = vel.y or vel.Y or 0
                local vz = vel.z or vel.Z or 0
                if vy > 0.2 or vy < -0.2 then
                    ball:SetVelocity(
                        vx + curveDirX * curvePower * dt,
                        vy,
                        vz + curveDirZ * curvePower * dt
                    )
                    curvePower = curvePower * (1 - dt * CURVE_DECAY)
                else
                    curvePower = 0
                end
            end
        end
    end
end

local onChat = function(player, message)
    if message == "!dumbbot" then
        if bot then
            game:RemoveCharacterClone(bot)
            bot = nil
            spawned = false
            charge = 0
            curvePower = 0
            velY = 0
        end
        spawnBot(player)
    end
end

return {
    onUpdate = onUpdate,
    onChat = onChat,
}