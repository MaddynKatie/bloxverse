local playerCount = 0

local getBalancedTeam
getBalancedTeam = function()
    playerCount = playerCount + 1
    return (playerCount % 2 == 1) and 1 or 2
end

local function onGameStart()
    local p = game:GetLocalPlayer()
    if p then
        local teamNumber = getBalancedTeam()
        p:SetProperty("team", teamNumber)
        local teamName = teamNumber == 1 and "Red" or "Blue"
        game:Broadcast("You joined Team " .. teamName)
    end
end

local function onPlayerJoin(player)
    local teamNumber = getBalancedTeam()
    player:SetProperty("team", teamNumber)
    local teamName = teamNumber == 1 and "Red" or "Blue"
    game:Broadcast(player.name .. " joined Team " .. teamName)
    game:Broadcast("Controls: C to sprint, E to charge kick")
end

return {
    onGameStart = onGameStart,
    onPlayerJoin = onPlayerJoin,
}
