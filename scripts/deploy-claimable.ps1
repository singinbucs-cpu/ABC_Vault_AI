$ErrorActionPreference = "Stop"

$projectPath = Split-Path -Parent $PSScriptRoot
$tempRoot = Join-Path $env:TEMP ("abc-vault-deploy-" + [guid]::NewGuid().ToString())
$staging = Join-Path $tempRoot "staging"
$tarball = Join-Path $tempRoot "project.tgz"

try {
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    Get-ChildItem -LiteralPath $projectPath -Force |
        Where-Object {
            $_.Name -notin @(".git", "node_modules", ".vercel") -and
            -not $_.Name.StartsWith(".env")
        } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $staging -Recurse -Force
        }

    & tar.exe -czf $tarball -C $staging .
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create deployment tarball."
    }

    $responseJson = & curl.exe -s -X POST "https://codex-deploy-skills.vercel.sh/api/deploy" -F "file=@$tarball" -F "framework=null"
    if (-not $responseJson) {
        throw "Deployment endpoint returned an empty response."
    }

    $response = $responseJson | ConvertFrom-Json
    if ($response.error) {
        throw $response.error
    }

    if (-not $response.previewUrl) {
        throw "Preview URL missing from deployment response."
    }

    $attempt = 0
    $maxAttempts = 60

    while ($attempt -lt $maxAttempts) {
        $status = & curl.exe -s -o NUL -w "%{http_code}" $response.previewUrl
        if (-not $status) {
            $status = "000"
        }

        if ([int]$status -eq 200 -or ([int]$status -ge 400 -and [int]$status -lt 500)) {
            break
        }

        if ([int]$status -ge 500) {
            Start-Sleep -Seconds 5
            $attempt++
            continue
        }

        break
    }

    Write-Output ("PREVIEW_URL=" + $response.previewUrl)
    Write-Output ("CLAIM_URL=" + $response.claimUrl)
    Write-Output ("DEPLOYMENT_ID=" + $response.deploymentId)
    Write-Output ("PROJECT_ID=" + $response.projectId)
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
