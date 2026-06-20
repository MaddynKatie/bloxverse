local state = window._bloxverse._mergeapart
if not state then
    state = { parts = {}, localUserId = "" }
    window._bloxverse._mergeapart = state
end
state.parts = state.parts or {}
state.heldByOthers = state.heldByOthers or {}
local heldByOthers = state.heldByOthers

local heldPart = nil
local heldTime = 0
local dropCooldown = 0
local dropButton = nil

local GRAB_MARGIN_XZ = 1.5
local GRAB_MARGIN_Y  = 1.0
local MERGE_MARGIN   = 2.0
local DROP_DIST      = 6
local FOLLOW_Y_OFFSET = 4

-- Create or update a part entry at given position/level/color/rotation
local ensurePart = function(id, x, y, z, level, cr, cg, cb, ry)
    local newSize = 1 + level * 1
    local floorY  = newSize / 2

    local existing = nil
    for _, p in ipairs(state.parts) do
        if p.part and p.part.Name == id and not p.destroyed then existing = p; break end
    end
    if existing and existing.part then
        existing.part.Size = {x = newSize, y = newSize, z = newSize}
        window._bloxverse._resizePart(existing.part.mesh, newSize, newSize, newSize)
        existing.part.Position = {x = x, y = floorY, z = z}
        window._bloxverse._setPartPos(existing.part.mesh, x, floorY, z, true)
        window._bloxverse._setPartRotation(existing.part.mesh, ry or 0)
        if cr then existing.part.Color = Color3.new(cr, cg, cb) end
        existing.level = level
        window._bloxverse.destroyBillboard(existing.sprite)
        existing.sprite = window._bloxverse.createBillboard("  [Lv." .. level .. "]  ", string.char(35) .. "ffffff", x, floorY + newSize / 2 + 0.5, z)
        return existing
    end

    if existing then
        window._bloxverse.destroyBillboard(existing.sprite)
        existing.sprite = nil
        existing.destroyed = true
        local alive = {}
        for _, e in ipairs(state.parts) do
            if not e.destroyed then table.insert(alive, e) end
        end
        state.parts = alive
    end

    local p = Instance.new("Part")
    p.Name = id
    p.Size = {x = newSize, y = newSize, z = newSize}
    p.Position = {x = x, y = floorY, z = z}
    p.Anchored = true
    p.CanCollide = false
    if cr then p.Color = Color3.new(cr, cg, cb) end
    p.Parent = workspace
    window._bloxverse._setPartRotation(p.mesh, ry or 0)
    local sp = window._bloxverse.createBillboard("  [Lv." .. level .. "]  ", string.char(35) .. "ffffff", x, floorY + newSize / 2 + 0.5, z)
    local entry = {part = p, sprite = sp, level = level, destroyed = false}
    table.insert(state.parts, entry)
    return entry
end

local destroyPartByName = function(name)
    if heldPart and heldPart.part and heldPart.part.Name == name then
        heldPart = nil
        dropButton.Visible = false
        dropCooldown = 1.0
    end
    local d = nil
    for _, de in ipairs(state.parts) do
        if de.part and de.part.Name == name and not de.destroyed then d = de; break end
    end
    if d then
        window._bloxverse.destroyBillboard(d.sprite)
        d.sprite = nil
        if d.part then
            d.part:Destroy()
            d.part = nil
        end
        d.destroyed = true
        local alive = {}
        for _, e in ipairs(state.parts) do
            if not e.destroyed then table.insert(alive, e) end
        end
        state.parts = alive
    end
end

local hidePartVisual = function(d)
    if not d or not d.part then return end
    window._bloxverse._setPartPos(d.part.mesh, 0, -999, 0, true)
    if d.sprite then
        d.sprite.position:set(0, -999, 0)
    end
end

local onGameStart = function()
    local lp = game:GetLocalPlayer()
    if lp then
        state.localUserId = lp.id
    end
    if not state.localUserId then state.localUserId = "" end

    local gui = game:CreateScreenGui("DropGUI")
    dropButton = gui:CreateGui("TextButton", {
        Text = "  DROP  ",
        PositionX = 0.5,
        PositionY = 0.2,
        SizeX = 140,
        SizeY = 50,
        TextColor = Color3.fromRGB(255, 255, 255),
        BackgroundColor = Color3.fromRGB(200, 50, 50),
    })
    dropButton.Visible = false

    dropButton.MouseButton1Click:Connect(function()
        if not heldPart or heldTime < 0.5 then return end
        local dropData = game:GetCharacterData()
        if not dropData then return end
        local size    = 1 + heldPart.level * 1
        local dropY   = size / 2
        local dx      = math.sin(dropData.ry) * DROP_DIST
        local dz      = math.cos(dropData.ry) * DROP_DIST
        local targetX = dropData.x + dx
        local targetZ = dropData.z + dz

        heldPart.part.Position = {x = targetX, y = dropY, z = targetZ}
        window._bloxverse._setPartPos(heldPart.part.mesh, targetX, dropY, targetZ, true)
        window._bloxverse._setPartRotation(heldPart.part.mesh, dropData.ry)
        heldPart.sprite.position:set(targetX, dropY + size / 2 + 0.5, targetZ)

        local col = heldPart.part.Color
        game:SendChat("TT|MG|DROP|" .. heldPart.part.Name .. "|" .. targetX .. "|" .. dropY .. "|" .. targetZ .. "|" .. heldPart.level .. "|" .. col.r .. "|" .. col.g .. "|" .. col.b .. "|" .. dropData.ry)
        dropCooldown = 1.0
        heldPart = nil
        dropButton.Visible = false
    end)
