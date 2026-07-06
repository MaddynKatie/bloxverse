local field1 = workspace:FindFirstChild("Field1")
local field2 = workspace:FindFirstChild("Field2")

field1.Touched:Connect(function(hit)
    local pos = game:GetPartPosition("Field2")
    game:TeleportPlayer(pos.x - 5, pos.y + 5, pos.z)
end)