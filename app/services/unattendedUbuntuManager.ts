import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as unixcrypt from 'unixcrypt';
import { Application, PrismaClient } from '@prisma/client';
import { promises as fsPromises } from "fs";
import { Eta } from 'eta';

import { UnattendedManagerBase } from './unattendedManagerBase';

/**
 * This class is used to generate an unattended Ubuntu installation configuration.
 */
export class UnattendedUbuntuManager extends UnattendedManagerBase {
  private username: string;
  private password: string;
  private applications: Application[];

  constructor(username: string, password: string, applications: Application[]) {
    super();
    this.debug.log('Initializing UnattendedUbuntuManager');
    if (!username || !password) {
      this.debug.log('error', 'Username and password are required');
      throw new Error('Username and password are required');
    }
    this.isoPath = path.join(path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'iso'), 'ubuntu.iso');
    this.username = username;
    this.password = password;
    this.applications = applications;
    this.configFileName = 'user-data';
    this.debug.log('UnattendedUbuntuManager initialized');
  }

  /**
   * Generates a configuration file in YAML format for Ubuntu autoinstall.
   *
   * @returns {Promise<string>} A promise that resolves to the generated configuration file.
   */
  async generateConfig(): Promise<string> {
    // Generate a random hostname, like ubuntu-xhsdDx
    const hostname = 'ubuntu-' + Math.random().toString(36).substring(7);

    // Create the autoinstall configuration
    const config = {
      autoinstall: {
        version: 1,

        "refresh-installer": {
          update: true,
          channel: "latest/edge"
        },
        // Default apt configuration. Based on IP.
        // apt: {
        //   ...
        // }
        codecs: {
          install: true
        },
        drivers: {
          install: true
        },
        oem: {
          install: "auto"
        },
        // Lets reboot when finish the instalation
        shutdown: "reboot",
        identity: {
          hostname: hostname,
          realname: this.username,
          username: this.username,
          password: unixcrypt.encrypt(this.password), // Properly encrypt password for cloud-init
        },

        keyboard: {
          layout: 'us'
        },

        locale: 'en_US',

        network: {
          version: 2,
          ethernets: {
            enp1s0: {
              match: {
                name: "en*", // <-- This should be the one used by libvirt
              },
              dhcp4: true
            },
            eth1: {
              match: {
                name: "eth*" // This is here just in case, but provably can be removved
              },
              dhcp4: true,
            },
          },
        },

        timezone: 'UTC',  // TODO: Autodetect timezone or get it form system configuration.

        // Install Ubuntu desktop and essential packages
        packages: [
          'qemu-guest-agent',
          'ubuntu-desktop',
          'openssh-server'
        ],

        // Use the entire disk with a single partition
        // lets try the default (full disk 1 partition). This do not work
        // if the autoinstall has more than one disk
        // storage: {
        //   layout: ...
        // },

        // Add late-commands for post-installation tasks
        'late-commands': this.generateLateCommands(),
      }
    };

    // Append '#cloud-config' to the beginning of the config
    const configStr = '#cloud-config\n' + yaml.dump(config);

    return configStr;
  }

  /**
   * Generates late commands for the autoinstall configuration.
   * These commands run during installation but after the system is installed.
   *
   * @returns {string[]} Array of late commands
   */
  private generateLateCommands(): string[] {
    const commands = [
      // Create directory for per-instance scripts
      'mkdir -p /target/var/lib/cloud/scripts/per-instance',

      // Create post-installation script
      `cat > /target/var/lib/cloud/scripts/per-instance/post_install.py << 'EOF'
${this.generateMasterInstallScript()}
EOF`,

      // Make the script executable
      'chmod +x /target/var/lib/cloud/scripts/per-instance/post_install.py',

      // Create individual application installation scripts
      ...this.generateAppScriptCommands(),

      // Run the post-installation script
      'curtin in-target -- /var/lib/cloud/scripts/per-instance/post_install.py',
    ];

    return commands;
  }

  /**
   * Generates commands to create individual application installation scripts.
   *
   * @returns {string[]} Array of commands to create application scripts
   */
  private generateAppScriptCommands(): string[] {
    return this.applications.map((app, index) => {
      const scriptContent = this.generateAppInstallScript(app);
      if (!scriptContent) return '';

      const scriptName = `app_install_${app.name.replace(/[^a-zA-Z0-9]+/g, '_')}.sh`;
      return `cat > /target/var/lib/cloud/scripts/per-instance/${scriptName} << 'EOF'
${scriptContent}
EOF
chmod +x /target/var/lib/cloud/scripts/per-instance/${scriptName}`;
    }).filter(cmd => cmd !== '');
  }

  /**
   * Generates a master installation script that runs all application installation scripts.
   *
   * @returns {string} The master installation script
   */
  private generateMasterInstallScript(): string {
    // Get application scripts that have valid installation commands
    const appScripts = this.applications
      .filter(app => this.getUbuntuInstallCommand(app))
      .map(app => ({
        name: app.name,
        scriptName: app.name.replace(/\s+/g, '_'),
      }));

    // Initialize Eta template engine
    const eta = new Eta({
      views: path.join(process.env.INFINIBAY_BASE_DIR ?? path.join(__dirname, '..'), 'templates'),
      cache: true
    });

    // Render the template with our data
    try {
      const templatePath = path.join(__dirname, '../templates/post_install.py.eta');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      // Render the template with our data
      return eta.renderString(templateContent, { appScripts });
    } catch (error) {
      this.debug.log('error', `Failed to render post_install template: ${error}`);
      throw error;
    }
  }

  /**
   * Generates an installation script for a specific application.
   *
   * @param {Application} app - The application to generate a script for
   * @returns {string} The installation script or empty string if no command is available
   */
  private generateAppInstallScript(app: Application): string {
    const installCommand = this.getUbuntuInstallCommand(app);
    if (!installCommand) return '';

    const parsedCommand = this.parseInstallCommand(installCommand, app.parameters);

    return `#!/bin/bash
# Installation script for ${app.name}
echo "Starting installation of ${app.name}..."
LOG_FILE="/var/log/app_install_${app.name.replace(/\s+/g, '_')}.log"

{
  ${parsedCommand}
  if [ $? -eq 0 ]; then
    echo "${app.name} installation completed successfully"
  else
    echo "${app.name} installation failed with exit code $?"
  fi
} 2>&1 | tee -a $LOG_FILE
`;
  }

  /**
   * Parses an installation command, replacing placeholders with actual parameters.
   *
   * @param {string} command - The command template
   * @param {any} parameters - Parameters to substitute in the command
   * @returns {string} The parsed command
   */
  private parseInstallCommand(command: string, parameters: any = null): string {
    // Replace placeholders in the command with actual parameters
    let parsedCommand = command;
    if (parameters) {
      for (const [key, value] of Object.entries(parameters)) {
        const placeholder = `{{${key}}}`;
        parsedCommand = parsedCommand.replace(new RegExp(placeholder, 'g'), value as string);
      }
    }
    return parsedCommand;
  }

  /**
   * Gets the Ubuntu installation command for an application.
   *
   * @param {Application} app - The application
   * @returns {string | undefined} The installation command or undefined if not available
   */
  private getUbuntuInstallCommand(app: Application): string | undefined {
    if (!app.installCommand || typeof app.installCommand !== 'object') {
      return undefined;
    }

    const installCommands = app.installCommand as Record<string, string>;
    return installCommands['ubuntu'];
  }

  /**
   * Modifies the GRUB configuration to add autoinstall options.
   *
   * @param {string} grubCfgPath - Path to the GRUB configuration file
   * @returns {Promise<void>}
   */
  private async modifyGrubConfig(grubCfgPath: string): Promise<void> {
    try {
      const content = await fsPromises.readFile(grubCfgPath, 'utf8');

      // Create a new autoinstall entry using the hardcoded paths
      // For Ubuntu Server, these paths are standard
      const newEntry = `
# Added by Infinibay for autoinstall
menuentry "Automatic Install Ubuntu" {
  set gfxpayload=keep
  linux /casper/vmlinuz autoinstall ds=nocloud\\;s=/cdrom/nocloud/ ---
  initrd /casper/initrd
}

`;

      const newContent = newEntry + content;
      await fsPromises.writeFile(grubCfgPath, newContent, 'utf8');
      this.debug.log(`Added new autoinstall entry to GRUB configuration at ${grubCfgPath}`);
    } catch (error) {
      this.debug.log('error', `Failed to modify GRUB configuration: ${error}`);
      throw error;
    }
  }

  /**
   * Finds the first file matching a pattern in a directory.
   *
   * @param {string} dir - Directory to search
   * @param {RegExp} pattern - Pattern to match
   * @returns {Promise<string|null>} - Relative path to the file or null if not found
   */
  private async findFirstFile(dir: string, pattern: RegExp): Promise<string|null> {
    try {
      const files = await fsPromises.readdir(dir);
      const match = files.find(file => pattern.test(file));
      return match ? match : null;
    } catch (error) {
      this.debug.log('error', `Error finding file in ${dir}: ${error}`);
      return null;
    }
  }

  /**
   * Creates a new ISO image with the autoinstall configuration.
   *
   * @param {string} newIsoPath - The path to the new ISO image file
   * @param {string} extractDir - The directory containing the extracted ISO
   * @returns {Promise<void>}
   */
  async createISO(newIsoPath: string, extractDir: string): Promise<void> {
    // Ensure the extractDir exists and has content
    if (!fs.existsSync(extractDir)) {
      throw new Error('Extraction directory does not exist.');
    }

    this.debug.log('Creating autoinstall configuration files...');

    // Create nocloud directory for autoinstall files as per Ubuntu documentation
    const noCloudDir = path.join(extractDir, 'nocloud');
    await fsPromises.mkdir(noCloudDir, { recursive: true });

    // Generate the configuration once and reuse it
    const config = await this.generateConfig();

    // Create required files in nocloud directory
    await fsPromises.writeFile(path.join(noCloudDir, 'meta-data'), '');
    await fsPromises.writeFile(path.join(noCloudDir, 'user-data'), config);
    await fsPromises.writeFile(path.join(noCloudDir, 'vendor-data'), '');

    // Also place copies in the root directory for compatibility
    await fsPromises.writeFile(path.join(extractDir, 'meta-data'), '');
    await fsPromises.writeFile(path.join(extractDir, 'user-data'), config);
    await fsPromises.writeFile(path.join(extractDir, 'vendor-data'), '');

    // Find and modify GRUB configurations
    const grubCfgPath = path.join(extractDir, 'boot/grub/grub.cfg');
    if (fs.existsSync(grubCfgPath)) {
      await this.modifyGrubConfig(grubCfgPath);
      this.debug.log(`Modified GRUB configuration at ${grubCfgPath}`);
    } else {
      this.debug.log('warning', 'Could not find GRUB configuration file at expected path');
    }

    this.debug.log('Examining ISO structure...');

    // Check for crucial paths and files
    if (!fs.existsSync(path.join(extractDir, 'boot/grub/i386-pc/eltorito.img'))) {
      this.debug.log('error', 'BIOS boot image not found at expected path');
    }

    if (!fs.existsSync(path.join(extractDir, 'EFI/boot/bootx64.efi'))) {
      this.debug.log('error', 'EFI boot image not found at expected path');
    }

    // xorriso -indev /opt/infinibay/iso/ubuntu.iso -report_el_torito as_mkisofs
    // That command outputs all the command needed to reuild the iso.
    const isoCreationCommandParts = [
      'xorriso',
      '-as', 'mkisofs',
      '-V', 'UBUNTU',                 // Volume ID (must be ≤ 16 chars)
      '--grub2-mbr', `--interval:local_fs:0s-15s:zero_mbrpt,zero_gpt:${this.isoPath}`,
      '--protective-msdos-label',
      '-partition_cyl_align', 'off',
      '-partition_offset', '16',
      '--mbr-force-bootable',
      '-append_partition', '2', '28732ac11ff8d211ba4b00a0c93ec93b', `--interval:local_fs:4087764d-4097891d::${this.isoPath}`,
      '-appended_part_as_gpt',
      '-iso_mbr_part_type', 'a2a0d0ebe5b9334487c068b6b72699c7',
      '-c', `/boot.catalog`,
      '-b', '/boot/grub/i386-pc/eltorito.img',
      '-no-emul-boot',
      '-boot-load-size' ,'4',
      '-boot-info-table',
      '--grub2-boot-info',
      '-eltorito-alt-boot',
      '-e', `--interval:appended_partition_2_start_1021941s_size_10128d:all::`,
      '-no-emul-boot',
      '-boot-load-size', '10128',
      '-o', newIsoPath,               // Output path
      // Source directory
      extractDir
    ];

    // Use the executeCommand method from the parent class
    try {
      this.debug.log(`Creating ISO with command: ${isoCreationCommandParts.join(' ')}`);
      await this.executeCommand(isoCreationCommandParts);
      this.debug.log(`Created ISO at ${newIsoPath}`);

      // Remove the extracted directory
      await this.executeCommand(['rm', '-rf', extractDir]);
      this.debug.log(`Removed extracted directory ${extractDir}`);
    } catch (error) {
      this.debug.log('error', `Failed to create ISO: ${error}`);
      throw error;
    }
  }

  /**
   * Recursively searches for files matching a pattern within a directory.
   *
   * @param {string} baseDir - The base directory to start the search from
   * @param {string} dir - The current directory being searched
   * @param {RegExp} pattern - Regular expression pattern to match filenames
   * @returns {Promise<string[]>} - Array of paths relative to the extractDir
   */
  private async findBootFiles(dir: string, pattern: RegExp, extractDir?: string): Promise<string[]> {
    const results: string[] = [];
    let files: fs.Dirent[];

    try {
      files = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      this.debug.log('error', `Failed to read directory ${dir}: ${error}`);
      return results;
    }

    for (const file of files) {
      const fullPath = path.join(dir, file.name);

      try {
        if (file.isDirectory()) {
          const subResults = await this.findBootFiles(fullPath, pattern, extractDir || dir);
          results.push(...subResults);
        } else if (pattern.test(file.name)) {
          // If extractDir is provided, make the path relative to it
          // Otherwise, just use the filename
          const relativePath = extractDir 
            ? path.relative(extractDir, fullPath)
            : file.name;

          results.push(relativePath);
          this.debug.log(`Found boot file: ${relativePath}`);
        }
      } catch (error) {
        this.debug.log('warning', `Error processing ${fullPath}: ${error}`);
      }
    }

    return results;
  }
}
