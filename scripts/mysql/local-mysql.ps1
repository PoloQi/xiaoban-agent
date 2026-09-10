[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Install", "Start", "Stop", "Verify")]
    [string]$Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$mysqlVersion = "8.4.11"
$packageName = "mysql-$mysqlVersion-winx64.zip"
$packageUri = "https://cdn.mysql.com/Downloads/MySQL-8.4/$packageName"
$expectedMd5 = "2e833921898a9a030ea6bfe81bd811bc"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localRoot = Join-Path $projectRoot ".local"
$runtimeRoot = Join-Path $localRoot "mysql-8.4"
$dataRoot = Join-Path $localRoot "mysql-data"
$logRoot = Join-Path $localRoot "mysql-logs"
$runRoot = Join-Path $localRoot "mysql-run"
$secretRoot = Join-Path $localRoot "mysql-secrets"
$downloadRoot = Join-Path $localRoot "downloads"
$configPath = Join-Path $localRoot "mysql-8.4.ini"
$rootOptionsPath = Join-Path $secretRoot "root.cnf"
$port = 3307

function Convert-ToMySqlPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return $Path.Replace("\", "/")
}

function Assert-PathInsideLocalRoot {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolvedLocalRoot = [System.IO.Path]::GetFullPath($localRoot).TrimEnd("\")
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $isLocalRoot = $resolvedPath.Equals($resolvedLocalRoot, [System.StringComparison]::OrdinalIgnoreCase)
    $isInsideLocalRoot = $resolvedPath.StartsWith("$resolvedLocalRoot\", [System.StringComparison]::OrdinalIgnoreCase)
    if (-not ($isLocalRoot -or $isInsideLocalRoot)) {
        throw "Refusing to modify a path outside the project-local runtime directory: $resolvedPath"
    }
}

function Get-ExecutablePath {
    param([Parameter(Mandatory = $true)][string]$Name)

    $path = Join-Path (Join-Path $runtimeRoot "bin") $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "MySQL runtime is missing: $path. Run this script with -Action Install first."
    }
    return $path
}

function Test-PortOpen {
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $connectTask = $client.ConnectAsync("127.0.0.1", $port)
        if (-not $connectTask.Wait(300)) {
            $client.Dispose()
            return $false
        }
        $client.Dispose()
        return $true
    } catch {
        return $false
    }
}

function New-RandomPassword {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

function Protect-SecretDirectory {
    if (-not (Test-Path -LiteralPath $secretRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $secretRoot | Out-Null
    }

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = Get-Acl -LiteralPath $secretRoot
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) {
        $acl.RemoveAccessRuleAll($rule)
    }
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $identity,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit",
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($accessRule)
    Set-Acl -LiteralPath $secretRoot -AclObject $acl
}

function Write-ClientOptions {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][string]$Password
    )

    $content = @"
[client]
host=127.0.0.1
port=$port
protocol=tcp
user=$User
password=$Password
default-character-set=utf8mb4
"@
    Set-Content -LiteralPath $Path -Value $content -Encoding ascii
}

function Write-ServerConfig {
    $runtimePath = Convert-ToMySqlPath $runtimeRoot
    $dataPath = Convert-ToMySqlPath $dataRoot
    $errorLogPath = Convert-ToMySqlPath (Join-Path $logRoot "error.log")
    $pidPath = Convert-ToMySqlPath (Join-Path $runRoot "mysql.pid")
    $config = @"
[mysqld]
basedir=$runtimePath
datadir=$dataPath
port=$port
bind-address=127.0.0.1
mysqlx=0
skip-name-resolve
skip-log-bin
local-infile=0
secure-file-priv=NULL
default-storage-engine=InnoDB
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
default-time-zone=+00:00
sql-mode=STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
max-connections=30
log-error=$errorLogPath
pid-file=$pidPath
"@
    Set-Content -LiteralPath $configPath -Value $config -Encoding ascii
}

