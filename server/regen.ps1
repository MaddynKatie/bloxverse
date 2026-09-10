$ErrorActionPreference = 'Stop'
$creds = Join-Path $env:TEMP 'bv-regen'

$sa = Join-Path $creds 'serviceAccount.json'
if (-not (Test-Path $sa)) { throw "Missing: $sa`nPaste your Firebase service-account JSON there." }
$env:FIREBASE_SERVICE_ACCOUNT_JSON = (Get-Content -Raw $sa).Trim()

if (Test-Path (Join-Path $creds 'cloudinary.url')) {
  $env:CLOUDINARY_URL = (Get-Content -Raw (Join-Path $creds 'cloudinary.url')).Trim()
} elseif ((Test-Path (Join-Path $creds 'cloudinary.key')) -and
          (Test-Path (Join-Path $creds 'cloudinary.secret')) -and
          (Test-Path (Join-Path $creds 'cloudinary.cloud'))) {
  $env:CLOUDINARY_API_KEY = (Get-Content -Raw (Join-Path $creds 'cloudinary.key')).Trim()
  $env:CLOUDINARY_API_SECRET = (Get-Content -Raw (Join-Path $creds 'cloudinary.secret')).Trim()
  $env:CLOUDINARY_CLOUD_NAME = (Get-Content -Raw (Join-Path $creds 'cloudinary.cloud')).Trim()
} else {
  throw "Need Cloudinary creds: either cloudinary.url, or cloudinary.key/.secret/.cloud in $creds"
}

Write-Host "Creds loaded from $creds. Running regenerate-avatars.js $args ..."
& node "$PSScriptRoot\regenerate-avatars.js" @args
exit $LASTEXITCODE