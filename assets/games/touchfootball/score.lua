-- Soccer Scoreboard
-- Commands: /start  /end  /team1 XXX  /team2 XXX  /score reset

local homeScore  = 0
local awayScore  = 0
local team1Name  = "HOME"
local team2Name  = "AWAY"
local team1Color = 1402304
local team2Color = 12986408

local GAME_DURATION = 90
local BREAK_TIME    = 15
local GOAL_PAUSE    = 3

local gameActive    = false
local gameTimer     = GAME_DURATION
local gameStartTime = 0
local gameEnded     = false

local breakActive    = false
local breakTimer     = 0
local breakStartTime = 0

local goalActive    = false
local goalTimer     = 0
local goalStartTime = 0

-- Goal bounds
local GOAL_Y_MAX = 14  -- crossbar top 15.55 minus ball radius 1.5

-- Kickoff position (matches /resetparts initial ball position)
local KICKOFF_X = 7
local KICKOFF_Y = 3.95
local KICKOFF_Z = 121

local prevBallZ  = 0
local hasPrevBall = false

local lastToucher     = nil
local prevToucher     = nil
local lastToucherName = ""
local prevToucherName = ""
local ballInst        = nil

local hexChars = "0123456789abcdef"
local colorToHex = function(c)
    local s = ""
    for i = 1, 6 do
        s = string.sub(hexChars, (c % 16) + 1, (c % 16) + 1) .. s
        c = math.floor(c / 16)
    end
    return s
end

local getPlayerTeam = function(pid)
    if window and window._bloxverse and window._bloxverse._playerTeams then
        return window._bloxverse._playerTeams[pid]
    end
    return nil
end

local hasPositioned = false
local prevTimerStr  = ""
local prevTimerBg   = -1
local prevT1N       = ""
local prevT1C       = -1
local prevH         = -1
local prevA         = -1
local prevT2N       = ""
local prevT2C       = -1

-- GUI elements
local gui         = nil
local elTimer     = nil
local elTeam1     = nil
local elScore1    = nil
local elDivider   = nil
local elScore2    = nil
local elTeam2     = nil
local elMessage   = nil

local BOARD_Y     = 0.02
local BOARD_H     = 44
local TIMER_W     = 70
local TEAM_W      = 90
local SCORE_W     = 54
local DIV_W       = 6
local DARK        = 858922
local LIGHT       = 15658734
local SCORE_BG    = 14541802

local buildUI = function()
    if gui then return end
    gui = game:CreateScreenGui("ScoreboardGui")

    -- Timer block (leftmost)
    elTimer = gui:CreateGui("TextLabel", {
        Text = "-" .. "-",
        PositionX = 0.5,
        PositionY = BOARD_Y,
        SizeX = TIMER_W,
        SizeY = BOARD_H,
        BackgroundColor = DARK,
        TextColor = 16777215,
        FontSize = 18,
        ZIndex = 20,
    })

    -- Team 1 name
    elTeam1 = gui:CreateGui("TextLabel", {
        Text = team1Name,
        PositionX = 0.5,
        PositionY = BOARD_Y,
        SizeX = TEAM_W,
        SizeY = BOARD_H,
        BackgroundColor = team1Color,
        TextColor = 16777215,
        FontSize = 18,
        ZIndex = 20,
    })

    -- Score home
    elScore1 = gui:CreateGui("TextLabel", {
        Text = "0",
        PositionX = 0.5,
        PositionY = BOARD_Y,
        SizeX = SCORE_W,
        SizeY = BOARD_H,
        BackgroundColor = SCORE_BG,
        TextColor = 1118481,
        FontSize = 22,
        ZIndex = 20,
    })

    -- Divider
    elDivider = gui:CreateGui("Frame", {
        PositionX = 0.5,
        PositionY = BOARD_Y,
        SizeX = DIV_W,
        SizeY = BOARD_H,
        BackgroundColor = 8947848,
        ZIndex = 21,
    })

    -- Score away
    elScore2 = gui:CreateGui("TextLabel", {
        Text = "0",
        PositionX = 0.5,
        PositionY = BOARD_Y,
        SizeX = SCORE_W,
        SizeY = BOARD_H,
        BackgroundColor = SCORE_BG,
        TextColor = 1118481,
        FontSize = 22,
        ZIndex = 20,
    })

    -- Team 2 name
    elTeam2 = gui:CreateGui("TextLabel", {
        Text = team2Name,
        PositionX = 0.5,
        PositionY = BOARD_Y,
        SizeX = TEAM_W,
        SizeY = BOARD_H,
        BackgroundColor = team2Color,
        TextColor = 16777215,
        FontSize = 18,
        ZIndex = 20,
    })

    -- Message below scoreboard (goals, full-time result)
    elMessage = gui:CreateGui("TextLabel", {
        Text = "",
        PositionX = 0.5,
        PositionY = 0.07,
        SizeX = 500,
        SizeY = 24,
        FontSize = 16,
        ZIndex = 30,
        BackgroundTransparency = 1,
    })
