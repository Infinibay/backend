# InfiniService Installation Log Analyzer
# This script retrieves and analyzes the InfiniService installation log from a Windows VM
# Usage: .\analyze-infiniservice-logs.ps1

param(
    [string]$LogPath = "C:\Temp\infiniservice_install.log",
    [switch]$ShowFullLog = $false,
    [switch]$ExportReport = $false,
    [string]$ReportPath = ".\infiniservice_analysis_report.txt"
)

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "InfiniService Installation Log Analyzer" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check if log file exists
if (!(Test-Path $LogPath)) {
    Write-Host "ERROR: Log file not found at $LogPath" -ForegroundColor Red
    Write-Host "The InfiniService installation log was not created or is in a different location." -ForegroundColor Yellow
    exit 1
}

# Read log file
$logContent = Get-Content $LogPath -Raw
$logLines = Get-Content $LogPath

Write-Host "Log file found: $LogPath" -ForegroundColor Green
Write-Host "Log size: $((Get-Item $LogPath).Length / 1KB) KB" -ForegroundColor Gray
Write-Host "Total lines: $($logLines.Count)" -ForegroundColor Gray
Write-Host ""

# Initialize counters and collections
$errors = @()
$warnings = @()
$successes = @()
$httpStatuses = @()
$timestamps = @()
$installationSteps = @()

# Parse log file
foreach ($line in $logLines) {
    if ($line -match '\[([\d-]+ [\d:]+)\]') {
        $timestamps += $matches[1]
    }
    
    if ($line -match 'ERROR:') {
        $errors += $line
    }
    elseif ($line -match 'WARNING:') {
        $warnings += $line
    }
    elseif ($line -match 'SUCCESS:') {
        $successes += $line
    }
    
    if ($line -match 'HTTP Status: (\d+)') {
        $httpStatuses += [int]$matches[1]
    }
    
    # Track major installation steps
    if ($line -match '=== INFINISERVICE INSTALLATION (STARTED|COMPLETED) ===') {
        $installationSteps += $line
    }
}

# Analysis Report
Write-Host "ANALYSIS SUMMARY" -ForegroundColor Yellow
Write-Host "=================" -ForegroundColor Yellow

# Installation Status
$installationCompleted = $logContent -match "=== INFINISERVICE INSTALLATION COMPLETED ==="
if ($installationCompleted) {
    Write-Host "✓ Installation Process: COMPLETED" -ForegroundColor Green
} else {
    Write-Host "✗ Installation Process: INCOMPLETE" -ForegroundColor Red
}

# Time Range
if ($timestamps.Count -ge 2) {
    $startTime = [DateTime]::Parse($timestamps[0])
    $endTime = [DateTime]::Parse($timestamps[-1])
    $duration = $endTime - $startTime
    Write-Host "Duration: $($duration.TotalSeconds) seconds" -ForegroundColor Gray
    Write-Host "Start: $startTime" -ForegroundColor Gray
    Write-Host "End: $endTime" -ForegroundColor Gray
}

Write-Host ""
Write-Host "STATISTICS" -ForegroundColor Yellow
Write-Host "==========" -ForegroundColor Yellow
Write-Host "Errors: $($errors.Count)" -ForegroundColor $(if ($errors.Count -gt 0) { "Red" } else { "Green" })
Write-Host "Warnings: $($warnings.Count)" -ForegroundColor $(if ($warnings.Count -gt 0) { "Yellow" } else { "Green" })
Write-Host "Successes: $($successes.Count)" -ForegroundColor Green

Write-Host ""
Write-Host "KEY CHECKPOINTS" -ForegroundColor Yellow
Write-Host "===============" -ForegroundColor Yellow

# Check for specific milestones
$milestones = @{
    "C:\Temp directory created" = $logContent -match "Created C:\\Temp directory|C:\\Temp already exists"
    "Installation log initialized" = $logContent -match "INFINISERVICE INSTALLATION STARTED"
    "Temp directory created" = $logContent -match "Created directory C:\\Temp\\InfiniService"
    "Binary downloaded" = $logContent -match "SUCCESS: Binary downloaded"
    "Binary verified" = $logContent -match "SUCCESS: Binary file verification passed"
    "Script downloaded" = $logContent -match "SUCCESS: Script downloaded"
    "Script verified" = $logContent -match "SUCCESS: Script file verification passed"
    "PowerShell environment checked" = $logContent -match "PowerShell version:"
    "Installation executed" = $logContent -match "Executing install script"
    "Service created" = $logContent -match "Service found: Infiniservice"
    "Service running" = $logContent -match "SUCCESS: Service is running"
    "Environment variables set" = $logContent -match "INFINIBAY_VM_ID:"
    "Cleanup completed" = $logContent -match "Cleanup completed"
}

foreach ($milestone in $milestones.GetEnumerator()) {
    $status = if ($milestone.Value) { "✓" } else { "✗" }
    $color = if ($milestone.Value) { "Green" } else { "Red" }
    Write-Host "$status $($milestone.Key)" -ForegroundColor $color
}

# Network and Download Analysis
Write-Host ""
Write-Host "DOWNLOAD ANALYSIS" -ForegroundColor Yellow
Write-Host "=================" -ForegroundColor Yellow

