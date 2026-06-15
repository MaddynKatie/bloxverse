local goalies = {}

local GK_CFG = {
    easy = {
        speed = 16,
        trackingMult = 2.5,
        diveRange = 20,
        jumpPower = 28,
        lateralDive = 16,
        reactionTime = 0.35,
        saveRange = 3.5
    },
    medium = {
        speed = 28,
        trackingMult = 4,
        diveRange = 30,
        jumpPower = 38,
        lateralDive = 28,
        reactionTime = 0.12,
        saveRange = 4.5
    },
    hard = {
        speed = 48,
        trackingMult = 6,
        diveRange = 42,
        jumpPower = 52,
        lateralDive = 42,
        reactionTime = 0.0,
        saveRange = 5.5
    }
}

local GOAL_HALF = 8
local SAVE_HEIGHT = 3.2
local PREDICT_TIME = 0.3

local prevBallX = 0
local prevBallY = 0
local prevBallZ = 0
local hasPrevBall = false
local ballVelX = 0
local ballVelY = 0
local ballVelZ = 0

local spawnGoalie = function(side, difficulty)
    if goalies[side] then return end

    local g1 = game.GetPartPosition("goal1")
    local g2 = game.GetPartPosition("goal2")
    if not g1 then return end
    if not g2 then return end

    local gkGoalX = 0
    local gkGoalZ = 0
    if side == 1 then
        gkGoalX = g1.x or g1.X
        gkGoalZ = g1.z or g1.Z
    end
    if side == 2 then
        gkGoalX = g2.x or g2.X
        gkGoalZ = g2.z or g2.Z
    end

    local bp = game.GetPartPosition("PhysicsBall")
    if not bp then return end

    local gkFootOffset = game.GetCharFootOffset()
    local gkGroundY = bp.y - 1.5

    local goalDir = 1
    if side == 2 then goalDir = -1 end
    local sx = gkGoalX
    local sy = gkGroundY + gkFootOffset + 1
    local sz = gkGoalZ + goalDir * 3

    local c = game.CloneCharacter("Bot", sx, sy, sz)
    if c then
        local g = {
            bot = c,
            side = side,
            difficulty = difficulty or "medium",
            velY = 0,
            diveVelX = 0,
            isDiving = false,
            reactTimer = 0,
            goalX = gkGoalX,
            goalZ = gkGoalZ,
            footOffset = gkFootOffset,
            groundY = gkGroundY
        }
        goalies[side] = g
    end
end

local removeGoalie = function(side)
    local g = goalies[side]
    if g and g.bot then
        game.RemoveCharacterClone(g.bot)
        goalies[side] = nil
    end
end

local removeAllGoalies = function()
    if goalies[1] then removeGoalie(1) end
    if goalies[2] then removeGoalie(2) end
end

