local speed = 0
local level = 1
local totalSpeed = 0
local speedToLevel = 100
local barWidth = 480
local walkTimer = 0
local pw = 0
local ph = 0
local barLeft = 0
local barRight = 0
local currentWalkSpeed = 12
local layoutDone = false
local winBillboards = {}
local totalWins = 0
local spawnPos = nil
local onTreadmill = false
local floatingTexts = {}
local speedTextTimer = 0

local gui = game:CreateScreenGui("SpeedRunGUI")

local speedHeader = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.80,
	SizeX = 200,
	SizeY = 26,
	Text = "Speed",
	TextColor = Color3.fromRGB(150, 200, 255),
	FontSize = 22,
	BackgroundColor = "transparent",
})

local totalSpeedLabel = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.85,
	SizeX = 400,
	SizeY = 36,
	Text = "0",
	TextColor = Color3.fromRGB(255, 255, 100),
	FontSize = 36,
	BackgroundColor = "transparent",
})

local barFrame = gui:CreateGui("Frame", {
	PositionX = 0.5,
	PositionY = 0.92,
	SizeX = barWidth,
	SizeY = 36,
	BackgroundColor = Color3.fromRGB(25, 25, 35),
})

local barFill = gui:CreateGui("Frame", {
	PositionX = 0,
	PositionY = 0.92,
	SizeX = 0,
	SizeY = 36,
	BackgroundColor = Color3.fromRGB(50, 220, 100),
})

local levelLabel = gui:CreateGui("TextLabel", {
	PositionX = 0,
	PositionY = 0.92,
	SizeX = 80,
	SizeY = 36,
	Text = "Lv 1",
	TextColor = Color3.fromRGB(255, 200, 50),
	FontSize = 16,
	BackgroundColor = "transparent",
})

local progressLabel = gui:CreateGui("TextLabel", {
	PositionX = 0,
	PositionY = 0.92,
	SizeX = 160,
	SizeY = 36,
	Text = "0 / 100",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 16,
	BackgroundColor = "transparent",
})

-- Right side panel
local panelFrame = gui:CreateGui("Frame", {
	PositionX = 0.92,
	PositionY = 0.26,
	SizeX = 160,
	SizeY = 190,
	BackgroundColor = Color3.fromRGB(20, 20, 30),
})

local currentSpeedLabel = gui:CreateGui("TextLabel", {
	PositionX = 0.92,
	PositionY = 0.27,
	SizeX = 140,
	SizeY = 24,
	Text = "Current: 12",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 14,
	BackgroundColor = "transparent",
})

local maxSpeedLabel = gui:CreateGui("TextLabel", {
	PositionX = 0.92,
	PositionY = 0.32,
	SizeX = 140,
	SizeY = 24,
	Text = "Max: 12",
	TextColor = Color3.fromRGB(200, 200, 200),
	FontSize = 14,
	BackgroundColor = "transparent",
})

-- DOM text input in panel area
local doc = window.document
local inputEl = doc.createElement("input")
inputEl.type = "text"
inputEl.placeholder = "Speed"
inputEl.style.cssText = "position:fixed;width:120px;height:28px;background:" .. "#" .. "333;color:" .. "#" .. "fff;border:1px solid " .. "#" .. "666;border-radius:4px;padding:4px 8px;font-size:13px;outline:none;text-align:center;z-index:600;"
doc.body.appendChild(inputEl)

local setSpeedBtn = gui:CreateGui("TextButton", {
	PositionX = 0.92,
	PositionY = 0.44,
	SizeX = 120,
	SizeY = 32,
	Text = "Set Speed",
	TextColor = Color3.fromRGB(255, 255, 255),
	BackgroundColor = Color3.fromRGB(50, 120, 220),
})

setSpeedBtn.MouseButton1Click:Connect(function()
	local max = 12 + (level - 1) * 2
	local val = tonumber(inputEl.value)
	if val and val >= 0 and val <= max then
		currentWalkSpeed = val
		game:SetWalkSpeed(val)
		currentSpeedLabel.Text = "Current: " .. val
	end
end)

local layout = function()
	if not layoutDone then
		pw = gui._wrapper.clientWidth
		ph = gui._wrapper.clientHeight
		if pw and pw > 0 and ph and ph > 0 then
			barLeft = 0.5 * pw - barWidth / 2
			barRight = 0.5 * pw + barWidth / 2
			levelLabel.PositionX = barLeft + 45
			progressLabel.PositionX = barRight - 90
			inputEl.style.left = (0.92 * pw - 60) .. "px"
			inputEl.style.top = (0.37 * ph) .. "px"
			layoutDone = true
		end
	end
end

local updateWinsStat = function()
	local lp = game:GetLocalPlayer()
	if lp then
		game:SetPlayerStat(lp.id, "Wins", totalWins)
	end
