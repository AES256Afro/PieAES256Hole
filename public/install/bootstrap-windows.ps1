#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"
$Product = "Pie AES256 Hole"
$StatusDirectory = Join-Path $env:ProgramData "PieAES256Hole"
$StatusFile = Join-Path $StatusDirectory "bootstrap-status.json"

function Write-Step([string]$Message) {
    Write-Host "`n[$Product] $Message" -ForegroundColor Green
}

$Principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Step "Administrator approval is required once"
    $Arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($SkipDocker) { $Arguments += "-SkipDocker" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $Arguments
    exit
}

if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "Windows Package Manager (winget) is required. Install App Installer from Microsoft Store and run this script again."
}

Write-Step "Checking Windows requirements"
$TailscaleExe = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
if (-not (Test-Path $TailscaleExe)) {
    Write-Step "Installing Tailscale"
    winget install --exact --id Tailscale.Tailscale --accept-package-agreements --accept-source-agreements
}

if (-not (Test-Path $TailscaleExe)) {
    throw "Tailscale installed but its command line tool was not found. Restart Windows and run this script again."
}

Write-Step "Authenticating this device with Tailscale"
& $TailscaleExe up --unattended=true
$TailscaleStatus = & $TailscaleExe status --json | ConvertFrom-Json
$TailscaleAuthenticated = $TailscaleStatus.BackendState -eq "Running"

$DockerInstalled = Test-Path (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
if (-not $DockerInstalled -and -not $SkipDocker) {
    Write-Step "Installing Docker Desktop"
    Write-Host "Docker Desktop has separate subscription terms: https://www.docker.com/legal/docker-subscription-service-agreement/"
    $Reply = Read-Host "Install Docker Desktop after reviewing those terms? [y/N]"
    if ($Reply -match '^[Yy]$') {
        winget install --exact --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
        $DockerInstalled = $true
        Start-Process (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
    }
}

$DockerRunning = $false
$PiHoleInstalled = $false
$PiHoleRunning = $false
$PiHoleAdminUrl = ""
$PiHolePasswordFile = ""
$DockerExe = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
if ($DockerInstalled -and -not $SkipDocker) {
    if (-not (Test-Path $DockerExe)) {
        throw "Docker Desktop is installed but docker.exe was not found. Restart Windows and run this script again."
    }
    if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
        Start-Process (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
    }
    Write-Step "Waiting for Docker Desktop"
    for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
        & $DockerExe info *> $null
        if ($LASTEXITCODE -eq 0) { $DockerRunning = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $DockerRunning) {
        throw "Docker Desktop did not become ready. Finish its first-run setup and run this script again."
    }

    Write-Step "Installing Pi-hole in Docker"
    $PiHoleDirectory = Join-Path $StatusDirectory "pihole"
    $PiHoleDataDirectory = Join-Path $PiHoleDirectory "etc-pihole"
    $PiHolePasswordFile = Join-Path $PiHoleDirectory "pihole_webpasswd"
    New-Item -ItemType Directory -Force -Path $PiHoleDataDirectory | Out-Null

    if (-not (Test-Path $PiHolePasswordFile)) {
        $RandomBytes = New-Object byte[] 24
        $Random = [Security.Cryptography.RandomNumberGenerator]::Create()
        $Random.GetBytes($RandomBytes)
        $Random.Dispose()
        [Convert]::ToBase64String($RandomBytes) | Set-Content -Encoding ASCII $PiHolePasswordFile
    }

    & $DockerExe container inspect pihole *> $null
    $ExistingPiHole = $LASTEXITCODE -eq 0
    $WebPort = 80
    if (-not $ExistingPiHole) {
        $DnsTcp = Get-NetTCPConnection -State Listen -LocalPort 53 -ErrorAction SilentlyContinue
        $DnsUdp = Get-NetUDPEndpoint -LocalPort 53 -ErrorAction SilentlyContinue
        if ($DnsTcp -or $DnsUdp) {
            throw "DNS port 53 is already in use. Pi-hole was not started to avoid disrupting the existing DNS service."
        }
        if (Get-NetTCPConnection -State Listen -LocalPort 80 -ErrorAction SilentlyContinue) {
            $WebPort = 8080
        }
    } else {
        $PortLine = (& $DockerExe port pihole 80/tcp | Select-Object -First 1)
        if ($PortLine -match ':(\d+)$') { $WebPort = [int]$Matches[1] }
    }

    $ComposeFile = Join-Path $PiHoleDirectory "compose.yaml"
    @"
services:
  pihole:
    container_name: pihole
    image: pihole/pihole:2026.05.0
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "${WebPort}:80/tcp"
    environment:
      TZ: "UTC"
      WEBPASSWORD_FILE: pihole_webpasswd
      FTLCONF_dns_listeningMode: "all"
      FTLCONF_dns_upstreams: "1.1.1.1;9.9.9.9"
    volumes:
      - ./etc-pihole:/etc/pihole
    secrets:
      - pihole_webpasswd
    restart: unless-stopped
secrets:
  pihole_webpasswd:
    file: ./pihole_webpasswd
"@ | Set-Content -Encoding ASCII $ComposeFile

    & $DockerExe compose -f $ComposeFile pull
    if ($LASTEXITCODE -ne 0) { throw "Could not download the official Pi-hole image." }
    & $DockerExe compose -f $ComposeFile up -d
    if ($LASTEXITCODE -ne 0) { throw "Could not start Pi-hole." }
    $PiHoleInstalled = $true

    for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:${WebPort}/admin/" -TimeoutSec 3 | Out-Null
            $PiHoleRunning = $true
            break
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    if (-not $PiHoleRunning) {
        & $DockerExe compose -f $ComposeFile logs --tail=80 pihole
        throw "Pi-hole did not become ready. Its data remains in $PiHoleDirectory."
    }
    $TailscaleIPv4 = (& $TailscaleExe ip -4 | Select-Object -First 1)
    $PiHoleAdminUrl = "http://${TailscaleIPv4}:${WebPort}/admin/"
}

New-Item -ItemType Directory -Force -Path $StatusDirectory | Out-Null
$Status = [ordered]@{
    schemaVersion = 1
    platform = "windows"
    role = "local-test-appliance"
    tailscaleInstalled = $true
    tailscaleAuthenticated = $TailscaleAuthenticated
    dockerInstalled = $DockerInstalled
    dockerRunning = $DockerRunning
    piholeInstalled = $PiHoleInstalled
    piholeRunning = $PiHoleRunning
    piholeAdminUrl = $PiHoleAdminUrl
    piholePasswordFile = $PiHolePasswordFile
}
$Status | ConvertTo-Json | Set-Content -Encoding UTF8 $StatusFile

Write-Step "Bootstrap check complete"
Write-Host "Status saved to $StatusFile"
if (-not $TailscaleAuthenticated) {
    throw "Finish Tailscale authentication and run this script again."
}
if (-not $SkipDocker -and -not $PiHoleRunning) {
    throw "Pi-hole is not running. Review the installer output."
}
Write-Host "Pi-hole admin: $PiHoleAdminUrl"
Write-Host "Admin password file: $PiHolePasswordFile"
Write-Host "This Windows device is ready as a local test appliance. Docker Desktop still requires startup after reboot."
