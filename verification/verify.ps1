param(
    [switch]$Ui
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

Push-Location $root
try {
    $node = (Get-Command node -ErrorAction Stop).Source
    $nodeMajor = [int](& $node -p "process.versions.node.split('.')[0]")
    if ($nodeMajor -lt 18) {
        throw 'Node.js 18 or newer is required for verification.'
    }

    $sourceDirectories = @('scripts', 'popup', 'options', 'verification')
    $javascriptFiles = Get-ChildItem $sourceDirectories -Recurse -File -Filter '*.js'
    foreach ($file in $javascriptFiles) {
        Invoke-Native -FilePath $node -Arguments @('--check', $file.FullName)
    }

    $tests = Get-ChildItem 'verification' -File -Filter 'test_*.js' | Sort-Object Name
    foreach ($test in $tests) {
        Invoke-Native -FilePath $node -Arguments @($test.FullName)
    }

    Get-Content 'manifest.json' -Raw | ConvertFrom-Json | Out-Null

    if ($Ui) {
        $python = (Get-Command python -ErrorAction Stop).Source
        Invoke-Native -FilePath $python -Arguments @('verification/verify_settings.py')
    }

    Write-Host 'Verification completed successfully.'
} finally {
    Pop-Location
}
