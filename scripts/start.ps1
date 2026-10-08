Write-Host "`n=== Winter Ops Command Center ===`n"

# Ensure Node is installed
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js is not installed. Please install LTS from https://nodejs.org then run this script again." -ForegroundColor Yellow
  Read-Host "Press Enter to exit"
  exit 1
}

# cd to project root
Set-Location -Path (Join-Path $PSScriptRoot "..")

# Install deps if needed
if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}

# Ensure .env exists
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
}

# Start
Start-Process "http://localhost:5173"
Write-Host "Starting server..."
node server.js
Read-Host "Press Enter to exit"
