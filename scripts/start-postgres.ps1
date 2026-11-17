$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
if (-not (Test-Path "$pgBin\pg_ctl.exe")) { throw 'PostgreSQL 17 binaries not found. Use infra/docker/compose.yml instead.' }
$databaseLine = Get-Content "$projectRoot\.env" | Where-Object { $_ -match '^DATABASE_URL=' }
if (-not $databaseLine) { throw 'Run npm run setup:env first.' }
$databaseUri = [Uri]($databaseLine -replace '^DATABASE_URL=', '')
$credentials = $databaseUri.UserInfo.Split(':', 2)
$databaseName = $databaseUri.AbsolutePath.Trim('/')
$dataPath = Join-Path $projectRoot '.local\postgres'
$logPath = Join-Path $projectRoot '.local\postgres.log'
New-Item -ItemType Directory -Force (Split-Path $dataPath -Parent) | Out-Null
if (-not (Test-Path "$dataPath\PG_VERSION")) {
  $passwordPath = Join-Path $projectRoot '.local\postgres-init-password'
  try {
    [IO.File]::WriteAllText($passwordPath, [Uri]::UnescapeDataString($credentials[1]))
    & "$pgBin\initdb.exe" -D $dataPath -U $credentials[0] --pwfile=$passwordPath --auth=scram-sha-256 --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  } finally { if (Test-Path $passwordPath) { Remove-Item -LiteralPath $passwordPath } }
}
& "$pgBin\pg_ctl.exe" -D $dataPath status | Out-Null
if ($LASTEXITCODE -ne 0) {
  & "$pgBin\pg_ctl.exe" -D $dataPath -l $logPath -o "-p $($databaseUri.Port) -h 127.0.0.1" start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL could not start; check .local/postgres.log' }
}
$env:PGPASSWORD = [Uri]::UnescapeDataString($credentials[1])
try {
  $existing = & "$pgBin\psql.exe" -h $databaseUri.Host -p $databaseUri.Port -U $credentials[0] -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$databaseName'"
  if ($LASTEXITCODE -ne 0) { throw 'Database connection failed' }
  if ($existing -ne '1') {
    & "$pgBin\createdb.exe" -h $databaseUri.Host -p $databaseUri.Port -U $credentials[0] $databaseName
    if ($LASTEXITCODE -ne 0) { throw 'Database creation failed' }
  }
  Write-Output "Isolated development database ready on port $($databaseUri.Port)."
} finally { Remove-Item Env:PGPASSWORD }
