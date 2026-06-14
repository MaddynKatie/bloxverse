local bot = nil
local spawned = false
local velY = 0
local footOffset = 2
local groundY = 0

local CHASE_SPEED = 25
local KICK_POWER = 90
local KICK_UP = 18
local SHOOT_RANGE = 45
local BLOCK_RANGE = 35

local kicked = false
local kickIdleTime = 0
local myGoalIndex = 1
local myGoalX = 0
local myGoalZ = -81
local oppGoalX = 0
local oppGoalZ = 81

local FIELD_LEFT = -138.9
local FIELD_RIGHT = -34.1
local FIELD_BOTTOM = -96
local FIELD_TOP = 96

local prevBallX = 0
local prevBallZ = 0
local prevBallY = 0
local hasPrevBall = false

local applyDifficulty = function(diff)
    CHASE_SPEED = 25
    KICK_POWER = 90
    if diff == "easy" then
        CHASE_SPEED = 18
        KICK_POWER = 60
    end
    if diff == "hard" then
        CHASE_SPEED = 30
        KICK_POWER = 120
    end
end

local setGoalPositions = function()
    local g1 = game.GetPartPosition("goal1")
    local g2 = game.GetPartPosition("goal2")
    if not g1 then return end
    if not g2 then return end
    if myGoalIndex == 1 then
        myGoalX = g1.x or g1.X
        myGoalZ = g1.z or g1.Z
        oppGoalX = g2.x or g2.X
        oppGoalZ = g2.z or g2.Z
    end
    if myGoalIndex == 2 then
        myGoalX = g2.x or g2.X
        myGoalZ = g2.z or g2.Z
        oppGoalX = g1.x or g1.X
        oppGoalZ = g1.z or g1.Z
    end
end

local spawnBot = function()
    if spawned then return end
    if bot then return end

    setGoalPositions()

    local bp = game.GetPartPosition("PhysicsBall")
    if not bp then return end

    footOffset = game.GetCharFootOffset()
    groundY = bp.y - 1.5

    local goalDir = 1
    if myGoalIndex == 2 then goalDir = -1 end
    local rng = math.random() - 0.5
    local sx = myGoalX + rng * 6
    local sy = groundY + footOffset + 1
    local sz = myGoalZ + goalDir * 15

    local c = game.CloneCharacter("Bot", sx, sy, sz)
    if c then
        bot = c
        spawned = true
        velY = 0
        kicked = false
        kickIdleTime = 0
        hasPrevBall = false
    end

    local ball = game.GetPart("PhysicsBall")
    if ball then
        ball:SetVelocity(0.01, 0, 0)
    end
end

