import { exec } from "child_process";

const deleteLibvirtStorageAndRAID = async (storageName, disks) => {
  try {
    // Step 1: Stop and undefine the Libvirt storage pool
    const stopPoolCommand = `virsh pool-destroy "${storageName.replace(/[^\w\s]/gi, '')}"`;
    await executeCommand(stopPoolCommand);

    const undefinePoolCommand = `virsh pool-undefine "${storageName.replace(/[^\w\s]/gi, '')}"`;
    await executeCommand(undefinePoolCommand);

    // Step 2: Unmount the RAID 0 array
    const unmountCommand = `umount /"${storageName.replace(/[^\w\s]/gi, '')}"`; // Replace with the actual mountpoint
    await executeCommand(unmountCommand);

    // Step 3: Remove the RAID 0 array
    const removeRAIDCommand = `btrfs device delete "${disks.join(' ').replace(/[^\w\s]/gi, '')}"`;
    await executeCommand(removeRAIDCommand);

    console.log('Libvirt storage pool deleted and RAID 0 array removed successfully.');
  } catch (error) {
    console.error('An error occurred:', error);
  }
};

const executeCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout || stderr);
    });
  });
};

export default deleteLibvirtStorageAndRAID;