end

local positionUI = function()
    if not gui then return end
    -- Layout: [TIMER][TEAM1][S1][|][S2][TEAM2]
    -- Total width = TIMER_W + TEAM_W + SCORE_W + DIV_W + SCORE_W + TEAM_W
    -- Centre each element by offsetting from 0.5 (screen centre)
    local totalW = TIMER_W + TEAM_W + SCORE_W + DIV_W + SCORE_W + TEAM_W
    local startX = -(totalW / 2)

    -- PositionX in this engine: if > 1, it's pixels from centre of screen at 0.5
    -- We'll use a pixel offset trick: set PositionX = 0.5 and rely on SizeX centering,
    -- but the engine does left = posX - sizeX/2, so:
    -- to place at absolute pixel X from left edge, we can't directly.
    -- Instead lay them out with increasing offsets using a virtual screen width of 1920.
    -- PositionX > 1 is treated as pixels, centred: left = posX - sizeX/2
    -- So to place block at left edge = L, centre = L + W/2

    local cx = (window.innerWidth / 2) + startX  -- pixel centre of first block
    cx = cx + TIMER_W / 2
    elTimer.PositionX = cx
    cx = cx + TIMER_W / 2 + TEAM_W / 2
    elTeam1.PositionX = cx
    cx = cx + TEAM_W / 2 + SCORE_W / 2
    elScore1.PositionX = cx
    cx = cx + SCORE_W / 2 + DIV_W / 2
    elDivider.PositionX = cx
    cx = cx + DIV_W / 2 + SCORE_W / 2
    elScore2.PositionX = cx
    cx = cx + SCORE_W / 2 + TEAM_W / 2
    elTeam2.PositionX = cx
end

local renderUI = function()
    if not elTimer then return end

    local timerStr = "-" .. "-"
    if gameActive then
        local secs = math.max(0, math.floor(gameTimer))
        local m = math.floor(secs / 60)
        local s = secs % 60
        local ss = tostring(s)
        if s < 10 then ss = "0" .. ss end
        timerStr = tostring(m) .. ":" .. ss
    end
    if breakActive then
        timerStr = tostring(math.ceil(breakTimer)) .. "s"
    end

    elTimer.Text = timerStr
    local tb = DARK
    if breakActive then tb = 12000284 end
    if timerStr ~= prevTimerStr then
        elTimer.Text = timerStr
        prevTimerStr = timerStr
    end
    if tb ~= prevTimerBg then
        elTimer.BackgroundColor = tb
        prevTimerBg = tb
    end

    if team1Name ~= prevT1N then
        elTeam1.Text = team1Name
        prevT1N = team1Name
    end
    if team1Color ~= prevT1C then
        elTeam1.BackgroundColor = team1Color
        prevT1C = team1Color
    end
    local hs = tostring(homeScore)
    if hs ~= prevH then
        elScore1.Text = hs
        prevH = hs
    end
    local aw = tostring(awayScore)
    if aw ~= prevA then
        elScore2.Text = aw
        prevA = aw
    end
    if team2Name ~= prevT2N then
        elTeam2.Text = team2Name
        prevT2N = team2Name
    end
    if team2Color ~= prevT2C then
        elTeam2.BackgroundColor = team2Color
        prevT2C = team2Color
    end
end

local showGoalBanner = function(side, scorer, assister, sTeam, aTeam)
    local teamName = team1Name
    local teamColor = team1Color
    if side == 2 then
        teamName = team2Name
        teamColor = team2Color
    end

    local teamHex = colorToHex(teamColor)
    local sColor = colorToHex((sTeam == 1 and team1Color) or (sTeam == 2 and team2Color) or 16777215)
    local aColor = colorToHex((aTeam == 1 and team1Color) or (aTeam == 2 and team2Color) or 16777215)
    local escS = (scorer or "")
    local escA = (assister or "")

    local chatMsg = "GOAL! <span style='color:#" .. teamHex .. "'>" .. teamName .. "</span> scores"
    if scorer and scorer ~= "" then
        chatMsg = chatMsg .. " — <span style='color:#" .. sColor .. "'>" .. escS .. "</span>"
    end
    if assister and assister ~= "" and assister ~= scorer then
        chatMsg = chatMsg .. " <span style='color:#aaa'>(assist:</span> <span style='color:#" .. aColor .. "'>" .. escA .. "</span><span style='color:#aaa'>)</span>"
    end
    game:Broadcast(chatMsg)

    if elMessage then
        elMessage.Text = "GOAL! " .. teamName
        elMessage.TextColor = teamColor
    end
end

