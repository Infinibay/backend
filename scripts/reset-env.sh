#!/bin/bash

# Infinibay Environment Reset Script
# This script removes all VMs, disks, temporary ISOs, and resets the environment to a clean state

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INFINIBAY_BASE_DIR="${INFINIBAY_BASE_DIR:-/opt/infinibay}"
FORCE=false
DRY_RUN=false
HELP=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE=true
            shift
            ;;
        --dry-run|-n)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            HELP=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Show help if requested
if [ "$HELP" = true ]; then
    echo "Infinibay Environment Reset Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --force, -f      Skip confirmation prompts and force reset"
    echo "  --dry-run, -n    Show what would be cleaned without actually doing it"
    echo "  --help, -h       Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  INFINIBAY_BASE_DIR    Base directory for Infinibay (default: /opt/infinibay)"
    echo ""
    echo "This script will:"
    echo "  - Stop and destroy all libvirt VMs"
    echo "  - Remove all VM disk images"
    echo "  - Clean up temporary ISO files"
    echo "  - Remove socket files"
    echo "  - Reset storage pools"
    echo "  - Clean up network configurations"
    echo "  - Reset database (if applicable)"
    echo ""
    echo "Note: Run this script as your regular user (not with sudo)."
    echo "The script will handle both system and session libvirt connections."
    echo ""
    echo "⚠️  WARNING: This will permanently delete all VMs and data!"
    echo ""
    exit 0
fi

if [ "$DRY_RUN" = true ]; then
    echo -e "${BLUE}🔄 Infinibay Environment Reset Script (DRY RUN)${NC}"
    echo -e "${BLUE}=============================================${NC}"
else
    echo -e "${BLUE}🔄 Infinibay Environment Reset Script${NC}"
    echo -e "${BLUE}====================================${NC}"
fi
echo ""
echo -e "${YELLOW}This script will completely reset your Infinibay environment:${NC}"
echo -e "  ${RED}• Stop and destroy all VMs${NC}"
echo -e "  ${RED}• Remove all VM disk images${NC}"
echo -e "  ${RED}• Clean up temporary ISO files${NC}"
echo -e "  ${RED}• Remove socket files${NC}"
echo -e "  ${RED}• Reset storage pools${NC}"
echo -e "  ${RED}• Clean up network configurations${NC}"
echo -e "  ${RED}• Reset database${NC}"
echo ""
echo -e "${RED}⚠️  WARNING: This will permanently delete all VMs and data!${NC}"
echo ""

# Confirmation prompt (unless --force is used)
if [ "$FORCE" != true ]; then
    echo -e "${YELLOW}Are you sure you want to continue? Type 'RESET' to confirm:${NC}"
    read -r confirmation
    if [ "$confirmation" != "RESET" ]; then
        echo -e "${GREEN}Reset cancelled.${NC}"
        exit 0
    fi
    echo ""
fi

echo -e "${BLUE}🚀 Starting environment reset...${NC}"
echo ""

# Function to run command with error handling
run_command() {
    local description="$1"
    local command="$2"
    local ignore_errors="${3:-false}"

    echo -e "${BLUE}📋 $description${NC}"

    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY RUN] Would execute: $command${NC}"
        echo -e "${GREEN}✅ $description (dry run)${NC}"
    elif [ "$ignore_errors" = true ]; then
        eval "$command" 2>/dev/null || true
        echo -e "${GREEN}✅ $description completed${NC}"
    else
        if eval "$command"; then
            echo -e "${GREEN}✅ $description completed${NC}"
        else
            echo -e "${RED}❌ $description failed${NC}"
            if [ "$FORCE" != true ]; then
                echo -e "${YELLOW}Continue anyway? (y/N):${NC}"
                read -r continue_choice
                if [[ ! "$continue_choice" =~ ^[Yy]$ ]]; then
                    echo -e "${RED}Reset aborted.${NC}"
                    exit 1
                fi
            fi
        fi
    fi
    echo ""
}

# 1. Stop and destroy all libvirt VMs
echo -e "${YELLOW}🔴 Step 1: Stopping and destroying all VMs${NC}"
run_command "Listing running VMs" "virsh list --all" true

