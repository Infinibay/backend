import { exec as execLocal, spawn } from 'child_process'
import { Client } from 'ssh2'
import si from 'systeminformation'

import { Debugger } from '@utils/debug'

/*
    Step:
    1. Check if the node is already setup
    2. If not:
    3. Detect the node hardware (cpu flags, cores, ram, storage)
    4. Detect all the disks (hdd,ssd and nvme) but not the usb drives
    5. Create the adecuated Btrfs Raid level acoording to the number of disks (raid10 for 4 disks, raid5 for 3 disks, raid6 for 2 disks)
       and mount it in /mnt/storage
    6. TODO: Check if there are other nodes in the network
    7. TODO: Connect to the other nodes and create a cluster if there is another node
    8. Create a postgresql database in the new btrfs volume (/mnt/storage/postgres)
    9. Migrate prisma schema to the new database
    10. TODO: Import the main admin user from /user.json.p7m
     */
class SetupService {
  private connection: string | undefined
  private currentStep: string
  private hardwareInfo: any // Placeholder type, adjust as needed
  private blockDevices: any[] // Placeholder type, adjust as needed
  private debug: Debugger = new Debugger('setup-service')

  constructor (connection: string | undefined = undefined) {
    this.connection = connection
    // Initialize other properties as needed
  }

  /**
	 * Retrieves the current setup step from a file.
	 * This allows the setup process to resume from the last step in case of failure.
	 * @returns {string} The name of the current step.
	 */
  getStep (): string {
    // Read the step name from a file and return it
    return this.currentStep
  }

  /**
	 * Updates the current setup step in a file.
	 * This method is called after each step is successfully completed.
	 * @param {string} name - The name of the step to set.
	 */
  setStep (name: string = ''): void {
    // Write the step name to a file
  }

  /**
	 * Detects the hardware of the current node and stores the information locally.
	 * This includes CPU flags, cores, RAM, and storage.
	 */
  async detectHardware (): Promise<void> {
    try {
      const cpuInfo = await si.cpu()
      const memInfo = await si.mem()
      const diskLayout = await si.diskLayout()

      this.hardwareInfo = {
        cpu: {
          manufacturer: cpuInfo.manufacturer,
          brand: cpuInfo.brand,
          speed: cpuInfo.speed,
          cores: cpuInfo.cores,
          physicalCores: cpuInfo.physicalCores,
          processors: cpuInfo.processors,
          flags: cpuInfo.flags
        },
        memory: {
          total: memInfo.total
        },
        disks: diskLayout.map(disk => ({
          type: disk.type,
          name: disk.name,
          size: disk.size,
          interfaceType: disk.interfaceType
        }))
      }

      // Log or further process this.hardwareInfo as needed
    } catch (error) {
      this.debug.log('error', `Error detecting hardware: ${error}`)
    }
  }

  /**
	 * Installs missing dependencies required for the setup.
	 * This includes applications like PostgreSQL, Btrfs tools, etc.
	 */
  installDependencies (): void {
    // Determine missing dependencies
    // Execute system commands to install them
    const dependencies = [
      'nodejs',
      'npm',
      'postgresql',
      'postgresql-client',
      // Add any other system dependencies your project requires
      'cpu-checker',
      'qemu-kvm',
      'libvirt-daemon-system',
      'bridge-utils',
      'genisoimage',
      '7z',
      'xorriso',
      'grub-mkrescue',
      'isolinux',
      'syslinux'
      // btrfs already comes with ubuntu server
    ]

    const installCmd = ['sudo', 'apt', 'install', '-y', ...dependencies]

    this.exec(installCmd)
  }

  /**
	 * Lists all block devices connected to the system, excluding USB devices.
	 * This includes HDDs, SSDs, and NVMe drives.
	 * @returns {any[]} A list of block devices.
	 */
  async listBlockDevices (): Promise<any[]> {
    try {
      const devices = await si.blockDevices()
      return devices.map(device => ({
        path: device.name,
        type: device.type,
        size: device.size
      }))
    } catch (error) {
      this.debug.log('error', `Error listing block devices: ${error}`)
      return []
    }
  }

  /**
	 * Saves the detected block devices into the database.
	 * This requires the database to be already set up and connected.
	 */
  saveBlockDevices (): void {
    // Iterate over `this.blockDevices`
    // Save each device to the database
  }

  /**
	 * Determines the best Btrfs RAID level based on the number of disks.
	 * This is for a read-optimized scenario.
	 * @returns {string} The best RAID level for the setup.
	 */
  detectBestRaid (): string {
    // Analyze `this.blockDevices` to determine the number of disks
    // Return the best RAID level based on the number of disks
    const numDisks = this.blockDevices.length

    if (numDisks >= 4) {
      return 'raid10'
    } else if (numDisks === 3) {
      return 'raid5'
    } else if (numDisks === 2) {
      return 'raid1'
    } else {
      // For a single disk, RAID is not applicable, but returning 'single' as a placeholder
      return 'single'
    }
  }

