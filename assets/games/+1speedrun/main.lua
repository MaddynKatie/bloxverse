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
local _rebirthCount = 0
local _rebirthMultiplier = 1
local _rebirthMenuOpen = false

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

local rebirthMultLabel = gui:CreateGui("TextLabel", {
	PositionX = 0.92,
	PositionY = 0.32,
	SizeX = 140,
	SizeY = 24,
	Text = "Multiplier x1 (Rebirth)",
	TextColor = Color3.fromRGB(100, 200, 255),
	FontSize = 12,
	BackgroundColor = "transparent",
})

local maxSpeedLabel = gui:CreateGui("TextLabel", {
	PositionX = 0.92,
	PositionY = 0.36,
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



local getRebirthTarget = function()
	return 100 * math.pow(2, _rebirthCount)
end

local rebirthBtn = gui:CreateGui("TextButton", {
	PositionX = 0.02,
	PositionY = 0.40,
	SizeX = 90,
	SizeY = 32,
	Text = "Rebirth",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 14,
	BackgroundColor = Color3.fromRGB(180, 60, 60),
})

-- Rebirth menu (created hidden)
local rebirthBackdrop = gui:CreateGui("TextButton", {
	PositionX = 0.5,
	PositionY = 0,
	SizeX = 1,
	SizeY = 1,
	Text = "",
	BackgroundColor = Color3.fromRGB(0, 0, 0),
	BackgroundTransparency = 0.4,
	Visible = false,
	ZIndex = 100,
})
local rbMenuBox = gui:CreateGui("Frame", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 340,
	SizeY = 340,
	BackgroundColor = Color3.fromRGB(25, 25, 40),
	Visible = false,
	ZIndex = 101,
})
local rbTitle = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 340,
	SizeY = 40,
	Text = "Rebirth",
	TextColor = Color3.fromRGB(255, 200, 50),
	FontSize = 24,
	BackgroundColor = "transparent",
	Visible = false,
	ZIndex = 102,
})
local rbLevelReq = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 200,
	SizeY = 30,
	Text = "Level (target)",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 16,
	BackgroundColor = Color3.fromRGB(200, 170, 50),
	Visible = false,
	ZIndex = 102,
})
local rbCurrentMult = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 110,
	SizeY = 28,
	Text = "x1.0 Speed",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 14,
	BackgroundColor = Color3.fromRGB(50, 180, 80),
	Visible = false,
	ZIndex = 102,
})
local rbArrow = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 30,
	SizeY = 28,
	Text = "→",
	TextColor = Color3.fromRGB(200, 200, 200),
	FontSize = 20,
	BackgroundColor = "transparent",
	Visible = false,
	ZIndex = 102,
})
local rbNextMult = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 110,
	SizeY = 28,
	Text = "x1.5 Speed",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 14,
	BackgroundColor = Color3.fromRGB(50, 180, 80),
	Visible = false,
	ZIndex = 102,
})
local rbInfo = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 300,
	SizeY = 24,
	Text = "Rebirth resets your speed level!",
	TextColor = Color3.fromRGB(255, 200, 50),
	FontSize = 13,
	BackgroundColor = "transparent",
	Visible = false,
	ZIndex = 102,
})
local rbProgressBar = gui:CreateGui("Frame", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 280,
	SizeY = 30,
	BackgroundColor = Color3.fromRGB(30, 60, 120),
	Visible = false,
	ZIndex = 102,
})
local rbProgressFill = gui:CreateGui("Frame", {
	PositionX = 0,
	PositionY = 0,
	SizeX = 0,
	SizeY = 30,
	BackgroundColor = Color3.fromRGB(50, 180, 230),
	Visible = false,
	ZIndex = 103,
})
local rbLevelText = gui:CreateGui("TextLabel", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 280,
	SizeY = 30,
	Text = "Level 1 / 10",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 15,
	BackgroundColor = "transparent",
	Visible = false,
	ZIndex = 103,
})
local rbDoBtn = gui:CreateGui("TextButton", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 110,
	SizeY = 36,
	Text = "Rebirth",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 15,
	BackgroundColor = Color3.fromRGB(200, 60, 80),
	Visible = false,
	ZIndex = 102,
})
local rbSkipBtn = gui:CreateGui("TextButton", {
	PositionX = 0.5,
	PositionY = 0.45,
	SizeX = 110,
	SizeY = 36,
	Text = "Skip Rebirth!",
	TextColor = Color3.fromRGB(255, 255, 255),
	FontSize = 13,
	BackgroundColor = Color3.fromRGB(30, 180, 200),
	Visible = false,
	ZIndex = 102,
})

