local function onPlayerJoin(player)
    local teamNumber = math.random(1, 2)  -- Team 1 or 2
    player:SetProperty("team", teamNumber)
    local teamName = teamNumber == 1 and "Red" or "Blue"
    game:Broadcast(player.name .. " joined Team " .. teamName)
end

return {
    onPlayerJoin = onPlayerJoin,
}