function Wait-ForServer {
    param([int]$TimeoutSeconds = 45)

    $mysqlAdmin = Get-ExecutablePath "mysqladmin.exe"
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $rootOptionsPath -PathType Leaf) {
            & $mysqlAdmin "--defaults-extra-file=$rootOptionsPath" ping --silent 2>$null
            if ($LASTEXITCODE -eq 0) {
                return
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw "MySQL did not become ready within $TimeoutSeconds seconds. Inspect .local/mysql-logs/error.log."
}

function Start-Server {
    param([string]$InitFile = "")

    if (Test-PortOpen) {
        if (Test-Path -LiteralPath $rootOptionsPath -PathType Leaf) {
            try {
                Wait-ForServer -TimeoutSeconds 2
                Write-Output "MySQL is already running on 127.0.0.1:$port."
                return
            } catch {
                throw "Port $port is occupied by a process that is not this project MySQL instance."
            }
        }
        throw "Port $port is already occupied."
    }

    $mysqld = Get-ExecutablePath "mysqld.exe"
    $arguments = [System.Collections.Generic.List[string]]::new()
    $arguments.Add("--defaults-file=$(Convert-ToMySqlPath $configPath)")
    if (-not [string]::IsNullOrWhiteSpace($InitFile)) {
        $arguments.Add("--init-file=$(Convert-ToMySqlPath $InitFile)")
    }

    $stdoutPath = Join-Path $logRoot "process.stdout.log"
    $stderrPath = Join-Path $logRoot "process.stderr.log"
    Start-Process -FilePath $mysqld -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath | Out-Null
    Wait-ForServer
    Write-Output "MySQL started on 127.0.0.1:$port."
}

function Install-Server {
    if ((Test-Path -LiteralPath $runtimeRoot) -or (Test-Path -LiteralPath $dataRoot) -or (Test-Path -LiteralPath $secretRoot)) {
        throw "A project-local MySQL runtime, data directory, or secret directory already exists. Refusing to overwrite it."
    }
    if (Test-PortOpen) {
        throw "Port $port is already occupied. Refusing to install."
    }

    foreach ($path in @($localRoot, $downloadRoot, $logRoot, $runRoot)) {
        Assert-PathInsideLocalRoot $path
        if (-not (Test-Path -LiteralPath $path)) {
            New-Item -ItemType Directory -Path $path | Out-Null
        }
    }

    $packagePath = Join-Path $downloadRoot $packageName
    Write-Output "Downloading MySQL $mysqlVersion LTS from the official MySQL CDN..."
    Invoke-WebRequest -Uri $packageUri -OutFile $packagePath -UseBasicParsing

    $actualMd5 = (Get-FileHash -LiteralPath $packagePath -Algorithm MD5).Hash.ToLowerInvariant()
    if ($actualMd5 -ne $expectedMd5) {
        throw "MySQL package checksum mismatch. Expected $expectedMd5 but received $actualMd5."
    }
    $sha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Output "Official MD5 checksum matched. Downloaded package SHA256: $sha256"

    $extractRoot = Join-Path $localRoot "mysql-extract-$mysqlVersion"
    $extractedRuntime = Join-Path $extractRoot "mysql-$mysqlVersion-winx64"
    foreach ($path in @($extractRoot, $extractedRuntime, $runtimeRoot)) {
        Assert-PathInsideLocalRoot $path
    }
    Expand-Archive -LiteralPath $packagePath -DestinationPath $extractRoot
    if (-not (Test-Path -LiteralPath (Join-Path $extractedRuntime "bin\mysqld.exe") -PathType Leaf)) {
        throw "The verified archive did not contain the expected MySQL runtime layout."
    }
    Move-Item -LiteralPath $extractedRuntime -Destination $runtimeRoot
    Remove-Item -LiteralPath $extractRoot
    Remove-Item -LiteralPath $packagePath

    foreach ($path in @($dataRoot, $logRoot, $runRoot)) {
        if (-not (Test-Path -LiteralPath $path)) {
            New-Item -ItemType Directory -Path $path | Out-Null
        }
    }
    Protect-SecretDirectory
    Write-ServerConfig

    $rootPassword = New-RandomPassword
    $migrationPassword = New-RandomPassword
    $appPassword = New-RandomPassword
    $testPassword = New-RandomPassword
    Write-ClientOptions -Path $rootOptionsPath -User "root" -Password $rootPassword
    Write-ClientOptions -Path (Join-Path $secretRoot "migration.cnf") -User "xiaoban_migrator" -Password $migrationPassword
    Write-ClientOptions -Path (Join-Path $secretRoot "app.cnf") -User "xiaoban_app" -Password $appPassword
    Write-ClientOptions -Path (Join-Path $secretRoot "test.cnf") -User "xiaoban_test" -Password $testPassword

    $environmentContent = @"
DATABASE_HOST=127.0.0.1
DATABASE_PORT=$port
DATABASE_NAME=xiaoban_dev
DATABASE_USER=xiaoban_app
DATABASE_PASSWORD=$appPassword
DATABASE_MIGRATION_USER=xiaoban_migrator
DATABASE_MIGRATION_PASSWORD=$migrationPassword
DATABASE_TEST_NAME=xiaoban_test
DATABASE_TEST_USER=xiaoban_test
DATABASE_TEST_PASSWORD=$testPassword
"@
    Set-Content -LiteralPath (Join-Path $secretRoot "database.env") -Value $environmentContent -Encoding ascii

    $bootstrapPath = Join-Path $secretRoot "bootstrap.sql"
    $bootstrapSql = @"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootPassword';
CREATE USER 'root'@'127.0.0.1' IDENTIFIED BY '$rootPassword';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
CREATE DATABASE xiaoban_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE xiaoban_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'xiaoban_migrator'@'127.0.0.1' IDENTIFIED BY '$migrationPassword';
CREATE USER 'xiaoban_app'@'127.0.0.1' IDENTIFIED BY '$appPassword';
CREATE USER 'xiaoban_test'@'127.0.0.1' IDENTIFIED BY '$testPassword';
GRANT ALL PRIVILEGES ON xiaoban_dev.* TO 'xiaoban_migrator'@'127.0.0.1';
GRANT ALL PRIVILEGES ON xiaoban_test.* TO 'xiaoban_migrator'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON xiaoban_dev.* TO 'xiaoban_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON xiaoban_test.* TO 'xiaoban_test'@'127.0.0.1';
"@
    Set-Content -LiteralPath $bootstrapPath -Value $bootstrapSql -Encoding ascii

    $mysqld = Get-ExecutablePath "mysqld.exe"
    Write-Output "Initializing an isolated MySQL data directory..."
    & $mysqld "--defaults-file=$(Convert-ToMySqlPath $configPath)" --initialize-insecure
    if ($LASTEXITCODE -ne 0) {
        throw "MySQL data-directory initialization failed."
    }

    Start-Server -InitFile $bootstrapPath
    Remove-Item -LiteralPath $bootstrapPath -Force
    Write-Output "Project-local MySQL $mysqlVersion installation completed. Credentials are stored only under the ignored .local/mysql-secrets directory."
}

function Stop-Server {
    if (-not (Test-PortOpen)) {
        Write-Output "MySQL is not running on 127.0.0.1:$port."
        return
    }
    $mysqlAdmin = Get-ExecutablePath "mysqladmin.exe"
    if (-not (Test-Path -LiteralPath $rootOptionsPath -PathType Leaf)) {
        throw "The local root client options file is missing. Refusing to stop an unidentified server."
    }

    $pidPath = Join-Path $runRoot "mysql.pid"
    if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) {
        throw "The project MySQL PID file is missing. Refusing to stop an unidentified server."
    }
    $serverProcessId = 0
    $pidText = (Get-Content -LiteralPath $pidPath -Raw).Trim()
    if (-not [int]::TryParse($pidText, [ref]$serverProcessId) -or $serverProcessId -le 0) {
        throw "The project MySQL PID file is invalid. Refusing to stop an unidentified server."
    }
    $serverProcess = Get-Process -Id $serverProcessId -ErrorAction SilentlyContinue
    $mysqldPath = Get-ExecutablePath "mysqld.exe"
    if ($null -eq $serverProcess -or
        -not ([string]$serverProcess.Path).Equals($mysqldPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "The recorded MySQL process does not match the project runtime. Refusing to stop it."
    }

    & $mysqlAdmin "--defaults-extra-file=$rootOptionsPath" shutdown
    if ($LASTEXITCODE -ne 0) {
        throw "MySQL shutdown failed."
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Test-PortOpen) -and
            $null -eq (Get-Process -Id $serverProcessId -ErrorAction SilentlyContinue)) {
            Write-Output "MySQL stopped."
            return
        }
        Start-Sleep -Milliseconds 200
    }
    throw "MySQL did not fully stop within 15 seconds."
}

