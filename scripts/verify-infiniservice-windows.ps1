# Infiniservice Verification Script
# This script checks if Infiniservice is properly installed and running on Windows

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " INFINISERVICE VERIFICATION SCRIPT" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$issues = @()

# 1. Check installation logs
Write-Host "📋 CHECKING INSTALLATION LOGS:" -ForegroundColor Yellow
Write-Host "-------------------------------" -ForegroundColor Gray

$logFiles = @(
    "C:\Windows\Temp\network.log",
    "C:\Windows\Temp\winget.log", 
    "C:\Windows\Temp\infiniservice_download.log",
    "C:\Windows\Temp\infiniservice_install.log"
)

foreach ($logFile in $logFiles) {
    if (Test-Path $logFile) {
        $size = (Get-Item $logFile).Length
        Write-Host "✅ Found: $logFile (Size: $size bytes)" -ForegroundColor Green
        
        # Show last 5 lines of each log
        Write-Host "   Last lines:" -ForegroundColor Gray
        Get-Content $logFile -Tail 5 | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
    } else {
        Write-Host "❌ Not found: $logFile" -ForegroundColor Red
        $issues += "Log file missing: $logFile"
    }
}

Write-Host ""

# 2. Check if service exists
Write-Host "🔧 CHECKING WINDOWS SERVICE:" -ForegroundColor Yellow
Write-Host "----------------------------" -ForegroundColor Gray

$serviceName = "Infiniservice"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if ($service) {
    Write-Host "✅ Service '$serviceName' exists" -ForegroundColor Green
    Write-Host "   Status: $($service.Status)" -ForegroundColor $(if($service.Status -eq "Running"){"Green"}else{"Red"})
    Write-Host "   StartType: $($service.StartType)" -ForegroundColor Gray
    
    if ($service.Status -ne "Running") {
        $issues += "Service exists but is not running"
        
        # Try to get error from Event Log
        Write-Host "   Checking Event Log for errors..." -ForegroundColor Yellow
        $events = Get-EventLog -LogName System -Source "Service Control Manager" -Newest 10 | 
                  Where-Object {$_.Message -like "*Infiniservice*"}
        if ($events) {
            Write-Host "   Recent events:" -ForegroundColor Gray
            $events | ForEach-Object { 
                Write-Host "     $($_.TimeGenerated): $($_.Message.Substring(0, [Math]::Min(100, $_.Message.Length)))" -ForegroundColor DarkGray 
            }
        }
    }
} else {
    Write-Host "❌ Service '$serviceName' NOT found" -ForegroundColor Red
    $issues += "Windows service not installed"
}

Write-Host ""

# 3. Check installation directory
Write-Host "📁 CHECKING INSTALLATION FILES:" -ForegroundColor Yellow
Write-Host "-------------------------------" -ForegroundColor Gray

$installPath = "C:\Program Files\Infiniservice"
if (Test-Path $installPath) {
    Write-Host "✅ Installation directory exists: $installPath" -ForegroundColor Green
    
    # Check for specific files
    $requiredFiles = @(
        "infiniservice.exe",
        "config.toml",
        "uninstall.ps1"
    )
    
    foreach ($file in $requiredFiles) {
        $filePath = Join-Path $installPath $file
        if (Test-Path $filePath) {
            $size = (Get-Item $filePath).Length
            Write-Host "   ✅ $file (Size: $size bytes)" -ForegroundColor Green
            
            if ($file -eq "config.toml") {
                Write-Host "   Config content:" -ForegroundColor Gray
                Get-Content $filePath | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
            }
        } else {
            Write-Host "   ❌ $file NOT found" -ForegroundColor Red
            $issues += "Missing file: $filePath"
        }
    }
} else {
    Write-Host "❌ Installation directory NOT found: $installPath" -ForegroundColor Red
    $issues += "Installation directory missing"
}

Write-Host ""

# 4. Check environment variables
Write-Host "🔧 CHECKING ENVIRONMENT VARIABLES:" -ForegroundColor Yellow
Write-Host "----------------------------------" -ForegroundColor Gray

$vmId = [Environment]::GetEnvironmentVariable("INFINIBAY_VM_ID", "Machine")
$serviceMode = [Environment]::GetEnvironmentVariable("INFINISERVICE_MODE", "Machine")

