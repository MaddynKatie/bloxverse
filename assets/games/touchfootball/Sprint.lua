-- Sprint
local function onUpdate(dt)
    local speed = game:GetWalkSpeed()
    if game:IsKeyDown("ShiftLeft") then
        game:SetWalkSpeed(25)  -- Sprint
    else
        game:SetWalkSpeed(16)  -- Normal walk
    end
end