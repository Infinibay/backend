import { spawn } from "child_process";

const raidMap = {
  "Fast Storage": "raid0",
  "Safe Storage": "raid1",
  "Mixed Storage": "raid5",
  "Redundant Mixed Storage": "raid6"
};

const executeCommand = (command, args) => {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args);

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    childProcess.on("error", (error) => {
      reject(error);
    });

    childProcess.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr));
      } else {
        resolve(stdout || stderr);
      }
    });
  });
};

const createLibvirtStoragePool = async (storageName, disks, raidType) => {
  try {
    // Step 1: Format the disks with Btrfs filesystem
    const formatDisksCommand = "mkfs.btrfs";
    const formatDisksArgs = ["-f", ...disks];
    await executeCommand(formatDisksCommand, formatDisksArgs);

    // Step 2: Create the RAID array
    const raid = raidMap[raidType];
    const createRAIDCommand = "mkfs.btrfs";
    const createRAIDArgs = ["-m", raid, "-d", raid, ...disks];
    await executeCommand(createRAIDCommand, createRAIDArgs);

    // Step 3: Mount the RAID array
    const mountCommand = "mount";
    const mountArgs = [disks[0], `/${storageName}`]; // Replace with the desired mountpoint
    await executeCommand(mountCommand, mountArgs);

    // Step 4: Create Libvirt storage pool
    const createPoolCommand = "virsh";
    const createPoolArgs = [
      "pool-define-as",
      storageName,
      "btrfs",
      "--source-dir",
      `/${storageName}`,
    ];
    await executeCommand(createPoolCommand, createPoolArgs);

    // Step 5: Start the Libvirt storage pool
    const startPoolCommand = "virsh";
    const startPoolArgs = ["pool-start", storageName];
    await executeCommand(startPoolCommand, startPoolArgs);

    // Step 6: Set the Libvirt storage pool to auto-start
    const autostartPoolCommand = "virsh";
    const autostartPoolArgs = ["pool-autostart", storageName];
    await executeCommand(autostartPoolCommand, autostartPoolArgs);

    console.log("Libvirt storage pool created and configured successfully.");
  } catch (error) {
    console.error("An error occurred:", error);
  }
};

export default createLibvirtStoragePool;
