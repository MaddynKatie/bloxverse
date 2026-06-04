local map2tp = workspace:FindFirstChild("Map2TP")
local map2 = workspace:FindFirstChild("Map2")

map2tp.Touched:Connect(function(hit)
    local pos = game:GetPartPosition("Map2")
    game:TeleportPlayer(pos.x, pos.y, pos.z)
end)