local positionMenu = function()
	pw = gui._wrapper.clientWidth
	ph = gui._wrapper.clientHeight
	if pw <= 0 or ph <= 0 then return end
	local cx = 0.5 * pw
	local cy = 0.45 * ph
	rbMenuBox.PositionX = cx
	rbMenuBox.PositionY = cy - 170
	rbTitle.PositionX = cx
	rbTitle.PositionY = cy - 170
	rbLevelReq.PositionX = cx
	rbLevelReq.PositionY = cy - 120
	rbCurrentMult.PositionX = cx - 85
	rbCurrentMult.PositionY = cy - 75
	rbArrow.PositionX = cx
	rbArrow.PositionY = cy - 75
	rbNextMult.PositionX = cx + 85
	rbNextMult.PositionY = cy - 75
	rbInfo.PositionX = cx
	rbInfo.PositionY = cy - 35
	rbProgressBar.PositionX = cx
	rbProgressBar.PositionY = cy + 5
	local barLeft = cx - 140
	rbProgressFill.PositionX = barLeft
	rbProgressFill.PositionY = cy + 5
	rbLevelText.PositionX = cx
	rbLevelText.PositionY = cy + 5
	rbDoBtn.PositionX = cx - 85
	rbDoBtn.PositionY = cy + 50
	rbSkipBtn.PositionX = cx + 85
	rbSkipBtn.PositionY = cy + 50
end

local updateRebirthMenu = function()
	positionMenu()
	local target = 25 * math.pow(2, _rebirthCount)
	local mult = 1 + 0.5 * _rebirthCount
	local nextMult = 1 + 0.5 * (_rebirthCount + 1)
	local multStr = "x" .. string.format("%.1f", mult) .. " Speed"
	local nextStr = "x" .. string.format("%.1f", nextMult) .. " Speed"
	rbLevelReq.Text = "Level " .. target
	rbCurrentMult.Text = multStr
	rbNextMult.Text = nextStr
	local pw2 = gui._wrapper.clientWidth
	local cx2 = 0.5 * pw2
	local barLeft2 = cx2 - 140
	local progress = math.min(1, level / target)
	local fw = progress * 280
	rbProgressFill.SizeX = fw
	rbProgressFill.PositionX = barLeft2 + fw / 2
	rbLevelText.Text = "Level " .. level .. " / " .. target
	rebirthMultLabel.Text = "Multiplier x" .. string.format("%.1f", _rebirthMultiplier) .. " (Rebirth)"
	if level >= target then
		rbDoBtn.BackgroundColor = Color3.fromRGB(200, 60, 80)
	else
		rbDoBtn.BackgroundColor = Color3.fromRGB(100, 100, 100)
	end
end

local openRebirthMenu = function()
	if _rebirthMenuOpen then return end
	_rebirthMenuOpen = true
	positionMenu()
	updateRebirthMenu()
	rebirthBackdrop.Visible = true
	rbMenuBox.Visible = true
	rbTitle.Visible = true
	rbLevelReq.Visible = true
	rbCurrentMult.Visible = true
	rbArrow.Visible = true
	rbNextMult.Visible = true
	rbInfo.Visible = true
	rbProgressBar.Visible = true
	rbProgressFill.Visible = true
	rbLevelText.Visible = true
	rbDoBtn.Visible = true
	rbSkipBtn.Visible = true
end

local closeRebirthMenu = function()
	_rebirthMenuOpen = false
	rebirthBackdrop.Visible = false
	rbMenuBox.Visible = false
	rbTitle.Visible = false
	rbLevelReq.Visible = false
	rbCurrentMult.Visible = false
	rbArrow.Visible = false
	rbNextMult.Visible = false
	rbInfo.Visible = false
	rbProgressBar.Visible = false
	rbProgressFill.Visible = false
	rbLevelText.Visible = false
	rbDoBtn.Visible = false
	rbSkipBtn.Visible = false
end