local resetBall = function()
    if window and window._bloxverse and window._bloxverse.resetParts then
        window._bloxverse.resetParts()
    end
end

local teleportToKickoff = function()
    local bp = game:GetPartPosition("PhysicsBall")
    if not bp then return end
    local bx = bp.x or bp.X or KICKOFF_X
    local bz = bp.z or bp.Z or KICKOFF_Z
    local by = bp.y or bp.Y or KICKOFF_Y
    local angle = math.random() * 2 * 3.141592653589793
    local dist  = 5 + math.random() * 6
    game:TeleportPlayer(bx + math.sin(angle) * dist, 0.8, bz + math.cos(angle) * dist)
end

local startGame = function()
    gameActive    = true
    gameTimer     = GAME_DURATION
    gameStartTime = os.clock()
    gameEnded     = false
    breakActive   = false
    breakTimer    = 0
    goalActive    = false
    homeScore     = 0
    awayScore     = 0
    lastToucher   = nil
    prevToucher   = nil
    hasPrevBall   = false
    prevTimerStr  = ""
    prevTimerBg   = -1
    prevH = "-1"
    prevA = "-1"
    hasPositioned = false
    if elMessage then elMessage.Text = "" end
    resetBall()
    teleportToKickoff()
    game:Broadcast("KICK OFF! " .. team1Name .. " vs " .. team2Name .. " — 90 seconds!")
    renderUI()
end

local endGame = function(announce)
    gameActive    = false
    breakActive   = true
    breakTimer    = BREAK_TIME
    breakStartTime = os.clock()
    goalActive    = false

    if announce then
        local msg = ""
        local result = ""
        if homeScore > awayScore then
            result = team1Name .. " WIN! (" .. homeScore .. "-" .. awayScore .. ")"
        end
        if awayScore > homeScore then
            result = team2Name .. " WIN! (" .. homeScore .. "-" .. awayScore .. ")"
        end
        if homeScore == awayScore then
            result = "DRAW! (" .. homeScore .. "-" .. awayScore .. ")"
        end
        msg = result
        game:Broadcast("FULL TIME! " .. result)
        game:Broadcast("Next game in " .. BREAK_TIME .. "s. Use /team1 and /team2 to change teams.")
        if elMessage then elMessage.Text = msg end
    end

    resetBall()
    renderUI()
end

local initBallTouch = function()
    if ballInst then return true end
    local b = workspace:FindFirstChild("PhysicsBall")
    if not b then return false end
    ballInst = b
    ballInst.Touched:Connect(function(hit)
        if not hit or hit.ClassName ~= "Model" then return end
        local localPlayer = game:GetLocalPlayer()
        if not localPlayer then return end
        if localPlayer.id ~= lastToucher then
            prevToucher     = lastToucher
            prevToucherName = lastToucherName
            lastToucher     = localPlayer.id
            lastToucherName = localPlayer.name or ""
        end
        if game.SendNetworkMessage then
            game:SendNetworkMessage("TOUCH")
        end
    end)
    return true
end

