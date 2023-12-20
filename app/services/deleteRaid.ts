import { spawn } from "child_process";

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

const deleteLibvirtStorageAndRAID = async (storageName, disks) => {
  try {
    // Step 1: Stop and undefine the Libvirt storage pool
    const stopPoolCommand = "virsh";
    const stopPoolArgs = ["pool-destroy", storageName];
    await executeCommand(stopPoolCommand, stopPoolArgs);

    const undefinePoolCommand = "virsh";
    const undefinePoolArgs = ["pool-undefine", storageName];
    await executeCommand(undefinePoolCommand, undefinePoolArgs);

    // Step 2: Unmount the RAID 0 array
    const unmountCommand = "umount";
    const unmountArgs = [`/${storageName}`]; // Replace with the actual mountpoint
    await executeCommand(unmountCommand, unmountArgs);

    // Step 3: Remove the RAID 0 array
    const removeRAIDCommand = "btrfs";
    const removeRAIDArgs = ["device", "delete", ...disks];
    await executeCommand(removeRAIDCommand, removeRAIDArgs);

    console.log("Libvirt storage pool deleted and RAID 0 array removed successfully.");
  } catch (error) {
    console.error("An error occurred:", error);
  }
};

export default deleteLibvirtStorageAndRAID;
