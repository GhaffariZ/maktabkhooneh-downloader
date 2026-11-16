[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [string]$NodeRuntimeDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"

Write-Host "=== Maktabkhooneh Study Library Windows Packaging ===" -ForegroundColor Cyan

# 1. Resolve paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$resolvedNodeRuntime = (Resolve-Path $NodeRuntimeDirectory -ErrorAction Stop).Path

Write-Host "Repository root: $repoRoot"
Write-Host "Node runtime dir: $resolvedNodeRuntime"

# 2. Validate prerequisites in source repo
$distDir = Join-Path $repoRoot "dist"
if (-not (Test-Path $distDir)) {
    throw "Build artifact folder missing: '$distDir'. Please run 'npm run build' before packaging."
}

$desktopScript = Join-Path $repoRoot "scripts\desktop.mjs"
if (-not (Test-Path $desktopScript)) {
    throw "Desktop entry point missing: '$desktopScript'."
}

$packageJson = Join-Path $repoRoot "package.json"
if (-not (Test-Path $packageJson)) {
    throw "Root package.json missing: '$packageJson'."
}

$rootLicense = Join-Path $repoRoot "LICENSE"
if (-not (Test-Path $rootLicense)) {
    throw "Root LICENSE missing: '$rootLicense'."
}

$launcherSource = Join-Path $repoRoot "scripts\desktop\WindowsLauncher.cs"
if (-not (Test-Path $launcherSource)) {
    throw "Launcher source missing: '$launcherSource'."
}

# 3. Validate Node runtime contents
$nodeExe = Join-Path $resolvedNodeRuntime "node.exe"
if (-not (Test-Path $nodeExe)) {
    throw "Node executable not found in runtime directory: '$nodeExe'."
}

$nodeLicense = Join-Path $resolvedNodeRuntime "LICENSE"
if (-not (Test-Path $nodeLicense)) {
    # Check alternate naming if present (e.g. LICENSE.txt), else require LICENSE
    $altLicense = Join-Path $resolvedNodeRuntime "LICENSE.txt"
    if (Test-Path $altLicense) {
        $nodeLicense = $altLicense
    } else {
        throw "Node LICENSE not found in runtime directory: '$nodeLicense'."
    }
}

# 4. Resolve csc.exe compiler
$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $cscPath)) {
    $altCscPath = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
    if (Test-Path $altCscPath) {
        $cscPath = $altCscPath
    } else {
        throw "C# Compiler (csc.exe) not found at '$cscPath' or '$altCscPath'."
    }
}
Write-Host "Using C# compiler: $cscPath"

# 5. Determine version and staging folder
$packageJsonContent = Get-Content -Raw -Path $packageJson | ConvertFrom-Json
$version = $packageJsonContent.version
if (-not $version) {
    $version = "1.0.0"
}

# Ensure OutputDirectory exists
if (-not (Test-Path $OutputDirectory)) {
    New-Item -Path $OutputDirectory -ItemType Directory -Force | Out-Null
}
$resolvedOutputDir = (Resolve-Path $OutputDirectory).Path

# Unique versioned stage directory name
$packageName = "Maktabkhooneh-Study-Library-v$version-win-x64-preview"
$stageDir = Join-Path $resolvedOutputDir $packageName
$zipPath = Join-Path $resolvedOutputDir "$packageName.zip"

if (Test-Path $stageDir) {
    throw "Stage directory already exists: '$stageDir'. Refusing to overwrite existing build directory."
}
if (Test-Path $zipPath) {
    throw "Destination zip package already exists: '$zipPath'. Refusing to overwrite existing package."
}

Write-Host "Creating staging directory: $stageDir"
New-Item -Path $stageDir -ItemType Directory | Out-Null

try {
    # 6. Copy dist directory
    Write-Host "Copying dist tree..."
    Copy-Item -Path $distDir -Destination (Join-Path $stageDir "dist") -Recurse -Force

    # 7. Copy scripts/desktop.mjs
    $targetScriptsDir = Join-Path $stageDir "scripts"
    New-Item -Path $targetScriptsDir -ItemType Directory -Force | Out-Null
    Copy-Item -Path $desktopScript -Destination (Join-Path $targetScriptsDir "desktop.mjs") -Force

    # 8. Copy root package.json (essential for ESM "type": "module")
    Copy-Item -Path $packageJson -Destination (Join-Path $stageDir "package.json") -Force

    # 9. Copy root LICENSE
    Copy-Item -Path $rootLicense -Destination (Join-Path $stageDir "LICENSE") -Force

    # Copy docs if present
    $docsDir = Join-Path $repoRoot "docs"
    if (Test-Path $docsDir) {
        Copy-Item -Path $docsDir -Destination (Join-Path $stageDir "docs") -Recurse -Force
    }

    # 10. Copy runtime (node.exe and LICENSE)
    $targetRuntimeDir = Join-Path $stageDir "runtime"
    New-Item -Path $targetRuntimeDir -ItemType Directory -Force | Out-Null
    Copy-Item -Path $nodeExe -Destination (Join-Path $targetRuntimeDir "node.exe") -Force
    Copy-Item -Path $nodeLicense -Destination (Join-Path $targetRuntimeDir "LICENSE") -Force

    # 11. Compile C# launcher executable
    $launcherExeName = "Maktabkhooneh Study Library.exe"
    $launcherExePath = Join-Path $stageDir $launcherExeName
    Write-Host "Compiling Windows launcher into '$launcherExeName'..."

    $cscArgs = @(
        "/target:winexe",
        "/nologo",
        "/optimize+",
        "/reference:System.dll",
        "/reference:System.Windows.Forms.dll",
        "/reference:System.Drawing.dll",
        "/reference:System.Core.dll",
        "/out:$launcherExePath",
        "$launcherSource"
    )

    & $cscPath @cscArgs
    if ($LASTEXITCODE -ne 0) {
        throw "C# compilation failed with exit code $LASTEXITCODE."
    }

    if (-not (Test-Path $launcherExePath)) {
        throw "Expected compiled executable not found at '$launcherExePath'."
    }

    # 12. Create zip package
    Write-Host "Creating portable archive: $zipPath..."
    Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

    Write-Host "Package build successful!" -ForegroundColor Green
    Write-Host "Portable archive created: $zipPath"
}
catch {
    Write-Error "Build failed: $_"
    throw $_
}
