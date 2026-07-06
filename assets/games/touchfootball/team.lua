local function onGameStart()
    local p = game:GetLocalPlayer()
    if p then
        game:Broadcast("Welcome! Teams are assigned when game starts.")
        game:Broadcast("Controls: Q sprint, E charge kick | /start to begin match")
    end
end

local function onPlayerJoin(player)
    game:Broadcast(player.name .. " joined")
    game:Broadcast("Controls: Q sprint, E charge kick | !bot, !dumbbot, !goalkeeper [home/away/both/easy/med/hard/ext]")
    game:Broadcast("Commands: /start, /end, /team1/2 NAME, /score reset, /texture NAME, /resetparts")
end

return {
    onGameStart = onGameStart,
    onPlayerJoin = onPlayerJoin,
}
