local field1 = workspace:FindFirstChild("Field1")
local field2 = workspace:FindFirstChild("Field2")

field2.Touched:Connect(function(hit)
    local pos = game:GetPartPosition("Field1")
    game:TeleportPlayer(pos.x + 5, pos.y + 5, pos.z)
end)