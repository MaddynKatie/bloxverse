local function onUpdate(dt)
    if game:IsKeyDown("ShiftLeft") then
        game:SetWalkSpeed(25)
    else
        game:SetWalkSpeed(16)
    end
end

return {
    onUpdate = onUpdate,
}