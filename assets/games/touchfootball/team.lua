local TEAM_RED = "ff4444"
local TEAM_BLUE = "4444ff"

local assignTeam
assignTeam = function(player, teamNumber)
    player:SetProperty("team", teamNumber)
    local color = teamNumber == 1 and TEAM_RED or TEAM_BLUE
    game:SetPlayerBodyColor(player.id, color)
end

local function onGameStart()
    local p = game:GetLocalPlayer()
    if p then
        local teamNumber = math.random(1, 2)
        assignTeam(p, teamNumber)
        local teamName = teamNumber == 1 and "Red" or "Blue"
        game:Broadcast("You joined Team " .. teamName)
    end
end

local function onPlayerJoin(player)
    local teamNumber = math.random(1, 2)
    assignTeam(player, teamNumber)
    local teamName = teamNumber == 1 and "Red" or "Blue"
    game:Broadcast(player.name .. " joined Team " .. teamName)
end

return {
    onGameStart = onGameStart,
    onPlayerJoin = onPlayerJoin,
}
