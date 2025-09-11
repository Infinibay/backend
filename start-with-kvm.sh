#!/bin/bash
# Start the backend with proper group permissions for virtio socket access

# Ensure we're using the kvm group
exec sg kvm -c "npm run dev"