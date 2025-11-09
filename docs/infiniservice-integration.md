# InfiniService Integration Documentation

## Overview

InfiniService has been integrated into the Infinibay platform's unattended VM installation process. The service is automatically installed and configured during VM provisioning for Windows, Ubuntu, and RedHat/Fedora systems.

## Architecture

### HTTP Service Endpoints

The backend exposes the following endpoints for serving InfiniService binaries and installation scripts:

- `GET /infiniservice/:platform/binary` - Downloads the InfiniService binary (platform: `windows` or `linux`)
- `GET /infiniservice/:platform/script` - Downloads the installation script
- `GET /infiniservice/metadata` - Returns version and platform information

### Directory Structure

The InfiniService files should be organized as follows:

```
${INFINIBAY_BASE_DIR}/infiniservice/
├── binaries/
│   ├── windows/
│   │   └── infiniservice.exe
│   └── linux/
│       └── infiniservice
├── install/
│   ├── install-windows.ps1
│   └── install-linux.sh
└── metadata.json (optional)
```

## Integration Details

### Windows VMs

The Windows unattended installation (`unattendedWindowsManager.ts`) performs the following steps:

1. Creates a temporary directory `C:\Temp\InfiniService`
2. Downloads the InfiniService binary from the backend
3. Downloads the installation script
4. Executes the installation script with the VM ID
5. Moves InfiniService to `%ProgramFiles%\Infiniservice` (language-independent)
6. Registers InfiniService as a Windows service
7. Cleans up temporary files

The installation happens during the FirstLogonCommands phase, after network drivers are installed but before the final system restart.

### Ubuntu VMs

The Ubuntu unattended installation (`unattendedUbuntuManager.ts`) uses cloud-init late-commands:

1. Creates an installation script in `/var/lib/cloud/scripts/per-instance/`
2. Downloads InfiniService binary using curl
3. Downloads the installation script
4. Executes: `./install-linux.sh normal "<vm_id>"`
5. Logs are written to `/var/log/infiniservice_install.log`

Required packages (`curl`, `wget`) are automatically included in the base installation.

### RedHat/Fedora VMs

The RedHat/Fedora kickstart installation (`unattendedRedHatManager.ts`) uses post-install scripts:

1. Downloads InfiniService files to `/tmp/infiniservice`
2. Executes the installation script with VM ID
3. Installation logs are written to `/root/infiniservice-install.log`
4. Installation continues even if InfiniService setup fails (non-blocking)

## Script Execution Flow

Custom scripts are no longer embedded in the answerfile. Instead, they are executed via the InfiniService protocol after the service starts.

**Flow**:

1. On service boot, InfiniService sends a `request_pending_scripts` message to the host
2. The host queries the database for `ScriptExecution` records with `status=PENDING` and `scheduledFor <= now`
3. The host returns a `pending_scripts_response` with script content, metadata, and execution parameters
4. InfiniService executes each script using the specified shell (PowerShell, Bash, etc.)
5. InfiniService captures stdout, stderr, and exit codes
6. InfiniService sends `script_completion` messages back to the host for each script
7. The host updates the `ScriptExecution` records with results and logs

**Scheduling Capabilities**:

- **Immediate execution**: Scripts with `scheduledFor` set to current time or past (used for first-boot scripts)
- **Scheduled execution**: Scripts with future `scheduledFor` dates
- **Repeating execution**: Scripts with `repeatIntervalMinutes` set, executed periodically

**Note**: This approach decouples scripts from the answerfile, preventing installation failures due to script errors or length limits.

## Configuration

### Environment Variables

The following environment variables control InfiniService distribution:

- `APP_HOST` - Backend server hostname/IP (default: `localhost`)
- `PORT` - Backend server port (default: `4000`)
- `INFINIBAY_BASE_DIR` - Base directory for Infinibay files (default: `/opt/infinibay`)

### VM ID Assignment

The VM ID is automatically passed from the Infinibay backend when creating unattended installation media. This ID is used by InfiniService to:

- Identify the VM to the backend
- Establish the virtio-serial communication channel
- Report metrics and status

## Deployment Steps

1. **Build InfiniService binaries**:
   ```bash
   cd infiniservice
   cargo build --release
   # Windows binary: target/release/infiniservice.exe
   # Linux binary: target/release/infiniservice
   ```

2. **Place binaries in the correct location**:
   ```bash
   # Create directory structure
   mkdir -p ${INFINIBAY_BASE_DIR}/infiniservice/binaries/{windows,linux}
   mkdir -p ${INFINIBAY_BASE_DIR}/infiniservice/install
   
   # Copy binaries
   cp target/release/infiniservice.exe ${INFINIBAY_BASE_DIR}/infiniservice/binaries/windows/
   cp target/release/infiniservice ${INFINIBAY_BASE_DIR}/infiniservice/binaries/linux/
   
   # Copy installation scripts
   cp install/install-windows.ps1 ${INFINIBAY_BASE_DIR}/infiniservice/install/
   cp install/install-linux.sh ${INFINIBAY_BASE_DIR}/infiniservice/install/
   ```