if ($vmId) {
    Write-Host "✅ INFINIBAY_VM_ID = $vmId" -ForegroundColor Green
} else {
    Write-Host "⚠️  INFINIBAY_VM_ID not set" -ForegroundColor Yellow
}

if ($serviceMode) {
    Write-Host "✅ INFINISERVICE_MODE = $serviceMode" -ForegroundColor Green
} else {
    Write-Host "ℹ️  INFINISERVICE_MODE not set (normal mode)" -ForegroundColor Cyan
}

Write-Host ""

# 5. Check virtio-serial device
Write-Host "🔌 CHECKING VIRTIO-SERIAL DEVICE:" -ForegroundColor Yellow
Write-Host "---------------------------------" -ForegroundColor Gray

# Check for virtio-serial device in Device Manager
$virtioDevices = Get-WmiObject -Class Win32_PnPEntity | Where-Object {$_.Name -like "*VirtIO*Serial*"}
if ($virtioDevices) {
    Write-Host "✅ VirtIO Serial device found:" -ForegroundColor Green
    $virtioDevices | ForEach-Object {
        Write-Host "   - $($_.Name)" -ForegroundColor Gray
        Write-Host "     Status: $($_.Status)" -ForegroundColor Gray
    }
} else {
    Write-Host "❌ VirtIO Serial device NOT found" -ForegroundColor Red
    $issues += "VirtIO Serial device not installed"
}

# Check for named pipe (if service is running)
$pipeName = "\\.\pipe\org.qemu.guest_agent.0"
if (Test-Path $pipeName) {
    Write-Host "✅ QEMU Guest Agent pipe found: $pipeName" -ForegroundColor Green
} else {
    Write-Host "⚠️  QEMU Guest Agent pipe not found (may be normal)" -ForegroundColor Yellow
}

Write-Host ""

# 6. Check processes
Write-Host "🔍 CHECKING RUNNING PROCESSES:" -ForegroundColor Yellow
Write-Host "------------------------------" -ForegroundColor Gray

$process = Get-Process -Name "infiniservice" -ErrorAction SilentlyContinue
if ($process) {
    Write-Host "✅ Infiniservice process is running" -ForegroundColor Green
    Write-Host "   PID: $($process.Id)" -ForegroundColor Gray
    Write-Host "   Memory: $([Math]::Round($process.WorkingSet64 / 1MB, 2)) MB" -ForegroundColor Gray
    Write-Host "   CPU Time: $($process.TotalProcessorTime)" -ForegroundColor Gray
} else {
    Write-Host "❌ Infiniservice process NOT running" -ForegroundColor Red
    $issues += "Process not running"
}

Write-Host ""

# 7. Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " VERIFICATION SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($issues.Count -eq 0) {
    Write-Host "✅ ALL CHECKS PASSED!" -ForegroundColor Green
    Write-Host "Infiniservice appears to be properly installed and running." -ForegroundColor Green
} else {
    Write-Host "❌ ISSUES FOUND:" -ForegroundColor Red
    $issues | ForEach-Object {
        Write-Host "   • $_" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "TROUBLESHOOTING SUGGESTIONS:" -ForegroundColor Cyan
    
    if ($issues -contains "Service exists but is not running") {
        Write-Host "• Try starting the service manually:" -ForegroundColor Yellow
        Write-Host "    Start-Service -Name Infiniservice" -ForegroundColor Gray
    }
    
    if ($issues -contains "Windows service not installed") {
        Write-Host "• Check if installation script ran during Windows setup" -ForegroundColor Yellow
        Write-Host "• Review C:\Windows\Temp\infiniservice_install.log" -ForegroundColor Gray
    }
    
    if ($issues -contains "VirtIO Serial device not installed") {
        Write-Host "• Ensure VirtIO drivers were installed" -ForegroundColor Yellow
        Write-Host "• Check Device Manager for missing drivers" -ForegroundColor Gray
    }
    
    if ($issues -contains "Installation directory missing") {
        Write-Host "• The service may not have been installed" -ForegroundColor Yellow
        Write-Host "• Check C:\Windows\Temp\infiniservice_download.log" -ForegroundColor Gray
        Write-Host "• Verify the backend server was accessible during installation" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Script completed at: $(Get-Date)" -ForegroundColor Gray