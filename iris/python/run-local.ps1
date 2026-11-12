$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$instanceDirectory = Join-Path $PSScriptRoot "instance"
$databasePath = Join-Path $instanceDirectory "iris.sqlite3"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Project Python environment not found. Create it and install requirements-api.txt first."
}

New-Item -ItemType Directory -Force -Path $instanceDirectory | Out-Null
$env:IRIS_DB_PATH = $databasePath

$registrationCount = 0
if (Test-Path -LiteralPath $databasePath) {
    $registrationCount = [int](& $python -c "import os, sqlite3; connection = sqlite3.connect(os.environ['IRIS_DB_PATH']); table = connection.execute('SELECT 1 FROM sqlite_master WHERE type=? AND name=?', ('table', 'templates')).fetchone(); print(connection.execute('SELECT COUNT(*) FROM templates').fetchone()[0] if table else 0); connection.close()")
}

if ($registrationCount -gt 0) {
    $secureKey = Read-Host "Enter the saved Fernet encryption key" -AsSecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
        $encryptionKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    if ([string]::IsNullOrWhiteSpace($encryptionKey)) {
        throw "An encryption key is required to use the existing database."
    }
    $env:IRIS_ENCRYPTION_KEY = $encryptionKey.Trim()
}
else {
    $env:IRIS_ENCRYPTION_KEY = (& $python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())").Trim()
    Write-Host "A new encryption key was generated because there are no registrations. Save it privately for future runs:"
    Write-Host $env:IRIS_ENCRYPTION_KEY
}

if ([string]::IsNullOrWhiteSpace($env:IRIS_API_TOKEN)) {
    $env:IRIS_API_TOKEN = (& $python -c "import secrets; print(secrets.token_urlsafe(32))").Trim()
    Write-Host "Local access key for the UI:"
    Write-Host $env:IRIS_API_TOKEN
}
elseif ($env:IRIS_API_TOKEN.Trim().Length -lt 32) {
    throw "IRIS_API_TOKEN must contain at least 32 characters."
}
else {
    $env:IRIS_API_TOKEN = $env:IRIS_API_TOKEN.Trim()
    Write-Host "Using the provided IRIS_API_TOKEN for the UI."
}
Write-Host "Keep this terminal open while using the app."

& $python -m uvicorn api.main:app --host 127.0.0.1 --port 8000