#!/bin/bash

# InfiniService Remote Log Checker
# This script can be used to check InfiniService installation logs from VMs
# Usage: ./check-infiniservice-remote.sh <VM_IP> [username] [password]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
DEFAULT_USERNAME="Administrator"
LOG_PATH="C:\\Temp\\infiniservice_install.log"
LOCAL_COPY="/tmp/infiniservice_install_$(date +%Y%m%d_%H%M%S).log"

# Function to print colored output
print_color() {
    local color=$1
    shift
    echo -e "${color}$@${NC}"
}

# Function to print header
print_header() {
    print_color "$CYAN" "===================================="
    print_color "$CYAN" "InfiniService Remote Log Checker"
    print_color "$CYAN" "===================================="
    echo
}

# Function to check dependencies
check_dependencies() {
    local missing_deps=()
    
    if ! command -v smbclient &> /dev/null; then
        missing_deps+=("smbclient")
    fi
    
    if ! command -v winexe &> /dev/null && ! command -v psexec &> /dev/null; then
        missing_deps+=("winexe or psexec")
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        print_color "$RED" "Error: Missing required dependencies: ${missing_deps[*]}"
        print_color "$YELLOW" "Install with: sudo apt-get install smbclient winexe"
        exit 1
    fi
}

# Function to retrieve log via SMB
retrieve_log_smb() {
    local vm_ip=$1
    local username=$2
    local password=$3
    
    print_color "$BLUE" "Attempting to retrieve log via SMB..."
    
    # Try to get the log file via SMB
    smbclient //${vm_ip}/C$ -U ${username}%${password} -c "get Temp\\infiniservice_install.log ${LOCAL_COPY}" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        print_color "$GREEN" "✓ Log file retrieved successfully"
        return 0
    else
        print_color "$RED" "✗ Failed to retrieve log via SMB"
        return 1
    fi
}

# Function to check service status remotely
check_service_status() {
    local vm_ip=$1
    local username=$2
    local password=$3
    
    print_color "$BLUE" "Checking InfiniService status remotely..."
    
    # Try using winexe if available
    if command -v winexe &> /dev/null; then
        winexe -U ${username}%${password} //${vm_ip} 'powershell -Command "Get-Service -Name Infiniservice | Format-List"' 2>/dev/null
    else
        print_color "$YELLOW" "winexe not available, skipping remote service check"
    fi
}

