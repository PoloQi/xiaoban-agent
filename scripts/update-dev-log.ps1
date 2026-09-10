[CmdletBinding()]
param(
    [string]$Summary = "",
    [string[]]$Completed = @(),
    [string[]]$ChangedFiles = @(),
    [string[]]$Verification = @(),
    [string[]]$Todo = @(),
    [string[]]$Risks = @(),
    [ValidateSet("manual", "automatic-daily")]
    [string]$Source = "manual",
    [switch]$OncePerDay
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot "开发日志"
$currentDate = Get-Date -Format "yyyy-MM-dd"
$currentTime = Get-Date -Format "HH:mm"
$logPath = Join-Path $logDirectory "$currentDate.md"
$marker = "<!-- dev-log:${currentDate}:${Source} -->"

if (-not (Test-Path -LiteralPath $logDirectory)) {
    New-Item -ItemType Directory -Path $logDirectory | Out-Null
}

if (-not (Test-Path -LiteralPath $logPath)) {
    $header = @"
# 开发日志 $currentDate

> 项目：小伴AI陪伴智能体  
> 当前阶段：参见docs/07_EXECUTION_ROADMAP.md  

## 记录
"@
    Set-Content -LiteralPath $logPath -Value $header -Encoding utf8
}

if ($OncePerDay -and (Select-String -LiteralPath $logPath -SimpleMatch $marker -Quiet)) {
    Write-Output "Daily log entry already exists: $logPath"
    exit 0
}

function Add-ListSection {
    param(
        [System.Collections.Generic.List[string]]$Lines,
        [string]$Title,
        [string[]]$Items,
        [string]$EmptyText
    )

    $Lines.Add("**$Title**")
    $Lines.Add("")
    if ($Items.Count -eq 0) {
        $Lines.Add("- $EmptyText")
    } else {
        foreach ($item in $Items) {
            if (-not [string]::IsNullOrWhiteSpace($item)) {
                $Lines.Add("- $item")
            }
        }
    }
    $Lines.Add("")
}

$entry = [System.Collections.Generic.List[string]]::new()
$entry.Add("")
$entry.Add($marker)
$entry.Add("### $currentTime")
$entry.Add("")
$entry.Add("**摘要**")
$entry.Add("")
$entry.Add($(if ([string]::IsNullOrWhiteSpace($Summary)) { "- 本次未提供摘要。" } else { "- $Summary" }))
$entry.Add("")

Add-ListSection -Lines $entry -Title "已完成" -Items $Completed -EmptyText "无已确认完成事项。"
Add-ListSection -Lines $entry -Title "修改文件" -Items $ChangedFiles -EmptyText "无文件变更。"
Add-ListSection -Lines $entry -Title "验证" -Items $Verification -EmptyText "无新增验证结果。"
Add-ListSection -Lines $entry -Title "待办" -Items $Todo -EmptyText "无新增待办。"
Add-ListSection -Lines $entry -Title "阻塞与风险" -Items $Risks -EmptyText "无已知阻塞。"

Add-Content -LiteralPath $logPath -Value $entry -Encoding utf8
Write-Output "Updated development log: $logPath"
