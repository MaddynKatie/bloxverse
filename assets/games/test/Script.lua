local spawner = game:GetPart("Spawner")

while true do
	local part = game:CreatePart("MyBall", spawner.x, spawner.y, spawner.z, 2, 2, 2, 0xff4400, 0.3, false, 0.1)
	wait(1)
	local bullet = game:CreatePart("bullet", spawner.x, spawner.y, spawner.z, 2, 2, 2, 0xff4400, 0.3, false, 0.01)
	bullet:SetVelocity(100, 100, 0)  -- Move the bullet
	wait(1)
end