# VM Socket Observer Fixes and Findings

## Issue 1: Excessive Logging from VirtioSocketWatcherService

### Problem
The VM Socket observer was outputting too much information to the console, including repetitive reconnection attempts and connection errors.

### Solution Implemented
1. **Updated logging to use debug namespaces properly** in `app/services/VirtioSocketWatcherService.ts`:
   - Added documentation header explaining debug control
   - Categorized logs into: `error`, `warn`, `info`, `debug`, `metrics`
   - Moved verbose reconnection messages to `debug` level
   - Added emojis for better visual parsing

2. **Updated package.json scripts**:
   - `npm run dev`: Now sets `DEBUG=infinibay:virtio-socket:error,infinibay:virtio-socket:warn,infinibay:virtio-socket:info` (shows only important messages)
   - `npm run dev:verbose`: Added for full debug output with `DEBUG=infinibay:virtio-socket:*`

3. **Improved error logging**:
   - Tracks error types to avoid repetitive logging
   - Only logs new error types or first occurrences
   - Shows diagnostic help only on first EACCES error
   - Logs every 10th occurrence of the same error type

## Issue 2: EACCES Permission Errors

### Problem
Socket files created by VMs (owned by `libvirt-qemu:kvm`) couldn't be accessed by the backend running as regular user.

### Root Causes Identified
1. **Permission mismatch**: Sockets created by VMs are owned by `libvirt-qemu:kvm` group
2. **Missing group membership**: Backend user needs to be in `kvm` group
3. **InfiniService directory structure**: Binaries were in wrong location

### Solutions Applied
1. **Fixed InfiniService directory structure**:
   ```bash
   /opt/infinibay/infiniservice/
   ├── binaries/
   │   ├── windows/
   │   │   └── infiniservice.exe
   │   └── linux/
   │       └── infiniservice
   └── install/
       └── (installation scripts)
   ```

2. **User permissions**: Added backend user to `kvm` group (requires restart)

3. **Socket cleanup**: Removed stale socket files from terminated VMs

## Debugging Commands

### Check InfiniService status in VM
```bash
# If QEMU guest agent is available:
virsh qemu-agent-command <vm-id> '{"execute":"guest-exec","arguments":{"path":"systemctl","arg":["status","infiniservice"]}}'

# Check socket permissions:
ls -la /opt/infinibay/sockets/
```

### Control logging verbosity
```bash
# Show only errors/warnings (default):
npm run dev

# Show all debug messages:
npm run dev:verbose

# Custom debug levels:
DEBUG=infinibay:virtio-socket:error npm run start
```

## Remaining Considerations

1. **InfiniService Installation**: Verify InfiniService is being properly installed during VM provisioning
2. **Guest Agent**: Ensure QEMU guest agent is installed for debugging capabilities
3. **Socket Permissions**: May need to adjust umask or socket permissions in InfiniService
4. **Group Membership**: Backend service needs restart after group changes

## Testing

After applying fixes:
1. Restart backend with new group membership
2. Start a VM with InfiniService installed
3. Monitor logs with appropriate verbosity level
4. Verify socket connection succeeds without EACCES errors