local doRebirth = function()
	local target = 25 * math.pow(2, _rebirthCount)
	if level < target then return end
	level = 1
	speed = 0
	_rebirthCount = _rebirthCount + 1
	_rebirthMultiplier = 1 + 0.5 * _rebirthCount
	currentWalkSpeed = (12 + (level - 1) * 2) * _rebirthMultiplier
	game:SetWalkSpeed(currentWalkSpeed)
	currentSpeedLabel.Text = "Current: " .. currentWalkSpeed
	maxSpeedLabel.Text = "Max: " .. (12 + (level - 1) * 2) * _rebirthMultiplier
	rebirthMultLabel.Text = "Multiplier x" .. string.format("%.1f", _rebirthMultiplier) .. " (Rebirth)"
	closeRebirthMenu()
end

local skipRebirth = function()
	game:PromptDeduct(20, "Skip Rebirth")
end

game.On("DeductComplete", function(success, name)
	if success and name == "Skip Rebirth" then
		_rebirthCount = _rebirthCount + 1
		_rebirthMultiplier = 1 + 0.5 * _rebirthCount
		currentWalkSpeed = (12 + (level - 1) * 2) * _rebirthMultiplier
		game:SetWalkSpeed(currentWalkSpeed)
		currentSpeedLabel.Text = "Current: " .. currentWalkSpeed
		maxSpeedLabel.Text = "Max: " .. (12 + (level - 1) * 2) * _rebirthMultiplier
		rebirthMultLabel.Text = "Multiplier x" .. string.format("%.1f", _rebirthMultiplier) .. " (Rebirth)"
		closeRebirthMenu()
	end
end)

rebirthBtn.MouseButton1Click:Connect(function()
	openRebirthMenu()
end)

rebirthBackdrop.MouseButton1Click:Connect(function()
	closeRebirthMenu()
end)

rbDoBtn.MouseButton1Click:Connect(function()
	doRebirth()
end)

