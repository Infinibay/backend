// import { spawn, ChildProcessWithoutNullStreams } from "child_process";

// interface RaidMap {
//   [key: string]: string;
// }

// const raidMap: RaidMap = {
//   "Fast Storage": "raid0",
//   "Safe Storage": "raid1",
//   "Mixed Storage": "raid5",
//   "Redundant Mixed Storage": "raid6"
// };

// const executeCommand = (command: string, args: string[]): Promise<string> => {
//   return new Promise((resolve, reject) => {
//     const childProcess: ChildProcessWithoutNullStreams = spawn(command, args);

//     let stdout = "";
//     let stderr = "";

//     childProcess.stdout.on("data", (data: Buffer) => {
//       stdout += data.toString();
//     });

//     childProcess.stderr.on("data", (data: Buffer) => {
//       stderr += data.toString();
//     });

//     childProcess.on("error", (error: Error) => {
//       reject(error);
//     });

//     childProcess.on("close", (code: number) => {
//       if (code !== 0) {
//         reject(new Error(stderr));
//       } else {
//         resolve(stdout || stderr);
//       }
//     });
//   });
// };

// const createLibvirtStoragePool = async (storageName: string, disks: string[], raidType: keyof RaidMap): Promise<void> => {
//   try {
//     const formatDisksCommand = "mkfs.btrfs";
//     const formatDisksArgs = ["-f", ...disks];
//     await executeCommand(formatDisksCommand, formatDisksArgs);

//     const raid = raidMap[raidType];
//     const createRAIDCommand = "mkfs.btrfs";
//     const createRAIDArgs = ["-m", raid, "-d", raid, ...disks];
//     await executeCommand(createRAIDCommand, createRAIDArgs);

//     const mountCommand = "mount";
//     const mountArgs = [disks[0], `/${storageName}`];
//     await executeCommand(mountCommand, mountArgs);

//     const createPoolCommand = "virsh";
//     const createPoolArgs = [
//       "pool-define-as",
//       storageName,
//       "btrfs",
//       "--source-dir",
//       `/${storageName}`,
//     ];
//     await executeCommand(createPoolCommand, createPoolArgs);

//     const startPoolCommand = "virsh";
//     const startPoolArgs = ["pool-start", storageName];
//     await executeCommand(startPoolCommand, startPoolArgs);

//     const autostartPoolCommand = "virsh";
//     const autostartPoolArgs = ["pool-autostart", storageName];
//     await executeCommand(autostartPoolCommand, autostartPoolArgs);

//     console.log("Libvirt storage pool created and configured successfully.");
//   } catch (error) {
//     console.error("An error occurred:", error);
//   }
// };

// export default createLibvirtStoragePool;