local onUpdate = function(dt)
    if not goalies[1] and not goalies[2] then return end

    local bp = game.GetPartPosition("PhysicsBall")
    if not bp then return end

    ballVelX = 0
    ballVelY = 0
    ballVelZ = 0
    if hasPrevBall then
        ballVelX = (bp.x - prevBallX) / dt
        ballVelY = (bp.y - prevBallY) / dt
        ballVelZ = (bp.z - prevBallZ) / dt
    end
    prevBallX = bp.x
    prevBallY = bp.y
    prevBallZ = bp.z
    hasPrevBall = true

    for side = 1, 2 do
        local g = goalies[side]
        if g and g.bot then
            local pos = g.bot.Position

            g.velY = g.velY - 200 * dt
            local ny = pos.y + g.velY * dt
            local feetY = ny - g.footOffset
            if feetY < g.groundY then
                ny = g.groundY + g.footOffset
                g.velY = 0
                g.diveVelX = 0
                g.isDiving = false
            end

            local goalDir = 1
            if side == 2 then goalDir = -1 end
            local goalLineZ = g.goalZ + goalDir * 2

            local distToGoal = math.sqrt((bp.x - g.goalX)^2 + (bp.z - g.goalZ)^2)

            local ballTowardGoal = false
            if side == 1 and ballVelZ < 0 then
                ballTowardGoal = true
            end
            if side == 2 and ballVelZ > 0 then
                ballTowardGoal = true
            end

            local cfg = GK_CFG[g.difficulty]

            local timeToGoalLine = 999
            local ballSpeedZ = math.abs(ballVelZ)
            if ballSpeedZ > 0.5 then
                timeToGoalLine = math.abs(bp.z - goalLineZ) / ballSpeedZ
            end
            local predLookAhead = math.min(timeToGoalLine, 1.0)
            local predBallX = bp.x + ballVelX * predLookAhead
            local predBallY = bp.y + ballVelY * predLookAhead
            local ballHeightAtGoal = predBallY - g.groundY
            local predTargetX = math.max(g.goalX - GOAL_HALF, math.min(g.goalX + GOAL_HALF, predBallX))

            local canDive = distToGoal < cfg.diveRange and ballTowardGoal and not g.isDiving and g.velY == 0

            if canDive then
                g.reactTimer = g.reactTimer + dt
            else
                g.reactTimer = 0
            end

            if g.reactTimer >= cfg.reactionTime and canDive then
                g.velY = cfg.jumpPower
                g.isDiving = true
                g.reactTimer = 0

                local diveDX = predTargetX - pos.x
                local diveDir = 0
                if diveDX > 0.3 then diveDir = 1 end
                if diveDX < -0.3 then diveDir = -1 end
                g.diveVelX = diveDir * cfg.lateralDive
            end

            local trackX = bp.x
            if ballTowardGoal then
                trackX = bp.x + ballVelX * PREDICT_TIME
            end

            local gnx = pos.x
            if g.isDiving then
                gnx = pos.x + g.diveVelX * dt
            else
                local targetX = math.max(g.goalX - GOAL_HALF, math.min(g.goalX + GOAL_HALF, trackX))
                local diffX = targetX - pos.x
                local moveSpeed = math.min(math.abs(diffX) * cfg.trackingMult, cfg.speed)
                if math.abs(diffX) > 0.2 then
                    local moveDir = 1
                    if diffX < 0 then moveDir = -1 end
                    gnx = pos.x + moveDir * moveSpeed * dt
                end
            end

            gnx = math.max(g.goalX - GOAL_HALF, math.min(g.goalX + GOAL_HALF, gnx))

            game.MoveCharacterClone(g.bot, gnx, ny, goalLineZ)

            local ballDx = bp.x - gnx
            local ballDz = bp.z - goalLineZ
            local ballDy = bp.y - ny
            local ballDist = math.sqrt(ballDx * ballDx + ballDz * ballDz)
            local canReach = ballDy < SAVE_HEIGHT
            if g.isDiving then
                canReach = ballDy < SAVE_HEIGHT + 2.5
            end
            if ballDist < cfg.saveRange and canReach and ballTowardGoal then
                local ball = game.GetPart("PhysicsBall")
                if ball then
                    local awayZ = 1
                    if side == 2 then awayZ = -1 end
                    local awayX = 0
                    if math.abs(ballDx) > 0.5 then
                        awayX = ballDx / math.abs(ballDx) * 0.4
                    end
                    local awayD = math.sqrt(awayX * awayX + awayZ * awayZ)
                    if awayD > 0.01 then
                        awayX = awayX / awayD
                        awayZ = awayZ / awayD
                    end
                    ball:SetVelocity(awayX * 60, 18, awayZ * 60)
                end
            end

            if side == 1 then
                game.RotateCharacterClone(g.bot, math.atan2(0, -1))
            end
            if side == 2 then
                game.RotateCharacterClone(g.bot, math.atan2(0, 1))
            end
        end
    end
end

local onChat = function(player, message)
    local prefix = string.sub(message, 1, 11)
    if prefix ~= "!goalkeeper" then return end

    if message == "!goalkeeper" then
        removeGoalie(1)
        spawnGoalie(1, "medium")
        return
    end

    local rest = string.sub(message, 13)
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

    local gkSide = 0
    local gkDiff = "medium"
    local gkRemove = false
    local gkRemoveAll = false

    for _, arg in ipairs(args) do
        if arg == "home" or arg == "1" then gkSide = 1 end
        if arg == "away" or arg == "2" then gkSide = 2 end
        if arg == "both" then gkSide = 3 end
        if arg == "remove" then gkRemove = true end
        if arg == "all" then gkRemoveAll = true end
        if arg == "easy" then gkDiff = "easy" end
        if arg == "medium" or arg == "med" then gkDiff = "medium" end
        if arg == "hard" then gkDiff = "hard" end
    end

    if gkRemove or gkRemoveAll then
        if gkRemoveAll then
            removeAllGoalies()
            return
        end
        if gkSide == 3 then
            removeAllGoalies()
            return
        end
        if gkSide ~= 0 then
            removeGoalie(gkSide)
            return
        end
        removeAllGoalies()
        return
    end

    if gkSide == 3 then
        spawnGoalie(1, gkDiff)
        spawnGoalie(2, gkDiff)
        return
    end
    if gkSide ~= 0 then
        spawnGoalie(gkSide, gkDiff)
        return
    end
    spawnGoalie(1, gkDiff)
end

return { onUpdate = onUpdate, onChat = onChat }