rbSkipBtn.MouseButton1Click:Connect(function()
	skipRebirth()
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
		game:SendChat("TT|STAT|" .. lp.id .. "|Wins|" .. totalWins)
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
			return true
		end
	end
	return false
end

local onChat = function(player, message, data)
	local parts = message:split("|")
	if #parts >= 5 and parts[0] == "TT" and parts[1] == "STAT" then
		local pid = parts[2]
		local statName = parts[3]
		local raw = parts[4]
		local lp = game:GetLocalPlayer()
		if lp and statName == "Wins" and pid == tostring(lp.id) then
			local value = tonumber(raw)
			if value and value > totalWins then
				totalWins = value
				if _stepPadsSetup then
					autoEquipStep()
					updateStepPadColors()
				end
			end
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
				-- Clone materials so each pad has independent colors
				-- (engine caches materials by size+color, shared with other parts)
				do
					local m = entry.mesh.material
					if m and m.clone then
						entry.mesh.material = m:clone()
					elseif m then
						local cloned = {}
						for _, mat in ipairs(m) do
							table.insert(cloned, mat:clone())
						end
						entry.mesh.material = cloned
					end
				end
				local pos = entry.mesh.position
				local stepLabel = "👟 +" .. s.num .. "/step"
				local reqLabel = "Requires " .. s.winsReq .. " wins"
				local greenSprite = window._bloxverse.createBillboard(
					stepLabel, "#00FF00",
					pos.x, pos.y + 6, pos.z, 120
				)
				local orangeSprite = window._bloxverse.createBillboard(
					reqLabel, "#FF8C00",
					pos.x, pos.y + 3.5, pos.z, 80
				)
				local instRef = entry.mesh._instRef
				local conn = nil
				if instRef and instRef.Touched then
					conn = instRef.Touched:Connect(function()
						print("Step pad touched: num=" .. s.num .. " winsReq=" .. s.winsReq .. " totalWins=" .. totalWins .. " equipped=" .. equippedStep)
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

local retryLoadWins = function()
	delay(1, function()
		if not _stepPadsSetup then
			-- step pads not ready yet, retry later
			retryLoadWins()
			return
		end
		local loaded = loadInitialWins()
		if loaded then
			autoEquipStep()
			updateStepPadColors()
		end
	end)
end

local _treadmillTimer = 0
local _treadmillConnected = false
local _goldTreadmillConnected = false
local _diamondTreadmillConnected = false
local _promptCooldown = 0
local _currentTreadmill = "basic"

local updateTreadmillTouch = function()
	if not _treadmillConnected then
		local p = workspace:FindFirstChild("basicTreadmill")
		if p then
			_treadmillConnected = true
			local pos = p.Position
			window._bloxverse.createBillboard("👟\nx1 Speed", "#FFFFFF", pos.x, pos.y + 5, pos.z, 64)
			p.Touched:Connect(function()
				_treadmillTimer = 0.3
				_currentTreadmill = "basic"
			end)
		end
	end
	if not _goldTreadmillConnected then
		local p = workspace:FindFirstChild("goldTreadmill")
		if p then
			_goldTreadmillConnected = true
			local pos = p.Position
			window._bloxverse.createBillboard("👟\nx3 Speed", "#FFD700", pos.x, pos.y + 5, pos.z, 64)
			p.Touched:Connect(function()
				if game:HasGamepass("speedrun_goldtreadmill") then
					_treadmillTimer = 0.3
					_currentTreadmill = "gold"
					return
				end
				if _promptCooldown > 0 then return end
				_promptCooldown = 2
				game:PromptPurchase("speedrun_goldtreadmill", "Gold Treadmill", 45)
			end)
		end
	end
	if not _diamondTreadmillConnected then
		local p = workspace:FindFirstChild("diamondTreadmill")
		if p then
			_diamondTreadmillConnected = true
			local pos = p.Position
			window._bloxverse.createBillboard("👟\nx9 Speed", "#00BFFF", pos.x, pos.y + 5, pos.z, 64)
			p.Touched:Connect(function()
				if game:HasGamepass("speedrun_diamondtreadmill") then
					_treadmillTimer = 0.3
					_currentTreadmill = "diamond"
					return
				end
				if _promptCooldown > 0 then return end
				_promptCooldown = 2
				game:PromptPurchase("speedrun_diamondtreadmill", "Diamond Treadmill", 80)
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
						pos.x, pos.y + 5, pos.z, 128
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
	currentWalkSpeed = (12 + (1 - 1) * 2) * _rebirthMultiplier
	game:SetWalkSpeed(currentWalkSpeed)
	maxSpeedLabel.Text = "Max: " .. (12 + (level - 1) * 2) * _rebirthMultiplier

	local sp = game:GetPartPosition("SpawnLocation")
	if sp then
		spawnPos = { x = sp.x, y = sp.y + 2, z = sp.z }
	end

	rebirthMultLabel.Text = "Multiplier x" .. string.format("%.1f", _rebirthMultiplier) .. " (Rebirth)"
	layout()
	setupStepPads()
	updateWinBillboards()
	updateWinsStat()
	retryLoadWins()
end

local onUpdate = function(dt)
	if not layoutDone then
		layout()
	end

	local charData = game:GetCharacterData()
	if charData then
		_treadmillTimer = math.max(0, _treadmillTimer - dt)
		_promptCooldown = math.max(0, _promptCooldown - dt)
		local prevOnTreadmill = onTreadmill
		onTreadmill = _treadmillTimer > 0

		if onTreadmill ~= prevOnTreadmill then
			window._bloxverse.setFakeMoving(onTreadmill)
		end

		if charData.moving or onTreadmill then
			walkTimer = walkTimer + dt
			if walkTimer >= 0.1 then
				walkTimer = 0
				local stepMult = 1
				if onTreadmill then
					if _currentTreadmill == "diamond" then
						stepMult = 9
					elseif _currentTreadmill == "gold" then
						stepMult = 3
					end
				end
				local gained = equippedStep * stepMult
				speed = speed + gained
				totalSpeed = totalSpeed + gained

				speedTextTimer = speedTextTimer + gained
				if speedTextTimer >= 3 then
					speedTextTimer = 0
					spawnFloatingText(charData.x, charData.y, charData.z, gained)
				end

				local toNext = level == 1 and 100 or 80 + level * 60
				if speed >= toNext then
					speed = speed - toNext
					level = level + 1
					speedToLevel = level == 1 and 100 or 80 + level * 60
					currentWalkSpeed = (12 + (level - 1) * 2) * _rebirthMultiplier
					game:SetWalkSpeed(currentWalkSpeed)
					currentSpeedLabel.Text = "Current: " .. currentWalkSpeed
					maxSpeedLabel.Text = "Max: " .. (12 + (level - 1) * 2) * _rebirthMultiplier
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
end

return { onGameStart = onGameStart, onUpdate = onUpdate, onChat = onChat }