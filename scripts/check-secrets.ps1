[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$extensions = @(".css", ".env", ".example", ".html", ".js", ".json", ".md", ".ps1", ".ts", ".tsx", ".yaml", ".yml")
$patterns = @(
    "-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "mysql(?:2)?://[^\s:/]+:[^\s@]+@",
    "(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}",
    "DATABASE_(?:PASSWORD|MIGRATION_PASSWORD|TEST_PASSWORD)=[A-Za-z0-9_+/=-]{16,}"
)
$excludedRoots = @(".local", "node_modules", ".pnpm-store", "dist", "coverage")
$hits = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

$files = & rg --files $projectRoot
if ($LASTEXITCODE -ne 0) {
    throw "Unable to enumerate project files with rg."
}

foreach ($file in $files) {
    $absolutePath = [System.IO.Path]::GetFullPath($file)
    $relativePath = $absolutePath.Substring($projectRoot.Length).TrimStart("\", "/")
    $segments = $relativePath -split "[\\/]"
    if ($segments | Where-Object { $excludedRoots -contains $_ }) {
        continue
    }
    if ($extensions -notcontains [System.IO.Path]::GetExtension($file)) {
        continue
    }

    $content = [System.IO.File]::ReadAllText($file)
    foreach ($pattern in $patterns) {
        if ([regex]::IsMatch($content, $pattern)) {
            [void]$hits.Add($relativePath)
        }
    }
}

if ($hits.Count -gt 0) {
    Write-Error "Potential secret patterns were found in: $([string]::Join(', ', $hits))"
    exit 1
}

Write-Output "Secret scan passed for project source files."
