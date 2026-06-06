local function onUpdate(dt)
    if game:IsKeyDown("KeyC") then
        game:SetWalkSpeed(25)
    else
        game:SetWalkSpeed(16)
    end
end

return {
    onUpdate = onUpdate,
}