end

-- Step pad system
local stepData = {}
table.insert(stepData, { num = 1, winsReq = 0 })
table.insert(stepData, { num = 2, winsReq = 3 })
table.insert(stepData, { num = 5, winsReq = 15 })
table.insert(stepData, { num = 25, winsReq = 100 })
table.insert(stepData, { num = 50, winsReq = 500 })
table.insert(stepData, { num = 100, winsReq = 2500 })
local stepPads = {}
local equippedStep = 1
local _stepPadsSetup = false

local STEP_YELLOW = 16776960
local STEP_GREEN = 3444288
local STEP_GRAY = 5987689

local updateStepPadColors = function()
	print("updateStepPadColors: totalWins=" .. totalWins .. " equippedStep=" .. equippedStep)
	for _, pad in ipairs(stepPads) do
		local col = STEP_GRAY
		if pad.data.num == equippedStep then
			col = STEP_YELLOW
		elseif totalWins >= pad.data.winsReq then
			col = STEP_GREEN
		end
		print("  pad " .. pad.data.num .. " col=" .. col .. " winsReq=" .. pad.data.winsReq .. " unlocked=" .. tostring(totalWins >= pad.data.winsReq))
		if pad.mesh then
			window._bloxverse._setPartColor(pad.mesh, col)
		end
	end
end

local autoEquipStep = function()
	local best = equippedStep
	for _, s in ipairs(stepData) do
		if totalWins >= s.winsReq and s.num > best then
			best = s.num
		end
	end
	if best ~= equippedStep then
		equippedStep = best
		updateStepPadColors()
		currentSpeedLabel.Text = "Current: " .. currentWalkSpeed
	end
end

local loadInitialWins = function()
	local lp = game:GetLocalPlayer()
	if lp then
		local saved = game:GetPlayerStat(lp.id, "Wins")
		if saved and saved > totalWins then
			totalWins = saved
		end
	end
end

local setupStepPads = function()
	if _stepPadsSetup then return end
	local allFound = true
	for _, s in ipairs(stepData) do
		local name = "Step-" .. s.num
		local part = workspace:FindFirstChild(name)
		if part then
			local entry = nil
			for _, e in ipairs(window._mapParts or {}) do
				if e.name == name then
					entry = e
					break
				end
			end
			if entry and entry.mesh then
				local pos = entry.mesh.position
				local stepLabel = "👟 +" .. s.num .. "/step"
				local reqLabel = "Requires " .. s.winsReq .. " wins"
				local greenSprite = window._bloxverse.createBillboard(
					stepLabel, "#00FF00",
					pos.x, pos.y + 4, pos.z, 48
				)
				local orangeSprite = window._bloxverse.createBillboard(
					reqLabel, "#FF8C00",
					pos.x, pos.y + 2.5, pos.z, 36
				)
				local instRef = entry.mesh._instRef
				local conn = nil
				if instRef and instRef.Touched then
					conn = instRef.Touched:Connect(function()
						if totalWins >= s.winsReq then
							if equippedStep ~= s.num then
								equippedStep = s.num
								currentSpeedLabel.Text = "Current: " .. currentWalkSpeed
								updateStepPadColors()
							end
						end
					end)
				end
				table.insert(stepPads, {
					mesh = entry.mesh,
					data = s,
					greenSprite = greenSprite,
					orangeSprite = orangeSprite,
					connection = conn,
				})
			end
		else
			allFound = false
		end
	end
	if allFound then
		_stepPadsSetup = true
		loadInitialWins()
		autoEquipStep()
		updateStepPadColors()
	end
end

local _treadmillTimer = 0

-- Treadmill touch detection using tp1.lua pattern
local _tm1, _tm2, _tm3
local updateTreadmillTouch = function()
	if not _tm1 then
		local p = workspace:FindFirstChild("basicTreadmill")
		if p then
			_tm1 = true
			p.Touched:Connect(function()
				_treadmillTimer = 0.3
			end)
		end
	end
	if not _tm2 then
		local p = workspace:FindFirstChild("basicTreadmill2")
		if p then
			_tm2 = true
			p.Touched:Connect(function()
				_treadmillTimer = 0.3
			end)
		end
	end
	if not _tm3 then
		local p = workspace:FindFirstChild("basicTreadmill3")
		if p then
			_tm3 = true
			p.Touched:Connect(function()
				_treadmillTimer = 0.3
			end)
		end
	end
end

local spawnFloatingText = function(cx, cy, cz, amount)
	local dirX = (math.random() - 0.5) * 4
	local dirZ = (math.random() - 0.5) * 4
	local sprite = window._bloxverse.createBillboard(
		"👟 +" .. amount, "#FFFFFF",
		cx + dirX, cy + 1, cz + dirZ, 48
	)
	table.insert(floatingTexts, {
		sprite = sprite,
		life = 0,
		startY = cy + 1,
		endY = cy - 3,
		duration = 0.8,
	})
