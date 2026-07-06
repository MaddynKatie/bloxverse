local map1tp = workspace:FindFirstChild("Map1TP")
local map1 = workspace:FindFirstChild("Map1")

map1tp.Touched:Connect(function(hit)
    local pos = game:GetPartPosition("Map1")
    game:TeleportPlayer(pos.x, pos.y, pos.z)
end)