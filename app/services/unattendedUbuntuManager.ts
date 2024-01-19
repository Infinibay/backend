import * as pass from '@utils/password'
import { Application } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { UnattendedManagerBase } from './unattendedManagerBase';
import { cryptPassword } from "@utils/password";

export class UnattendedUbuntuManager extends UnattendedManagerBase {
  private username: string;
  private password: string;
  private applications: Application[];

  constructor(username: string, password: string, applications: Application[]) {
    super()
    this.username = username;
    this.password = password;
    this.applications = applications;
    this.configFileName = 'autoinstall.yaml';
  }

  /**
   * Generates a configuration file in YAML format.
   *
   * @returns {Promise<string>} A promise that resolves to the generated configuration file.
   */
  async generateConfig(): Promise<string> {
    const config = {
      version: 1, // Specifies the version of the configuration. Currently, it is set to 1.

      identity: {
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
            enp3s0: {
              dhcp4: true, // The Ethernet interface 'enp3s0' is set to use IPv4 DHCP for obtaining network configuration.
            },
          },
        },
      },

      timezone: 'America/Vancouver', // Sets the system timezone.

      apt: {
        geoip: true // Configures the system's Advanced Packaging Tool (APT) to use GeoIP. The system will try to determine the best package source/server based on geographic location.
      },

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
      // 'late-commands': this.applications.map(app => this.getUbuntuInstallCommand(app)),
    };

    return yaml.dump(config);
  }

  private getUbuntuInstallCommand(app: Application): string | undefined {
    for (let i = 0; i < app.os.length; i++) {
      if (app.os[i] === 'ubuntu') {
        return app.installCommand[i];
      }
    }
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
    let config = fs.readFileSync(grubCfgPath, 'utf8');

    config = config.replace(
      /(linux\s.*\squiet)/,
      `$1 autoinstall ds=cdrom`
    );

    fs.writeFileSync(grubCfgPath, config);
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