function Verify-Server {
    Wait-ForServer -TimeoutSeconds 5
    $mysql = Get-ExecutablePath "mysql.exe"
    $verificationSql = @"
SELECT VERSION() AS version, @@port AS port, @@bind_address AS bind_address, @@default_storage_engine AS storage_engine, @@character_set_server AS character_set, @@collation_server AS collation_name, @@session.time_zone AS session_time_zone, @@session.sql_mode AS sql_mode;
SELECT @@local_infile AS local_infile, @@secure_file_priv AS secure_file_priv, @@log_bin AS binary_log, @@skip_name_resolve AS skip_name_resolve;
SELECT SCHEMA_NAME AS database_name, DEFAULT_CHARACTER_SET_NAME AS character_set, DEFAULT_COLLATION_NAME AS collation_name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME IN ('xiaoban_dev', 'xiaoban_test') ORDER BY SCHEMA_NAME;
SELECT User AS account_name, Host AS allowed_host FROM mysql.user WHERE User IN ('xiaoban_migrator', 'xiaoban_app', 'xiaoban_test') ORDER BY User;
SELECT s.SCHEMA_NAME AS database_name, COUNT(t.TABLE_NAME) AS table_count FROM INFORMATION_SCHEMA.SCHEMATA s LEFT JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME WHERE s.SCHEMA_NAME IN ('xiaoban_dev', 'xiaoban_test') GROUP BY s.SCHEMA_NAME ORDER BY s.SCHEMA_NAME;
SELECT GRANTEE AS account_name, TABLE_SCHEMA AS database_name, PRIVILEGE_TYPE AS privilege_name FROM INFORMATION_SCHEMA.SCHEMA_PRIVILEGES WHERE GRANTEE IN ('''xiaoban_migrator''@''127.0.0.1''', '''xiaoban_app''@''127.0.0.1''', '''xiaoban_test''@''127.0.0.1''') ORDER BY GRANTEE, TABLE_SCHEMA, PRIVILEGE_TYPE;
"@
    $verificationSql | & $mysql "--defaults-extra-file=$rootOptionsPath" --batch
    if ($LASTEXITCODE -ne 0) {
        throw "MySQL baseline verification failed."
    }

    $accountChecks = @(
        @{ Options = "migration.cnf"; Database = "xiaoban_dev" },
        @{ Options = "app.cnf"; Database = "xiaoban_dev" },
        @{ Options = "test.cnf"; Database = "xiaoban_test" }
    )
    foreach ($check in $accountChecks) {
        $optionsPath = Join-Path $secretRoot $check.Options
        "SELECT CURRENT_USER() AS authenticated_account, DATABASE() AS selected_database;" |
            & $mysql "--defaults-extra-file=$optionsPath" "--database=$($check.Database)" --batch
        if ($LASTEXITCODE -ne 0) {
            throw "MySQL account verification failed for $($check.Options)."
        }
    }
    Write-Output "MySQL baseline verification passed without changing application tables."
}

switch ($Action) {
    "Install" { Install-Server; Verify-Server }
    "Start" { Start-Server }
    "Stop" { Stop-Server }
    "Verify" { Verify-Server }
}