3. **Set proper permissions**:
   ```bash
   chmod +x ${INFINIBAY_BASE_DIR}/infiniservice/binaries/linux/infiniservice
   chmod +x ${INFINIBAY_BASE_DIR}/infiniservice/install/install-linux.sh
   ```

4. **Restart the backend server** to activate the new routes.

## Testing

### Manual Testing

1. **Test HTTP endpoints**:
   ```bash
   # Test binary download
   curl -O http://localhost:4000/infiniservice/linux/binary
   curl -O http://localhost:4000/infiniservice/windows/binary
   
   # Test script download
   curl -O http://localhost:4000/infiniservice/linux/script
   curl -O http://localhost:4000/infiniservice/windows/script
   ```

2. **Create a test VM** with unattended installation and verify:
   - InfiniService is installed and running
   - The correct VM ID is configured
   - The service connects to the backend successfully

### Verification Commands

**Windows**:
```powershell
# Check service status
Get-Service Infiniservice

# Check environment variable
[System.Environment]::GetEnvironmentVariable("INFINIBAY_VM_ID", "Machine")

# View logs
Get-Content C:\Windows\Temp\infiniservice_install.log
```

**Linux**:
```bash
# Check service status
systemctl status infiniservice

# Check environment variable
grep INFINIBAY_VM_ID /etc/environment

# View logs
journalctl -u infiniservice -f
cat /var/log/infiniservice_install.log
```

**Script Execution Verification**:

- Check that `ScriptExecution` records are created with `status=PENDING` during VM creation
- Verify that scripts transition to `RUNNING` when InfiniService requests them
- Confirm that scripts complete with `status=SUCCESS` or `FAILED` after execution
- Check that logs are captured in the database

Example query to check script execution status:

```sql
SELECT id, scriptId, machineId, status, scheduledFor, startedAt, completedAt, exitCode
FROM ScriptExecution
WHERE machineId = '<vm_id>'
ORDER BY scheduledFor;
```

## Troubleshooting

### Common Issues

1. **Binary not found**: Ensure binaries are placed in the correct directory structure and the backend can read them.

2. **Installation fails during unattended setup**: Check that:
   - Network connectivity is available when the installation script runs
   - The backend server is accessible from the VM
   - Virtio drivers are installed (Windows)

3. **Service doesn't start**: Verify:
   - The virtio-serial device is available
   - The VM ID environment variable is set
   - Check service logs for specific errors

4. **Scripts not executing**: Check that:
   - InfiniService is running and connected to the host via VirtIO socket
   - Script execution records exist in the database with `status=PENDING`
   - Check InfiniService logs for protocol errors

5. **Scripts stuck in PENDING**: Verify that:
   - `scheduledFor` is not set to a future date
   - InfiniService is running and able to communicate with the host
   - Check InfiniService logs for protocol errors or script request failures

6. **Scripts failing**: Review:
   - The `stdout` and `stderr` fields in the `ScriptExecution` record
   - Check script syntax and permissions
   - Verify script dependencies are installed

7. **Repeating scripts not running**: Verify:
   - `repeatIntervalMinutes` and `lastExecutedAt` fields are set correctly
   - `maxExecutions` hasn't been reached (if set)
   - Check that the script execution interval has elapsed

### Log Locations

Script logs are stored in the database (`ScriptExecution.stdout` and `ScriptExecution.stderr` fields) in addition to any local log files.

Additional log locations:

- **Windows Installation**: `C:\Windows\Temp\infiniservice_install.log`
- **Windows Download**: `C:\Windows\Temp\infiniservice_download.log`
- **Ubuntu Installation**: `/var/log/infiniservice_install.log`
- **RedHat Installation**: `/root/infiniservice-install.log`
- **Service Logs (Linux)**: `journalctl -u infiniservice`
- **Service Logs (Windows)**: Windows Event Viewer → Application Log

## Security Considerations

1. **Network Security**: The binary download happens over HTTP during installation. Consider:
   - Using HTTPS if certificates are available
   - Restricting access to the `/infiniservice` endpoints to internal networks
   - Adding authentication tokens for binary downloads

2. **Binary Integrity**: Consider implementing:
   - Checksum verification in installation scripts
   - Digital signatures for binaries

3. **VM ID Protection**: The VM ID should be treated as a semi-sensitive identifier:
   - Don't expose it in logs unnecessarily
   - Use it only for VM identification purposes

## Future Enhancements

1. **Automatic Updates**: Implement a mechanism to update InfiniService on running VMs
2. **Configuration Management**: Allow per-VM configuration of InfiniService parameters
3. **Health Checks**: Add endpoint to verify InfiniService installation status
4. **Multi-Architecture Support**: Support ARM64 and other architectures
5. **Package Repository Integration**: Publish InfiniService as packages (MSI, DEB, RPM)