local onUpdate = function(dt)
    if not spawned then return end
    if not bot then return end

    local bp = game.GetPartPosition("PhysicsBall")
    if not bp then return end

    local pos = bot.Position

    velY = velY - 200 * dt
    local ny = pos.y + velY * dt
    local feetY = ny - footOffset
    if feetY < groundY then
        ny = groundY + footOffset
        velY = 0
    end

    local dx = bp.x - pos.x
    local dz = bp.z - pos.z
    local dist = math.sqrt(dx * dx + dz * dz)
    local inRange = dist <= 2

    local ballVelX = 0
    local ballVelY = 0
    local ballVelZ = 0
    if hasPrevBall then
        ballVelX = (bp.x - prevBallX) / dt
        ballVelY = (bp.y - prevBallY) / dt
        ballVelZ = (bp.z - prevBallZ) / dt
    end
    prevBallX = bp.x
    prevBallY = bp.y
    prevBallZ = bp.z
    hasPrevBall = true

    local ballHeight = bp.y - groundY
    local ballInAir = ballHeight > 2.5
    local distToMyGoal = math.sqrt((bp.x - myGoalX)^2 + (bp.z - myGoalZ)^2)

    if ballInAir and distToMyGoal < BLOCK_RANGE then
        local timeToGround = 999
        if ballVelY < -0.1 then
            timeToGround = ballHeight / (-ballVelY)
        end
        local lookAhead = math.min(timeToGround, 1.5)
        local targetX = bp.x + ballVelX * lookAhead
        local targetZ = bp.z + ballVelZ * lookAhead
        local tdx = targetX - pos.x
        local tdz = targetZ - pos.z
        local tDist = math.sqrt(tdx * tdx + tdz * tdz)
        if tDist > 0.01 then
            local nx = pos.x + (tdx / tDist) * CHASE_SPEED * dt
            local nz = pos.z + (tdz / tDist) * CHASE_SPEED * dt
            game.MoveCharacterClone(bot, nx, ny, nz)
        end

        if ballHeight < 8 and ballHeight > 1.5 and feetY <= groundY + 0.1 then
            velY = 70
        end

        if not kicked and inRange then
            local ball = game.GetPart("PhysicsBall")
            if ball then
                local sgd = math.sqrt((oppGoalX - bp.x)^2 + (oppGoalZ - bp.z)^2)
                local sdx = 0
                local sdz = 0
                if sgd > 0.01 then
                    sdx = (oppGoalX - bp.x) / sgd
                    sdz = (oppGoalZ - bp.z) / sgd
                end
                ball:SetVelocity(sdx * 50, 10, sdz * 50)
                kicked = true
                kickIdleTime = 0
            end
        end

        if dist > 0.01 then
            game.RotateCharacterClone(bot, math.atan2(dx, -dz))
        end
        return
    end

    if not inRange then
        if dist > 0.01 then
            local nx = pos.x + (dx / dist) * CHASE_SPEED * dt
            local nz = pos.z + (dz / dist) * CHASE_SPEED * dt
            game.MoveCharacterClone(bot, nx, ny, nz)
        end
        kicked = false
        kickIdleTime = 0
    else
        game.MoveCharacterClone(bot, pos.x, ny, pos.z)

        if kicked then
            kickIdleTime = kickIdleTime + dt
            if kickIdleTime > 0.3 then
                kicked = false
                kickIdleTime = 0
            end
        end

        if not kicked then
            local ball = game.GetPart("PhysicsBall")
            if ball then
                local facingX = dx / dist
                local facingZ = dz / dist
                local power = KICK_POWER
                local up = KICK_UP

                local ballToOppGoal = math.sqrt((bp.x - oppGoalX)^2 + (bp.z - oppGoalZ)^2)
                local sgd = math.sqrt((oppGoalX - bp.x)^2 + (oppGoalZ - bp.z)^2)
                local sdx = 0
                local sdz = 0
                if sgd > 0.01 then
                    sdx = (oppGoalX - bp.x) / sgd
                    sdz = (oppGoalZ - bp.z) / sgd
                end

                local nearPlayer = false
                local players = game.GetPlayers()
                for _, p in ipairs(players) do
                    local pd = math.sqrt((p.x - bp.x)^2 + (p.z - bp.z)^2)
                    if pd < 8 then
                        nearPlayer = true
                        break
                    end
                end

                local distToLeftWall = bp.x - FIELD_LEFT
                local distToRightWall = FIELD_RIGHT - bp.x
                local nearSideline = distToLeftWall < 12 or distToRightWall < 12

                if ballToOppGoal < SHOOT_RANGE then
                    facingX = sdx
                    facingZ = sdz
                    power = math.min(35 + ballToOppGoal * 0.25, 48)
                    up = 6
                else
                    if nearPlayer then
                        if math.random() < 0.5 then
                            up = 22
                            power = math.min(KICK_POWER, 65)
                        else
                            local perpX = -sdz * (math.random() - 0.5) * 2.5
                            local perpZ = sdx * (math.random() - 0.5) * 2.5
                            facingX = sdx * 0.5 + perpX
                            facingZ = sdz * 0.5 + perpZ
                            local fd = math.sqrt(facingX * facingX + facingZ * facingZ)
                            if fd > 0.01 then
                                facingX = facingX / fd
                                facingZ = facingZ / fd
                            end
                            power = math.min(KICK_POWER * 0.7, 60)
                            up = 5
                        end
                    else
                        if nearSideline then
                            local awayX = 0
                            if distToLeftWall < distToRightWall then
                                awayX = 1.0
                            else
                                awayX = -1.0
                            end
                            facingX = awayX * 0.5 + sdx * 0.5
                            facingZ = sdz
                            local fd = math.sqrt(facingX * facingX + facingZ * facingZ)
                            if fd > 0.01 then
                                facingX = facingX / fd
                                facingZ = facingZ / fd
                            end
                            power = 60
                            up = 5
                        else
                            facingX = sdx
                            facingZ = sdz
                            power = KICK_POWER
                            up = KICK_UP
                        end
                    end
                end

                ball:SetVelocity(facingX * power, up, facingZ * power)
                kicked = true
                kickIdleTime = 0
            end
        end
    end

    if dist > 0.01 then
        game.RotateCharacterClone(bot, math.atan2(dx, -dz))
    end
end

local onChat = function(player, message)
    if message == "!bot" then
        if bot then
            game.RemoveCharacterClone(bot)
            bot = nil
            spawned = false
        end
        spawnBot()
        return
    end

    local rest = string.sub(message, 6)
    local args = {}
    local current = ""
    for i = 1, #rest do
        local ch = string.sub(rest, i, i)
        if ch == " " then
            if current ~= "" then
                table.insert(args, current)
                current = ""
            end
        else
            current = current .. ch
        end
    end
    if current ~= "" then table.insert(args, current) end

    local newSide = 0
    local newDiff = ""
    for _, arg in ipairs(args) do
        if arg == "home" or arg == "1" then newSide = 1 end
        if arg == "away" or arg == "2" then newSide = 2 end
        if arg == "easy" then newDiff = "easy" end
        if arg == "medium" or arg == "med" then newDiff = "medium" end
        if arg == "hard" then newDiff = "hard" end
    end

    if newSide ~= 0 or newDiff ~= "" then
        if bot then
            game.RemoveCharacterClone(bot)
            bot = nil
            spawned = false
        end
        if newSide ~= 0 then myGoalIndex = newSide end
        if newDiff ~= "" then applyDifficulty(newDiff) end
        spawnBot()
    end
end

return { onUpdate = onUpdate, onChat = onChat }
