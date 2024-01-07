import { Application } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { UnattendedManagerBase } from './unattendedManagerBase';
import { Debugger } from '@utils/debug';

export class UnattendedRedHatManager extends UnattendedManagerBase {
  private username: string;
  private password: string;
  private applications: Application[];
  // protected debug: Debugger = new Debugger('unattended-redhat-manager');

  constructor(username: string, password: string, applications: Application[]) {
    super();
    this.debug.log('Initializing UnattendedRedHatManager');
    if (!username || !password) {
      this.debug.log('error', 'Username and password are required');
      throw new Error('Username and password are required');
    }
    this.username = username;
    this.password = password;
    this.applications = applications;
    this.configFileName = 'ks.cfg';
    this.debug.log('UnattendedRedHatManager initialized');
  }

  

 generateConfig(): string {
    this.debug.log('Generating configuration');
    const partitionConfig = this.generatePartitionConfig();
    this.debug.log('Partition configuration generated');
    const networkConfig = this.generateNetworkConfig();
    this.debug.log('Network configuration generated');
    const rootPassword = this.encryptPassword(this.generateRandomPassword(16)); // Use encryptPassword here
    this.debug.log('Root password generated and encrypted');
    const applicationsPostCommands = this.generateApplicationsConfig(); // Returns commands without %post and %end tags
    this.debug.log('Applications post commands generated');
    const userPostCommands = this.generateUserConfig(); // Returns commands without %post and %end tags
    this.debug.log('User post commands generated');
  
    // Combine all post-installation commands into one %post section
    const postInstallSection = `
  %post
  ${applicationsPostCommands}
  ${userPostCommands}
  %end
  `;
  
    return `
  #version=RHEL8
  ${partitionConfig}
  ${networkConfig}
  # System language
  lang en_US.UTF-8
  # Root password
  rootpw --iscrypted ${rootPassword}
  ${postInstallSection}
  reboot
  `;
  }

  private generateApplicationsConfig(): string {
    // Post-installation script section
    let postInstallScript = `\n`;

    // Filter applications for those compatible with Red Hat
    const redHatApps = this.applications.filter(app => 
      app.os.includes('redhat')
    );

    redHatApps.forEach(app => {
      // Find the Red Hat install command
      const redHatInstallIndex = app.os.findIndex(os => os === 'redhat');
      if (redHatInstallIndex !== -1 && app.installCommand[redHatInstallIndex]) {
        // Add the command to the post-installation script
        postInstallScript += `${app.installCommand[redHatInstallIndex]}\n`;
      }
    });

    postInstallScript += `\n`;

    return postInstallScript;
  }

  private generateRandomPassword(length: number): string {
    return randomBytes(length).toString('hex').slice(0, length);
  }

  private encryptPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = createHash('sha512');
    hash.update(password + salt);
    const hashedPassword = hash.digest('hex');
    return `$6$${salt}$${hashedPassword}`;
  }

  private generateUserConfig(): string {
    const hashedPassword = this.encryptPassword(this.password);

    return `
# Create a new user
useradd -m ${this.username}
# Set the user's password
echo "${this.username}:${hashedPassword}" | chpasswd -e
# Grant sudo privileges
echo "${this.username} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
`;
  }

  private generateNetworkConfig(): string {
    // Setting up the network configuration to use DHCP
    return `
  # Network configuration
  network --bootproto=dhcp --onboot=on
  `;
  }

  private generatePartitionConfig(): string {
    return `
  # Clear all existing partitions on the disk and initialize disk label
  clearpart --all --initlabel --drives=sda

  # Create a single root partition using the ext4 filesystem that grows to fill the disk
  part / --fstype=ext4 --grow
  `;
  }

  protected async modifyGrubConfig(grubCfgPath: string): Promise<void> {
    // Read the existing GRUB configuration file
    const grubConfig = fs.readFileSync(grubCfgPath, 'utf8');

    // Define the kickstart parameter
    const kickstartParam = `inst.ks=cdrom:/ks.cfg`;

    // Modify the GRUB configuration to include the kickstart file parameter
    const modifiedGrubConfig = grubConfig.replace(/(linux.*?)(\s|$)/g, `$1 ${kickstartParam}$2`);

    // Write the modified GRUB configuration back to the file
    fs.writeFileSync(grubCfgPath, modifiedGrubConfig, 'utf8');
  }

  protected async createISO(newIsoPath: string, extractDir: string): Promise<void> {
    // Ensure the extractDir exists and has content
    if (!fs.existsSync(extractDir)) {
      throw new Error('Extraction directory does not exist.');
    }
  
    // Create ESP image file
    const bootImgDir = (await this.executeCommand(['mktemp', '-d'])).trim();
    const bootImgData = (await this.executeCommand(['mktemp', '-d'])).trim();
    const bootImg = `${bootImgDir}/efi.img`;
  
    await this.executeCommand(['mkdir', '-p', path.dirname(bootImg)]);
    await this.executeCommand(['dd', 'if=/dev/zero', `of=${bootImg}`, 'bs=1M', 'count=8']);
    await this.executeCommand(['mkfs.vfat', bootImg]);
    await this.executeCommand(['mount', bootImg, bootImgData]);
    await this.executeCommand(['mkdir', '-p', `${bootImgData}/EFI/BOOT`]);
  
    await this.executeCommand([
      'grub-mkimage',
      '-C', 'xz',
      '-O', 'x86_64-efi',
      '-p', '/boot/grub',
      '-o', `${bootImgData}/EFI/BOOT/bootx64.efi`,
      'boot', 'linux', 'search', 'normal', 'configfile',
      'part_gpt', 'btrfs', 'ext2', 'fat', 'iso9660', 'loopback',
      'test', 'keystatus', 'gfxmenu', 'regexp', 'probe',
      'efi_gop', 'efi_uga', 'all_video', 'gfxterm', 'font',
      'echo', 'read', 'ls', 'cat', 'png', 'jpeg', 'halt', 'reboot'
    ]);
  
    await this.executeCommand(['umount', bootImgData]);
    await this.executeCommand(['rm', '-rf', bootImgData]);
  
    // Define the command and arguments for creating a new ISO image
    const isoCreationCommandParts = [
      'xorriso',
      '-as', 'mkisofs',
      '-iso-level', '3',
      '-r', // for Rock Ridge directory information
      '-V', 'Fedora_Live', // Volume ID, adjusted to comply with ISO 9660 rules
      '-J', // for Joliet directory information
      '-joliet-long', // allow Joliet file names of up to 103 Unicode characters
      '-append_partition', '2', '0xef', bootImg, // append the EFI boot partition
      '-partition_cyl_align', 'all',
      '-o', newIsoPath, // output file
      extractDir // the path to the files to be included in the ISO
    ];
  
    // Use the execCommand method from the parent class
    await this.executeCommand(isoCreationCommandParts);
  }

  // ... other methods ...
}