if ($logContent -match "Backend URL: ([^\s]+)") {
    Write-Host "Backend URL: $($matches[1])" -ForegroundColor Gray
}

if ($logContent -match "Binary.*File size: ([\d.]+) KB") {
    Write-Host "Binary size: $($matches[1]) KB" -ForegroundColor Gray
}

if ($logContent -match "Script.*File size: (\d+) bytes") {
    Write-Host "Script size: $($matches[1]) bytes" -ForegroundColor Gray
}

if ($httpStatuses.Count -gt 0) {
    $uniqueStatuses = $httpStatuses | Select-Object -Unique
    Write-Host "HTTP Status Codes: $($uniqueStatuses -join ', ')" -ForegroundColor Gray
}

# Error Details
if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "ERROR DETAILS" -ForegroundColor Red
    Write-Host "=============" -ForegroundColor Red
    foreach ($error in $errors | Select-Object -First 5) {
        Write-Host $error -ForegroundColor Red
    }
    if ($errors.Count -gt 5) {
        Write-Host "... and $($errors.Count - 5) more errors" -ForegroundColor Red
    }
}

# Warning Details
if ($warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "WARNING DETAILS" -ForegroundColor Yellow
    Write-Host "===============" -ForegroundColor Yellow
    foreach ($warning in $warnings | Select-Object -First 5) {
        Write-Host $warning -ForegroundColor Yellow
    }
    if ($warnings.Count -gt 5) {
        Write-Host "... and $($warnings.Count - 5) more warnings" -ForegroundColor Yellow
    }
}

# Service Status Check
Write-Host ""
Write-Host "CURRENT SERVICE STATUS" -ForegroundColor Yellow
Write-Host "======================" -ForegroundColor Yellow

$service = Get-Service -Name "Infiniservice" -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "Service Name: $($service.Name)" -ForegroundColor Gray
    Write-Host "Display Name: $($service.DisplayName)" -ForegroundColor Gray
    Write-Host "Status: $($service.Status)" -ForegroundColor $(if ($service.Status -eq "Running") { "Green" } else { "Yellow" })
    Write-Host "Start Type: $($service.StartType)" -ForegroundColor Gray
} else {
    Write-Host "Service not found in Windows Services" -ForegroundColor Red
}

# Check installation directory
$installPath = "C:\Program Files\Infiniservice"
if (Test-Path $installPath) {
    Write-Host ""
    Write-Host "INSTALLATION FILES" -ForegroundColor Yellow
    Write-Host "==================" -ForegroundColor Yellow
    $files = Get-ChildItem $installPath
    foreach ($file in $files) {
        Write-Host "$($file.Name) - $($file.Length) bytes" -ForegroundColor Gray
    }
} else {
    Write-Host ""
    Write-Host "Installation directory not found at $installPath" -ForegroundColor Red
}

# Environment Variables
Write-Host ""
Write-Host "ENVIRONMENT VARIABLES" -ForegroundColor Yellow
Write-Host "=====================" -ForegroundColor Yellow
$vmId = [Environment]::GetEnvironmentVariable("INFINIBAY_VM_ID", "Machine")
$mode = [Environment]::GetEnvironmentVariable("INFINISERVICE_MODE", "Machine")
Write-Host "INFINIBAY_VM_ID: $(if ($vmId) { $vmId } else { 'Not set' })" -ForegroundColor Gray
Write-Host "INFINISERVICE_MODE: $(if ($mode) { $mode } else { 'Not set' })" -ForegroundColor Gray

# Show full log if requested
if ($ShowFullLog) {
    Write-Host ""
    Write-Host "FULL LOG OUTPUT" -ForegroundColor Yellow
    Write-Host "===============" -ForegroundColor Yellow
    Write-Host $logContent
}

# Export report if requested
if ($ExportReport) {
    Write-Host ""
    Write-Host "Exporting report to: $ReportPath" -ForegroundColor Cyan
    
    $report = @"
InfiniService Installation Analysis Report
Generated: $(Get-Date)
Log File: $LogPath

SUMMARY
=======
Installation Status: $(if ($installationCompleted) { "COMPLETED" } else { "INCOMPLETE" })
Errors: $($errors.Count)
Warnings: $($warnings.Count)
Successes: $($successes.Count)

MILESTONES
==========
$($milestones.GetEnumerator() | ForEach-Object { "$($_.Key): $(if ($_.Value) { 'PASSED' } else { 'FAILED' })" } | Out-String)

ERRORS
======
$($errors -join "`n")

WARNINGS
========
$($warnings -join "`n")

SERVICE STATUS
==============
$(if ($service) { "Service Status: $($service.Status)" } else { "Service not found" })

FULL LOG
========
$logContent
"@
    
    $report | Out-File -FilePath $ReportPath -Encoding UTF8
    Write-Host "Report exported successfully!" -ForegroundColor Green
}

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Analysis Complete" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

# Return summary object for programmatic use
$summary = @{
    InstallationCompleted = $installationCompleted
    ErrorCount = $errors.Count
    WarningCount = $warnings.Count
    SuccessCount = $successes.Count
    ServiceRunning = ($service -and $service.Status -eq "Running")
    LogPath = $LogPath
}

return $summary