end

local onUpdate = function(dt)
    local charData = game:GetCharacterData()
    if not charData then return end

    if heldPart then
        heldTime = heldTime + dt

        local fx = charData.x
        local fy = charData.y + FOLLOW_Y_OFFSET
        local fz = charData.z

        heldPart.part.Position = {x = fx, y = fy, z = fz}
        window._bloxverse._setPartPos(heldPart.part.mesh, fx, fy, fz, true)
        window._bloxverse._setPartRotationOnly(heldPart.part.mesh, charData.ry)

        local pHalf = (1 + heldPart.level * 1) / 2
        heldPart.sprite.position:set(fx, fy + pHalf + 0.5, fz)

        -- Check for merge after holding for 1s
        if heldTime > 1.0 then
            for _, data in ipairs(state.parts) do
                if not data.destroyed and data.part and data ~= heldPart and data.level == heldPart.level then
                    local dx = data.part.Position.x - charData.x
                    local dz = data.part.Position.z - charData.z
                    local mHalf    = (1 + data.level * 1) / 2
                    local heldHalf = (1 + heldPart.level * 1) / 2
                    local thresh   = mHalf + heldHalf + MERGE_MARGIN
                    if dx * dx + dz * dz < thresh * thresh then
                        local destroyedName = data.part.Name
                        heldPart.level = heldPart.level + data.level
                        local newSize  = 1 + heldPart.level * 1
                        local newHalf  = newSize / 2

                        heldPart.part.Size = {x = newSize, y = newSize, z = newSize}
                        window._bloxverse._resizePart(heldPart.part.mesh, newSize, newSize, newSize)

                        local mergeDx  = math.sin(charData.ry) * DROP_DIST
                        local mergeDz  = math.cos(charData.ry) * DROP_DIST
                        local targetX  = charData.x + mergeDx
                        local targetZ  = charData.z + mergeDz
                        local dropY    = newHalf

                        window._bloxverse.destroyBillboard(heldPart.sprite)
                        heldPart.sprite = window._bloxverse.createBillboard("  [Lv." .. heldPart.level .. "]  ", string.char(35) .. "ffffff", targetX, dropY + newHalf + 0.5, targetZ)

                        data.part:Destroy()
                        data.destroyed = true
                        data.part = nil
                        window._bloxverse.destroyBillboard(data.sprite)
                        data.sprite = nil

                        local alive = {}
                        for _, d in ipairs(state.parts) do
                            if not d.destroyed then table.insert(alive, d) end
                        end
                        state.parts = alive

                        heldPart.part.Position = {x = targetX, y = dropY, z = targetZ}
                        window._bloxverse._setPartPos(heldPart.part.mesh, targetX, dropY, targetZ, true)
                        window._bloxverse._setPartRotation(heldPart.part.mesh, charData.ry)
                        heldPart.sprite.position:set(targetX, dropY + newHalf + 0.5, targetZ)

                        local mcol = heldPart.part.Color
                        game:SendChat("TT|MG|MERGE|" .. heldPart.part.Name .. "|" .. destroyedName .. "|" .. targetX .. "|" .. dropY .. "|" .. targetZ .. "|" .. heldPart.level .. "|" .. mcol.r .. "|" .. mcol.g .. "|" .. mcol.b .. "|" .. charData.ry)

                        -- Track best score (rendered by game.html leaderboard via TT|STAT|)
                        local newLevel = heldPart.level
                        if newLevel > (state.bestScore or 0) then
                            state.bestScore = newLevel
                            if state.localUserId and state.localUserId ~= "" then
                                game:SendChat("TT|STAT|" .. state.localUserId .. "|Best|" .. newLevel)
                            end
                        end

                        dropCooldown = 1.0
                        heldPart = nil
                        dropButton.Visible = false
                        break
                    end
                end
            end
        end
    else
        if dropCooldown > 0 then
            dropCooldown = dropCooldown - dt
        else
            for _, data in ipairs(state.parts) do
                if not data.destroyed and data.part then
                    local dx   = data.part.Position.x - charData.x
                    local dy   = data.part.Position.y - charData.y
                    local dz   = data.part.Position.z - charData.z
                    local pHalf = (1 + data.level * 1) / 2
                    if math.abs(dy) < pHalf + GRAB_MARGIN_Y and dx * dx + dz * dz < (pHalf + GRAB_MARGIN_XZ) * (pHalf + GRAB_MARGIN_XZ) then
                        heldPart = data
                        heldTime = 0
                        dropButton.Visible = true
                        dropCooldown = 0
                        game:SendChat("TT|MG|PICKUP|" .. data.part.Name)
                        break
                    end
                end
            end
        end
    end

    -- Move parts held by other players to follow them
    for uid, entry in pairs(heldByOthers) do
        if entry and not entry.destroyed and entry.part then
            local pl = game:FindPlayer(uid)
            if pl then
                local fy = pl.y + FOLLOW_Y_OFFSET
                window._bloxverse._setPartPos(entry.part.mesh, pl.x, fy, pl.z, true)
                local pHalf = (1 + entry.level * 1) / 2
                if entry.sprite then
                    entry.sprite.position:set(pl.x, fy + pHalf + 0.5, pl.z)
                end
            end
        end
    end
