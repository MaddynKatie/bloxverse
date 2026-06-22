-- Server-side win tracking for +1speedrun
-- Persists wins in memory, sends to newly joining players

local wins = {}  -- userId -> totalWins

local onPlayerJoin = function(player)
	for uid, total in pairs(wins) do
		game:SendChat("TT|STAT|" .. uid .. "|Wins|" .. total)
	end
end

local onChat = function(player, message, data)
	local parts = string.split(message, "|")
	if #parts >= 5 and parts[0] == "TT" and parts[1] == "STAT" then
		local pid = parts[2]
		local statName = parts[3]
		local raw = parts[4]
		if pid and statName == "Wins" then
			local value = tonumber(raw)
			if value then
				wins[pid] = value
			end
		end
	end
end

return {
	onPlayerJoin = onPlayerJoin,
	onChat = onChat,
}
