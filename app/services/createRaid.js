import { exec } from "child_process";

// disk = ["/dev/sda","/dev/sdb","/dev/sdc","/dev/sdd"]
// Fast Storage RAID 0
// Safe Storage RAID 1
// Mixed Storage RAID 5
// Redundant Mixed Storage RAID 6

const raidMap = (name)=>{
    return new Promise((resolve, reject) => {
        let config= {
            "Fast Storage":"raid0",
            "Safe Storage":"raid1",
            "Mixed Storage":"raid5",
            "Redundant Mixed Storage":"raid6"
        }
        resolve(config[name])
    })  

}
const createLibvirtStoragePool = async (storageName, disks, raidType) => {
  try {
    // Step 1: Format the disks with Btrfs filesystem
    const formatDisksCommand = 'mkfs.btrfs -f '+disks.join(' ');
    await executeCommand(formatDisksCommand);

    // Step 2: Create the RAID 0 array
    let raid = await raidMap(raidType)
    const createRAIDCommand = `mkfs.btrfs -m ${raid} -d ${raid} ${disks.join(' ')}`;
    await executeCommand(createRAIDCommand);

    // Step 3: Mount the RAID 0 array
    const mountCommand = `mount ${disks[0]} /${storageName}`; // Replace with the desired mountpoint
    await executeCommand(mountCommand);

    // Step 4: Create Libvirt storage pool
    const createPoolCommand = `virsh pool-define-as ${storageName} btrfs --source-dir /${storageName}`;
    await executeCommand(createPoolCommand);

    // Step 5: Start the Libvirt storage pool
    const startPoolCommand = `virsh pool-start ${storageName}`;
    await executeCommand(startPoolCommand);

    // Step 6: Set the Libvirt storage pool to auto-start
    const autostartPoolCommand = `virsh pool-autostart ${storageName}`;
    await executeCommand(autostartPoolCommand);

    console.log('Libvirt storage pool created and configured successfully.');
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

export default createLibvirtStoragePool;