end

local onChat = function(player, message, data)
    local currentLocalId = state.localUserId
    if not currentLocalId or currentLocalId == "" then
        local lp = game:GetLocalPlayer()
        if lp then
            currentLocalId = lp.id
            state.localUserId = currentLocalId
        end
    end
    if data.userId == currentLocalId then return end

    local partsArr = message:split("|")
    if partsArr[0] ~= "TT" or partsArr[1] ~= "MG" then return end
    local cmd = partsArr[2]

    if cmd == "STATE" then
        local seen = {}
        local i = 3
        while i < #partsArr do
            local chunk = partsArr[i]:split(",")
            if #chunk >= 9 then
                local name = chunk[0]
                seen[name] = true
                ensurePart(name, tonumber(chunk[1]), tonumber(chunk[2]), tonumber(chunk[3]), tonumber(chunk[4]), tonumber(chunk[5]), tonumber(chunk[6]), tonumber(chunk[7]), tonumber(chunk[8]))
            end
            i = i + 1
        end
        -- Remove parts that no longer exist in state
        local alive = {}
        for _, entry in ipairs(state.parts) do
            if entry.part and seen[entry.part.Name] then
                table.insert(alive, entry)
            else
                if entry.part then entry.part:Destroy() end
                window._bloxverse.destroyBillboard(entry.sprite)
            end
        end
        state.parts = alive
        return
    end

    if cmd == "PICKUP" then
        local pName = partsArr[3]
        if not pName then return end
        local existing = nil
        for _, pe in ipairs(state.parts) do
            if pe.part and pe.part.Name == pName and not pe.destroyed then existing = pe; break end
        end
        if existing then
            -- Hide it visually but keep the entry so DROP/MERGE can find it
            hidePartVisual(existing)
            heldByOthers[data.userId] = existing
        end
        return
    end

    if cmd == "DROP" then
        local pName = partsArr[3]
        local x     = tonumber(partsArr[4])
        local y     = tonumber(partsArr[5])
        local z     = tonumber(partsArr[6])
        local level = tonumber(partsArr[7])
        local cr    = tonumber(partsArr[8])
        local cg    = tonumber(partsArr[9])
        local cb    = tonumber(partsArr[10])
        local ry    = tonumber(partsArr[11])
        if not pName or not x or not level then return end
        -- Clear from heldByOthers first
        heldByOthers[data.userId] = nil
        -- Update or create the part at the drop position
        ensurePart(pName, x, y, z, level, cr, cg, cb, ry)
        return
    end

    if cmd == "MERGE" then
        local targetName   = partsArr[3]
        local destroyedName = partsArr[4]
        local x     = tonumber(partsArr[5])
        local y     = tonumber(partsArr[6])
        local z     = tonumber(partsArr[7])
        local level = tonumber(partsArr[8])
        local cr    = tonumber(partsArr[9])
        local cg    = tonumber(partsArr[10])
        local cb    = tonumber(partsArr[11])
        local ry    = tonumber(partsArr[12])
        if not targetName or not destroyedName then return end
        heldByOthers[data.userId] = nil
        -- Destroy the consumed part
        destroyPartByName(destroyedName)
        -- Update the merged part at new position/level
        ensurePart(targetName, x, y, z, level, cr, cg, cb, ry)
        return
    end
end

return { onGameStart = onGameStart, onUpdate = onUpdate, onChat = onChat }