local onUpdate = function(dt)
    buildUI()
    if not hasPositioned then
        positionUI()
        hasPositioned = true
    end

    -- Break countdown (wall-clock)
    if breakActive then
        breakTimer = math.max(0, BREAK_TIME - (os.clock() - breakStartTime))
        if breakTimer <= 0 then
            breakActive = false
            startGame()
        end
        renderUI()
        return
    end

    -- Game timer (wall-clock)
    if gameActive then
        gameTimer = math.max(0, GAME_DURATION - (os.clock() - gameStartTime))
        if gameTimer <= 0 and not gameEnded then
            gameEnded = true
            gameTimer = 0
            renderUI()
            endGame(true)
            return
        end
    end

    local bp = game:GetPartPosition("PhysicsBall")
    if not bp then
        renderUI()
        return
    end

    local curX = bp.x or bp.X or 0
    local curY = bp.y or bp.Y or 0
    local curZ = bp.z or bp.Z or 0

    initBallTouch()

    -- Goal pause countdown (wall-clock)
    if goalActive then
        goalTimer = math.max(0, GOAL_PAUSE - (os.clock() - goalStartTime))
        if goalTimer <= 0 then
            goalActive = false
            resetBall()
            hasPrevBall = false
            if elMessage then elMessage.Text = "" end
            if gameActive then
                teleportToKickoff()
                game:Broadcast("Play resumes!")
            end
        end
        prevBallZ = curZ
        hasPrevBall = true
        renderUI()
        return
    end

    -- Goal detection
    if hasPrevBall and gameActive then
        local g1 = game:GetPartPosition("goal1")
        local g2 = game:GetPartPosition("goal2")
        if g1 and g2 then
            local g1z = g1.z or g1.Z
            local g2z = g2.z or g2.Z
            local g1x = g1.x or g1.X
            local g2x = g2.x or g2.X
            if prevBallZ >= g1z and curZ < g1z then
                if curX > g1x - 15.2 and curX < g1x + 15.2 and curY > 0 and curY < GOAL_Y_MAX then
                    goalActive = true
                    goalStartTime = os.clock()
                    awayScore = awayScore + 1

                    local sTeam = lastToucher and getPlayerTeam(lastToucher)
                    local aTeam = prevToucher and getPlayerTeam(prevToucher)
                    local goalScorer = lastToucherName
                    local goalAssister = prevToucherName

                    if sTeam and sTeam == 1 then
                        goalScorer = "OWN GOAL"
                        goalAssister = nil
                        aTeam = nil
                    else
                        if aTeam and aTeam ~= 2 then
                            goalAssister = nil
                            aTeam = nil
                        end
                    end

                    showGoalBanner(2, goalScorer, goalAssister, sTeam, aTeam)
                    lastToucher = nil
                    prevToucher = nil
                end
            end
            if prevBallZ <= g2z and curZ > g2z then
                if curX > g2x - 15.2 and curX < g2x + 15.2 and curY > 0 and curY < GOAL_Y_MAX then
                    goalActive = true
                    goalStartTime = os.clock()
                    homeScore = homeScore + 1

                    local sTeam = lastToucher and getPlayerTeam(lastToucher)
                    local aTeam = prevToucher and getPlayerTeam(prevToucher)
                    local goalScorer = lastToucherName
                    local goalAssister = prevToucherName

                    if sTeam and sTeam == 2 then
                        goalScorer = "OWN GOAL"
                        goalAssister = nil
                        aTeam = nil
                    else
                        if aTeam and aTeam ~= 1 then
                            goalAssister = nil
                            aTeam = nil
                        end
                    end

                    showGoalBanner(1, goalScorer, goalAssister, sTeam, aTeam)
                    lastToucher = nil
                    prevToucher = nil
                end
            end
        end
    end

    prevBallZ = curZ
    hasPrevBall = true
    renderUI()
end

local onChat = function(player, message)
    local low = string.lower(message)

    if string.sub(low, 1, 8) == "tt|nmsg|" then
        local msgType = string.sub(message, 9)
        local parseEnd
        local parseStart

        if string.sub(msgType, 1, 4) == "TEAM" then
            parseEnd = string.find(msgType, "|", 6, true)
            if parseEnd then
                local pid = string.sub(msgType, 6, parseEnd - 1)
                local teamNum = tonumber(string.sub(msgType, parseEnd + 1))
                if pid and teamNum then
                    if window and window._bloxverse then
                        if not window._bloxverse._playerTeams then
                            window._bloxverse._playerTeams = {}
                        end
                        window._bloxverse._playerTeams[pid] = teamNum
                    end
                end
            end
            return
        end

        if msgType == "TOUCH" and player and player.id and player.id ~= lastToucher then
            local realName = player.name or "Player"
            local players = game:GetPlayers()
            for _, p in ipairs(players) do
                if p.id == player.id then
                    realName = p.name or realName
                    break
                end
            end
            prevToucher     = lastToucher
            prevToucherName = lastToucherName
            lastToucher     = player.id
            lastToucherName = realName
        end
        return
    end

    if low == "/start" then
        startGame()
        return
    end

    if low == "/end" then
        gameActive    = false
        breakActive   = false
        goalActive    = false
        gameEnded     = false
        gameTimer     = 0
        if elMessage then elMessage.Text = "Game stopped." end
        game:Broadcast("Game stopped by admin.")
        resetBall()
        renderUI()
        return
    end

    if string.sub(low, 1, 7) == "/team1 " then
        team1Name = string.upper(string.sub(message, 8))
        game:Broadcast("Team 1: " .. team1Name)
        renderUI()
        return
    end

    if string.sub(low, 1, 7) == "/team2 " then
        team2Name = string.upper(string.sub(message, 8))
        game:Broadcast("Team 2: " .. team2Name)
        renderUI()
        return
    end

    if low == "/score reset" then
        homeScore = 0
        awayScore = 0
        renderUI()
        return
    end

    if string.sub(low, 1, 9) == "/physics " then
        local mode = string.sub(low, 10)
        if mode == "normal" then
            if window and window._bloxverse then
                window._bloxverse.setPhysicsGravity(-196.2)
                window._bloxverse._physicsMode = "normal"
            end
            game:Broadcast("Physics set to NORMAL")
            return
        end
        if mode == "arcade" then
            if window and window._bloxverse then
                window._bloxverse.setPhysicsGravity(-100)
                window._bloxverse._physicsMode = "arcade"
            end
            game:Broadcast("Physics set to ARCADE (low gravity)")
        end
        return
    end
end

return { onUpdate = onUpdate, onChat = onChat }