# Get list of all VMs and destroy them
# Check both root and user libvirt connections
for LIBVIRT_URI in "qemu:///system" "qemu:///session"; do
    VM_LIST=$(LIBVIRT_DEFAULT_URI="$LIBVIRT_URI" virsh list --all --name 2>/dev/null | grep -v '^$' || true)
    if [ -n "$VM_LIST" ]; then
        echo -e "${BLUE}Cleaning VMs from $LIBVIRT_URI${NC}"
        while IFS= read -r vm; do
            if [ -n "$vm" ]; then
                run_command "Stopping VM: $vm" "LIBVIRT_DEFAULT_URI='$LIBVIRT_URI' virsh destroy '$vm'" true
                # Try different undefine strategies
                run_command "Undefining VM: $vm (with nvram)" "LIBVIRT_DEFAULT_URI='$LIBVIRT_URI' virsh undefine '$vm' --nvram" true
                if [ $? -ne 0 ]; then
                    run_command "Undefining VM: $vm (without nvram)" "LIBVIRT_DEFAULT_URI='$LIBVIRT_URI' virsh undefine '$vm'" true
                fi
            fi
        done <<< "$VM_LIST"
    fi
done

# Also try without specifying URI (uses default)
VM_LIST=$(virsh list --all --name 2>/dev/null | grep -v '^$' || true)
if [ -n "$VM_LIST" ]; then
    echo -e "${BLUE}Cleaning VMs from default connection${NC}"
    while IFS= read -r vm; do
        if [ -n "$vm" ]; then
            run_command "Stopping VM: $vm" "virsh destroy '$vm'" true
            # Try different undefine strategies
            run_command "Undefining VM: $vm (with nvram)" "virsh undefine '$vm' --nvram" true
            if [ $? -ne 0 ]; then
                run_command "Undefining VM: $vm (without nvram)" "virsh undefine '$vm'" true
            fi
        fi
    done <<< "$VM_LIST"
else
    echo -e "${GREEN}✅ No VMs found to remove${NC}"
    echo ""
fi

# 2. Clean up storage pools
echo -e "${YELLOW}💾 Step 2: Cleaning up storage pools${NC}"
# Check both root and user libvirt connections
for LIBVIRT_URI in "qemu:///system" "qemu:///session"; do
    POOL_LIST=$(LIBVIRT_DEFAULT_URI="$LIBVIRT_URI" virsh pool-list --all --name 2>/dev/null | grep -v '^$' | grep -v '^default$' || true)
    if [ -n "$POOL_LIST" ]; then
        echo -e "${BLUE}Cleaning storage pools from $LIBVIRT_URI${NC}"
        while IFS= read -r pool; do
            if [ -n "$pool" ]; then
                run_command "Stopping storage pool: $pool" "LIBVIRT_DEFAULT_URI='$LIBVIRT_URI' virsh pool-destroy '$pool'" true
                run_command "Undefining storage pool: $pool" "LIBVIRT_DEFAULT_URI='$LIBVIRT_URI' virsh pool-undefine '$pool'" true
            fi
        done <<< "$POOL_LIST"
    fi
done

# Also try without specifying URI (uses default)
POOL_LIST=$(virsh pool-list --all --name 2>/dev/null | grep -v '^$' | grep -v '^default$' || true)
if [ -n "$POOL_LIST" ]; then
    echo -e "${BLUE}Cleaning storage pools from default connection${NC}"
    while IFS= read -r pool; do
        if [ -n "$pool" ]; then
            run_command "Stopping storage pool: $pool" "virsh pool-destroy '$pool'" true
            run_command "Undefining storage pool: $pool" "virsh pool-undefine '$pool'" true
        fi
    done <<< "$POOL_LIST"
else
    echo -e "${GREEN}✅ No storage pools found to remove${NC}"
    echo ""
fi

# 3. Remove disk images and data directories
echo -e "${YELLOW}🗂️  Step 3: Removing disk images and data directories${NC}"
if [ -d "$INFINIBAY_BASE_DIR" ]; then
    run_command "Removing disks directory" "rm -rf '$INFINIBAY_BASE_DIR/disks'" true
    run_command "Removing ISO directory" "rm -rf '$INFINIBAY_BASE_DIR/iso'" true
    run_command "Removing temporary files" "rm -rf '$INFINIBAY_BASE_DIR/tmp'" true
    run_command "Removing socket files" "rm -rf '$INFINIBAY_BASE_DIR'/*.socket" true
else
    echo -e "${GREEN}✅ Infinibay base directory doesn't exist${NC}"
    echo ""
fi

# 4. Clean up libvirt default storage
echo -e "${YELLOW}🗄️  Step 4: Cleaning up libvirt default storage${NC}"
run_command "Removing libvirt default images" "rm -rf /var/lib/libvirt/images/infinibay-*" true
run_command "Removing libvirt default images" "rm -rf /var/lib/libvirt/images/*infinibay*" true