  /**
     * Creates the master Btrfs volume.
     * This volume is mounted at /mnt/storage.
     */
  async createBtrfsVolume (): Promise<void> {
    const raidLevel = this.detectBestRaid()
    const devicePaths = this.blockDevices.map(device => device.path)

    // Adjust command for single disk (no RAID)
    const createVolumeCmd = raidLevel === 'single'
      ? ['mkfs.btrfs', ...devicePaths]
      : ['mkfs.btrfs', '-d', raidLevel, ...devicePaths]

    try {
      // Execute the command to create the Btrfs volume
      await this.exec(['sudo', ...createVolumeCmd])
      this.debug.log('info', 'Btrfs volume created successfully.')
    } catch (error) {
      this.debug.log('error', `Error in createBtrfsVolume: ${error}`)
    }
  }

  /**
	 * Mounts the Btrfs volume at /mnt/storage.
	 * @param {string} devicePath - The device path to mount.
	 */
  async mountVolume (devicePath: string): Promise<void> {
    const mountCmd = ['sudo', 'mount', devicePath, '/mnt/storage']

    try {
      await this.exec(mountCmd)
      this.debug.log('info', 'Btrfs volume mounted at /mnt/storage successfully.')
    } catch (error) {
      this.debug.log('error', `Error mounting Btrfs volume: ${error}`)
    }
  }

  /**
	 * Configures PostgreSQL to run and store databases in /mnt/storage/postgresql.
	 * This is necessary for the first node (master/controller).
	 */
  configurePsql (): void {
    // Execute system commands to configure PostgreSQL
    // Ensure databases are stored in the specified directory
  }

  /**
	 * Creates the application database.
	 */
  createDatabase (): void {
    // Execute system commands or use a library to create the database
  }

  /**
	 * Migrates the database schema using Prisma.
	 */
  migrateDatabase (): void {
    // Execute Prisma migration commands
  }

  /**
	 * Executes a series of commands.
	 * This can be used for running commands over SSH or locally.
	 * @param {string[]} commands - The commands to execute.
	 */
  exec (args: string[] = []): Promise<string> {
    if (this.connection) {
      // Handle SSH connection
      this.debug.log('Executing commands over SSH not supported yet')
      // const conn = new Client();
      // conn.on('ready', () => {
      // 	this.debug.log('Client :: ready');
      // 	commands.forEach((command) => {
      // 		conn.exec(command, (err, stream) => {
      // 			if (err) {
      // 				this.debug.log('error', `SSH exec error: ${err}`);
      // 				return;
      // 			}
      // 			stream.on('close', (code, signal) => {
      // 				this.debug.log(`Stream :: close :: code: ${code}, signal: ${signal}`);
      // 				conn.end();
      // 			}).on('data', (data) => {
      // 				this.debug.log(`SSH STDOUT: ${data}`);
      // 			}).stderr.on('data', (data) => {
      // 				this.debug.log('error', `SSH STDERR: ${data}`);
      // 			});
      // 		});
      // 	});
      // }).connect({
      // 	// Connection configuration
      // 	host: 'YOUR_SSH_SERVER',
      // 	port: 22,
      // 	username: 'YOUR_SSH_USERNAME',
      // 	privateKey: require('fs').readFileSync('path/to/your/private/key')
      // 	// You can also use password instead of privateKey
      // });
      return new Promise((resolve, reject) => {
        reject('Not implemented yet')
      })
    } else {
      // Execute commands locally
      return new Promise((resolve, reject) => {
        this.debug.log('Executing command: ', args[0], args.slice(1))
        const process = spawn(args[0], args.slice(1))
        let output = ''

        process.stdout.on('data', (data) => {
          this.debug.log(`stdout: ${data}`)
          output += data
        })

        process.stderr.on('data', (data) => {
          this.debug.log('error', `stderr: ${data}`)
        })

        process.on('close', (code) => {
          if (code === 0) {
            this.debug.log(`Command executed successfully: ${args.join(' ')}`)
            resolve(output)
          } else {
            this.debug.error(`Command failed with exit code ${code}: ${args.join(' ')}`)
            reject(new Error(`Command failed with exit code ${code}`))
          }
        })

        process.on('error', (error) => {
          this.debug.log('error', `Error occurred while executing command: ${args.join(' ')}`)
          reject(error)
        })
      })
    }
  }
}
