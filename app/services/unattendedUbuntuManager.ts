import * as pass from '@utils/password'
import { Application } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { UnattendedManagerBase } from './unattendedManagerBase';
import { cryptPassword } from "@utils/password";
import { promises as fsPromises } from "fs";

export class UnattendedUbuntuManager extends UnattendedManagerBase {
  private username: string;
  private password: string;
  private applications: Application[];

  constructor(username: string, password: string, applications: Application[]) {
    super();
    this.debug.log('Initializing UnattendedRedHatManager');
    if (!username || !password) {
      this.debug.log('error', 'Username and password are required');
      throw new Error('Username and password are required');
    }
    this.isoPath = path.join(path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'iso'), 'ubuntu.iso');
    this.username = username;
    this.password = password;
    this.applications = applications;
    this.configFileName = 'user-data';
    this.debug.log('UnattendedRedHatManager initialized');
  }

  /**
   * Generates a configuration file in YAML format.
   *
   * @returns {Promise<string>} A promise that resolves to the generated configuration file.
   */
  async generateConfig(): Promise<string> {
    //generate a random hostname, like ubuntu-xhsdDx
    const hostname = 'ubuntu-' + Math.random().toString(36).substring(7);
    const config = {
      autoinstall: {
        version: 1, // Specifies the version of the configuration. Currently, it is set to 1.

        identity: {
          hostname: hostname,
          realname: this.username, // Sets the real name of the user.
          username: this.username, // Sets the username of the user.
          password: pass.cryptPassword(this.password), // Sets the encrypted password for the user.
        },

        keyboard: {
          layout: 'us' // Sets the keyboard layout. Here, the keyboard layout is set to 'us' (United States).
        },

        locale: 'en_US', // Sets the system locale.

        network: {
          network: {
            version: 2, // Specifies the version of the network configuration.
            ethernets: {
              enp1s0: {
                dhcp4: true, // The Ethernet interface 'enp1s0' is set to use IPv4 DHCP for obtaining network configuration.
              },
            },
          },
        },

        timezone: 'America/Vancouver', // Sets the system timezone.

        apt: {
          primary: [{
            arches: ["default"],
            uri: "http://archive.ubuntu.com/ubuntu",
            search_dns: true
          }],
          geoip: true // Configures the system's Advanced Packaging Tool (APT) to use GeoIP. The system will try to determine the best package source/server based on geographic location.
        },

        // Add the 'packages' property
        packages: [
          'ubuntu-desktop',
          'gnome-software',
          'firefox',
          'qemu-guest-agent',
        ],

        codecs: true,
        drivers: true,

        storage: {
          layout: {
            name: 'lvm', // Specifies the storage layout to use Logical Volume Management (LVM).
          },
          filesystems: [
            {
              device: '/dev/vda', // Defines the storage device to be used.
              format: 'ext4', // Sets the format of the file system. Here, one ext4 filesystem is to be created.
            },
          ],
        },
        'late-commands': [
          "eject /dev/cdrom"
        ],
        // 'late-commands': this.applications.map(app => this.getUbuntuInstallCommand(app)),
      }
    };

    // Append '#cloud-config' to the beginning of the config
    return '#cloud-config\n' + yaml.dump(config);
  }

  private getUbuntuInstallCommand(app: Application): string | undefined {
    if (!app.installCommand || typeof app.installCommand !== 'object') {
      return undefined;
    }

    const installCommands = app.installCommand as Record<string, string>;
    return installCommands['ubuntu'];
  }

  async addAutoinstallConfigFile(content: string, extractDir: string, filename: string) {
    const filePath = path.join(extractDir, filename);
    await fs.promises.writeFile(filePath, content);
  }

  /**
   * Modifies the GRUB config file to add autoinstall option.
   *
   * @param {string} grubCfgPath - Path to the GRUB config file.
   * @return {Promise<void>}
   */
  async modifyGrubConfig(grubCfgPath: string) {
    /*
    Overwrite grubCfgPath with the following:
    menuentry "Autoinstall Ubuntu Server" {
        set gfxpayload=keep
        linux   /casper/vmlinuz quiet autoinstall ds=nocloud\;s=/cdrom/server/  ---
        initrd  /casper/initrd
    }
     */
    const content: string = `
menuentry "Autoinstall Ubuntu Server" {
    set gfxpayload=keep
    linux   /casper/vmlinuz quiet autoinstall quiet ds='nocloud;s=/cdrom/' --- ---
    initrd  /casper/initrd
}
`;
    await fs.promises.writeFile(grubCfgPath, content);

  }

  /**
   * Create a new ISO image with the specified path and extract directory.
   *
   * @param {string} newIsoPath - The path to the new ISO image file.
   * @param {string} extractDir - The path to the directory containing the files to be included in the ISO.
   * @throws {Error} - If the extraction directory does not exist.
   * @return {Promise<void>} - A promise that resolves when the ISO image creation process is complete.
   */
  async createISO(newIsoPath: string, extractDir: string) {
    // Ensure the extractDir exists and has content
    if (!fs.existsSync(extractDir)) {
      throw new Error('Extraction directory does not exist.');
    }

    // create empty file in autoinstall/meta-data
    await fs.promises.writeFile(path.join(extractDir, 'meta-data'), '');
    await fs.promises.writeFile(path.join(extractDir, 'vendor-data'), '');

    await this.modifyGrubConfig(path.join(extractDir, 'boot/grub/grub.cfg'));



    // Define the command and arguments for creating a new ISO image
    const isoCreationCommandParts = [
      'grub-mkrescue',
      '-o', newIsoPath, // output file
      '-V', 'Infinibay', // Volume ID
      extractDir // the path to the files to be included in the ISO
    ];

    // Use the execCommand method from the parent class
    await this.executeCommand(isoCreationCommandParts);
    // Remove the extracted directory
    await this.executeCommand(['rm', '-rf', extractDir]);
  }
}