end

local updateFloatingTexts = function(dt)
	local alive = {}
	for _, ft in ipairs(floatingTexts) do
		ft.life = ft.life + dt
		local t = math.min(1, ft.life / ft.duration)
		local alpha = 1 - t
		if alpha <= 0 then
			window._bloxverse.destroyBillboard(ft.sprite)
		else
			ft.sprite.position.y = ft.startY + (ft.endY - ft.startY) * t
			ft.sprite.material.opacity = alpha
			ft.sprite.material.transparent = true
			table.insert(alive, ft)
		end
	end
	floatingTexts = alive
end

local updateWinBillboards = function()
	for _, entry in ipairs(window._mapParts or {}) do
		local name = entry.name
		if name and string.sub(name, 1, 4) == "Win-" then
			local numStr = string.sub(name, 5)
			local num = tonumber(numStr)
			if num and not winBillboards[name] then
				local pos = entry.mesh.position
				local label = num == 1 and "+1 Win 🏆" or "+" .. num .. " Wins 🏆"
				winBillboards[name] = {
					sprite = window._bloxverse.createBillboard(
						label, "#FFD700",
						pos.x, pos.y + 3, pos.z, 72
					),
				}
				local instRef = entry.mesh._instRef
				if instRef and instRef.Touched then
					winBillboards[name].connection = instRef.Touched:Connect(function()
						if not winBillboards[name].claimed then
							winBillboards[name].claimed = true
							totalWins = totalWins + num
							print("Win claimed: +" .. num .. " totalWins=" .. totalWins)
							updateWinsStat()
							autoEquipStep()
							updateStepPadColors()
							if spawnPos then
								game:TeleportPlayer(spawnPos.x, spawnPos.y, spawnPos.z)
							else
								local sp = game:GetPartPosition("SpawnLocation")
								if sp then
									game:TeleportPlayer(sp.x, sp.y + 2, sp.z)
								end
							end
							winBillboards[name].claimed = false
						end
					end)
				end
			end
		end
	end
end

local onGameStart = function()
	currentWalkSpeed = 12 + (1 - 1) * 2
	game:SetWalkSpeed(currentWalkSpeed)
	maxSpeedLabel.Text = "Max: " .. (12 + (level - 1) * 2)

	local sp = game:GetPartPosition("SpawnLocation")
	if sp then
		spawnPos = { x = sp.x, y = sp.y + 2, z = sp.z }
	end

	layout()
	setupStepPads()
	updateWinBillboards()
	updateWinsStat()
end

local onUpdate = function(dt)
	if not layoutDone then
		layout()
	end

	local charData = game:GetCharacterData()
	if charData then
		_treadmillTimer = math.max(0, _treadmillTimer - dt)
		local prevOnTreadmill = onTreadmill
		onTreadmill = _treadmillTimer > 0

		if onTreadmill ~= prevOnTreadmill then
			window._bloxverse.setFakeMoving(onTreadmill)
		end

		if charData.moving or onTreadmill then
			walkTimer = walkTimer + dt
			if walkTimer >= 0.1 then
				walkTimer = 0
				speed = speed + equippedStep
				totalSpeed = totalSpeed + equippedStep

				speedTextTimer = speedTextTimer + equippedStep
				if speedTextTimer >= 3 then
					speedTextTimer = 0
					spawnFloatingText(charData.x, charData.y, charData.z, equippedStep)
				end

				local toNext = level == 1 and 100 or 80 + level * 60
				if speed >= toNext then
					speed = speed - toNext
					level = level + 1
					speedToLevel = level == 1 and 100 or 80 + level * 60
					currentWalkSpeed = 12 + (level - 1) * 2
					game:SetWalkSpeed(currentWalkSpeed)
					currentSpeedLabel.Text = "Current: " .. currentWalkSpeed
					maxSpeedLabel.Text = "Max: " .. (12 + (level - 1) * 2)
				end

				local toNextDisplay = level == 1 and 100 or 80 + level * 60
				local progress = math.min(1, speed / toNextDisplay)
				local fillWidth = progress * barWidth
				barFill.SizeX = fillWidth
				barFill.PositionX = barLeft + fillWidth / 2
				progressLabel.Text = math.floor(speed) .. " / " .. toNextDisplay
				levelLabel.Text = "Lv " .. level
				totalSpeedLabel.Text = tostring(totalSpeed)
			end
		else
			walkTimer = 0
		end
	end

	updateFloatingTexts(dt)
	setupStepPads()
	updateTreadmillTouch()
	updateWinBillboards()
	autoEquipStep()
end

return { onGameStart = onGameStart, onUpdate = onUpdate }