# 5. Clean up network configurations
echo -e "${YELLOW}🌐 Step 5: Cleaning up network configurations${NC}"
# Check both root and user libvirt connections
for LIBVIRT_URI in "qemu:///system" "qemu:///session"; do
    NETWORK_LIST=$(LIBVIRT_DEFAULT_URI="$LIBVIRT_URI" virsh net-list --all --name 2>/dev/null | grep -v '^$' | grep -v '^default$' || true)
    if [ -n "$NETWORK_LIST" ]; then
        echo -e "${BLUE}Cleaning networks from $LIBVIRT_URI${NC}"
        while IFS= read -r network; do
            if [ -n "$network" ]; then
                run_command "Stopping network: $network" "LIBVIRT_DEFAULT_URI='$LIBVIRT_URI' virsh net-destroy '$network'" true
                run_command "Undefining network: $network" "LIBVIRT_DEFAULT_URI='$LIBVIRT_URI' virsh net-undefine '$network'" true
            fi
        done <<< "$NETWORK_LIST"
    fi
done

# Also try without specifying URI (uses default)
NETWORK_LIST=$(virsh net-list --all --name 2>/dev/null | grep -v '^$' | grep -v '^default$' || true)
if [ -n "$NETWORK_LIST" ]; then
    echo -e "${BLUE}Cleaning networks from default connection${NC}"
    while IFS= read -r network; do
        if [ -n "$network" ]; then
            run_command "Stopping network: $network" "virsh net-destroy '$network'" true
            run_command "Undefining network: $network" "virsh net-undefine '$network'" true
        fi
    done <<< "$NETWORK_LIST"
else
    echo -e "${GREEN}✅ No custom networks found to remove${NC}"
    echo ""
fi

# 6. Reset database (if using SQLite)
echo -e "${YELLOW}🗃️  Step 6: Resetting database${NC}"
if [ -f "prisma/dev.db" ]; then
    run_command "Removing SQLite database" "rm -f prisma/dev.db" true
fi
if [ -f "prisma/dev.db-journal" ]; then
    run_command "Removing SQLite journal" "rm -f prisma/dev.db-journal" true
fi

# 7. Clean up Infinibay-specific files
echo -e "${YELLOW}🧹 Step 7: Cleaning up Infinibay-specific files${NC}"
run_command "Removing socket files" "rm -rf '$INFINIBAY_BASE_DIR/sockets'" true
run_command "Removing PID files" "rm -f /tmp/infinibay-*.pid" true
run_command "Removing log files" "rm -f /tmp/infinibay-*.log" true
run_command "Removing temporary ISOs" "rm -rf '$INFINIBAY_BASE_DIR/iso/temp'" true
run_command "Removing generated XML files" "find '$INFINIBAY_BASE_DIR' -name '*.xml' -type f -delete" true

# 8. Clean up node_modules and rebuild (optional)
echo -e "${YELLOW}📦 Step 8: Cleaning up build artifacts${NC}"
run_command "Removing build directory" "rm -rf dist/" true
run_command "Removing node_modules" "rm -rf node_modules/" true

# 9. Recreate basic directory structure
echo -e "${YELLOW}📁 Step 9: Recreating basic directory structure${NC}"
run_command "Creating Infinibay base directory" "mkdir -p '$INFINIBAY_BASE_DIR'" true
run_command "Creating disks directory" "mkdir -p '$INFINIBAY_BASE_DIR/disks'" true
run_command "Creating ISO directory" "mkdir -p '$INFINIBAY_BASE_DIR/iso'" true
run_command "Creating ISO temp directory" "mkdir -p '$INFINIBAY_BASE_DIR/iso/temp'" true
run_command "Creating sockets directory" "mkdir -p '$INFINIBAY_BASE_DIR/sockets'" true
run_command "Creating tmp directory" "mkdir -p '$INFINIBAY_BASE_DIR/tmp'" true

# Set proper permissions
if [ -d "$INFINIBAY_BASE_DIR" ]; then
    if [ "$EUID" -eq 0 ]; then
        # If running as root, set ownership to the original user
        ORIGINAL_USER="${SUDO_USER:-$USER}"
        run_command "Setting directory ownership" "chown -R '$ORIGINAL_USER:$ORIGINAL_USER' '$INFINIBAY_BASE_DIR'" true
    fi
    run_command "Setting directory permissions" "chmod -R 755 '$INFINIBAY_BASE_DIR'" true
fi

echo -e "${GREEN}🎉 Environment reset completed successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "  1. ${YELLOW}npm install${NC} - Reinstall dependencies"
echo -e "  2. ${YELLOW}npx prisma migrate dev${NC} - Reset database schema"
echo -e "  3. ${YELLOW}npm run dev${NC} - Start the development server"
echo ""
echo -e "${GREEN}✨ Your Infinibay environment is now clean and ready!${NC}"