# Function to analyze log file
analyze_log() {
    local log_file=$1
    
    if [ ! -f "$log_file" ]; then
        print_color "$RED" "Error: Log file not found at $log_file"
        return 1
    fi
    
    print_color "$CYAN" "ANALYSIS SUMMARY"
    print_color "$CYAN" "================"
    
    # Check if installation completed
    if grep -q "=== INFINISERVICE INSTALLATION COMPLETED ===" "$log_file"; then
        print_color "$GREEN" "✓ Installation Process: COMPLETED"
    else
        print_color "$RED" "✗ Installation Process: INCOMPLETE"
    fi
    
    # Count errors, warnings, and successes
    local error_count=$(grep -c "ERROR:" "$log_file" 2>/dev/null || echo 0)
    local warning_count=$(grep -c "WARNING:" "$log_file" 2>/dev/null || echo 0)
    local success_count=$(grep -c "SUCCESS:" "$log_file" 2>/dev/null || echo 0)
    
    echo
    print_color "$CYAN" "STATISTICS"
    print_color "$CYAN" "=========="
    
    if [ $error_count -gt 0 ]; then
        print_color "$RED" "Errors: $error_count"
    else
        print_color "$GREEN" "Errors: $error_count"
    fi
    
    if [ $warning_count -gt 0 ]; then
        print_color "$YELLOW" "Warnings: $warning_count"
    else
        print_color "$GREEN" "Warnings: $warning_count"
    fi
    
    print_color "$GREEN" "Successes: $success_count"
    
    # Check key milestones
    echo
    print_color "$CYAN" "KEY CHECKPOINTS"
    print_color "$CYAN" "==============="
    
    local milestones=(
        "INFINISERVICE INSTALLATION STARTED:Installation started"
        "Created directory C:\\\\Temp\\\\InfiniService:Temp directory created"
        "Binary downloaded:Binary downloaded"
        "Binary file verification passed:Binary verified"
        "Script downloaded:Script downloaded"
        "Script file verification passed:Script verified"
        "Executing install script:Installation executed"
        "Service is running:Service running"
        "INFINISERVICE INSTALLATION COMPLETED:Installation completed"
    )
    
    for milestone in "${milestones[@]}"; do
        IFS=':' read -r pattern description <<< "$milestone"
        if grep -q "$pattern" "$log_file"; then
            print_color "$GREEN" "✓ $description"
        else
            print_color "$RED" "✗ $description"
        fi
    done
    
    # Show errors if any
    if [ $error_count -gt 0 ]; then
        echo
        print_color "$RED" "ERROR DETAILS"
        print_color "$RED" "============="
        grep "ERROR:" "$log_file" | head -5
        if [ $error_count -gt 5 ]; then
            print_color "$RED" "... and $((error_count - 5)) more errors"
        fi
    fi
    
    # Show warnings if any
    if [ $warning_count -gt 0 ]; then
        echo
        print_color "$YELLOW" "WARNING DETAILS"
        print_color "$YELLOW" "==============="
        grep "WARNING:" "$log_file" | head -5
        if [ $warning_count -gt 5 ]; then
            print_color "$YELLOW" "... and $((warning_count - 5)) more warnings"
        fi
    fi
    
    # Extract key information
    echo
    print_color "$CYAN" "CONFIGURATION"
    print_color "$CYAN" "============="
    
    # Extract VM ID
    local vm_id=$(grep "VM ID:" "$log_file" | head -1 | sed 's/.*VM ID: //')
    if [ -n "$vm_id" ]; then
        echo "VM ID: $vm_id"
    fi
    
    # Extract Backend URL
    local backend_url=$(grep "Backend URL:" "$log_file" | head -1 | sed 's/.*Backend URL: //')
    if [ -n "$backend_url" ]; then
        echo "Backend URL: $backend_url"
    fi
    
    # Extract file sizes
    local binary_size=$(grep "Binary.*File size:" "$log_file" | head -1 | sed 's/.*File size: //')
    if [ -n "$binary_size" ]; then
        echo "Binary size: $binary_size"
    fi
    
    echo
    print_color "$CYAN" "Log file saved to: $log_file"
}

# Main script
main() {
    print_header
    
    # Check arguments
    if [ $# -lt 1 ]; then
        print_color "$RED" "Error: VM IP address required"
        echo "Usage: $0 <VM_IP> [username] [password]"
        echo "Example: $0 192.168.1.100 Administrator MyPassword"
        exit 1
    fi
    
    VM_IP=$1
    USERNAME=${2:-$DEFAULT_USERNAME}
    PASSWORD=$3
    
    # If password not provided, prompt for it
    if [ -z "$PASSWORD" ]; then
        read -s -p "Enter password for $USERNAME@$VM_IP: " PASSWORD
        echo
    fi
    
    print_color "$BLUE" "Target VM: $VM_IP"
    print_color "$BLUE" "Username: $USERNAME"
    echo
    
    # Check dependencies
    check_dependencies
    
    # Try to retrieve the log
    if retrieve_log_smb "$VM_IP" "$USERNAME" "$PASSWORD"; then
        echo
        analyze_log "$LOCAL_COPY"
        
        # Try to check service status
        echo
        check_service_status "$VM_IP" "$USERNAME" "$PASSWORD"
    else
        print_color "$RED" "Failed to retrieve log file from VM"
        print_color "$YELLOW" "Possible reasons:"
        print_color "$YELLOW" "  - VM is not accessible on the network"
        print_color "$YELLOW" "  - Incorrect credentials"
        print_color "$YELLOW" "  - Log file does not exist (installation may not have started)"
        print_color "$YELLOW" "  - SMB/CIFS is blocked by firewall"
        exit 1
    fi
    
    echo
    print_color "$CYAN" "===================================="
    print_color "$CYAN" "Analysis Complete"
    print_color "$CYAN" "===================================="
}

# Run main function
main "$@"