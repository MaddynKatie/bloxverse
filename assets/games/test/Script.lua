local spawner = game:GetPart("Spawner")

while true do
	local part = Instance.new("Part")
	part.Name = "MyBall"
	part.Size = Vector3.new(2, 2, 2)
	part.Position = Vector3.new(spawner.x, spawner.y, spawner.z)
	part.Color = 0xff4400
	part.Transparency = 0.3
	part.Anchored = false
	part.Parent = game.Workspace

	wait(1)

	local bullet = Instance.new("Part")
	bullet.Name = "Bullet"
	bullet.Size = Vector3.new(2, 2, 2)
	bullet.Position = Vector3.new(spawner.x, spawner.y, spawner.z)
	bullet.Color = 0xff4400
	bullet.Transparency = 0.3
	bullet.Anchored = false
	bullet.Parent = game.Workspace
	bullet:SetVelocity(100, 100, 0)

	wait(1)
end