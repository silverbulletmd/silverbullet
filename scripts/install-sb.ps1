# Install the SilverBullet CLI (sb) on Windows.
#
#   irm https://silverbullet.md/install-sb.ps1 | iex
#
# `iex` cannot pass parameters, so options come from the environment:
#   $env:SB_CHANNEL = "edge"      # stable (default) or edge
#   $env:SB_VERSION = "2.12.0"    # a specific release
#   $env:SB_INSTALL_DIR = "..."   # default: %LOCALAPPDATA%\SilverBullet\bin
#
# Everything runs inside Install-SilverBulletCli, invoked on the last line, so a
# download cut off midway never executes a partial script.

function Install-SilverBulletCli {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    # Windows PowerShell 5.1 does not enable TLS 1.2 by default.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $releases = if ($env:SB_RELEASE_BASE) { $env:SB_RELEASE_BASE } else { 'https://github.com/silverbulletmd/silverbullet/releases' }
    $channel = if ($env:SB_CHANNEL) { $env:SB_CHANNEL } else { 'stable' }
    # ARM64 Windows runs the x64 build under emulation.
    $asset = 'sb-windows-x86_64.zip'
    if ($env:SB_VERSION) {
        $url = "$releases/download/$($env:SB_VERSION.TrimStart('v'))/$asset"
    } elseif ($channel -eq 'edge') {
        $url = "$releases/download/edge/$asset"
    } elseif ($channel -eq 'stable') {
        $url = "$releases/latest/download/$asset"
    } else {
        throw "Unknown channel '$channel' (use stable or edge)."
    }

    $dir = if ($env:SB_INSTALL_DIR) { $env:SB_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'SilverBullet\bin' }
    $target = Join-Path $dir 'sb.exe'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    $work = Join-Path ([IO.Path]::GetTempPath()) ("sb-install-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    try {
        $zip = Join-Path $work $asset
        Write-Host "Downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $work -Force
        $downloaded = Join-Path $work 'sb.exe'
        if (-not (Test-Path $downloaded)) { throw 'The release archive does not contain sb.exe.' }

        # A running sb.exe cannot be overwritten, but it can be renamed.
        $old = "$target.old"
        if (Test-Path $old) { Remove-Item -Force $old -ErrorAction SilentlyContinue }
        if (Test-Path $target) { Move-Item -Force $target $old }
        Move-Item -Force $downloaded $target
        if (Test-Path $old) { Remove-Item -Force $old -ErrorAction SilentlyContinue }
    } finally {
        Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    }

    # setx truncates long values; edit the user Path directly instead.
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    $parts = @($userPath -split ';' | Where-Object { $_ -and $_ -ne $dir })
    if (($userPath -split ';') -notcontains $dir) {
        [Environment]::SetEnvironmentVariable('Path', ((@($dir) + $parts) -join ';'), 'User')
        Write-Host "Added $dir to your user Path. New terminals will pick it up."
    }
    if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$dir;$env:Path" }

    $version = & $target version
    Write-Host "Installed sb $version to $target"
    $found = (Get-Command sb -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if ($found -and ($found -ne $target)) {
        Write-Warning "$found comes earlier on your Path and will run instead of $target"
    }
    Write-Host ''
    Write-Host 'Get started: sb space add https://notes.example.com   (or: sb --help)'
}

Install-SilverBulletCli
