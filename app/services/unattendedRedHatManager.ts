import { Application } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

import { UnattendedManagerBase } from './unattendedManagerBase';

/**
 * UnattendedRedHatManager is a class that extends UnattendedManagerBase.
 * It is used to generate a Kickstart configuration file for unattended Red Hat installations.
 * The class takes a username, password, and a list of applications as parameters.
 * It generates a configuration file that includes the user credentials and the post-installation scripts for the applications (TODO).
 *
 * Usage:
 * const unattendedManager = new UnattendedRedHatManager(username, password, applications);
 * const config = unattendedManager.generateConfig();
 *
 * For more information on Kickstart installations, refer to the Red Hat documentation:
 * https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/7/html/installation_guide/chap-kickstart-installations
 */

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
    this.isoPath = path.join(process.env.ISO_PATH ?? '/opt/infinibay/iso', 'fedora.iso');
    this.username = username;
    this.password = password;
    this.applications = applications;
    this.configFileName = 'ks.cfg';
    this.debug.log('UnattendedRedHatManager initialized');
  }

  async generateConfig(): Promise<string> {
    this.debug.log('Root password generated and encrypted');
    const applicationsPostCommands = this.generateApplicationsConfig(); // Returns commands without %post and %end tags
    this.debug.log('Applications post commands generated');
    this.debug.log('User post commands generated');

    // Combine all post-installation commands into one %post section
    //     const postInstallSection = `
    // %post
    // # Explicitly set graphical.target as default as this is how initial-setup detects which version to run
    // systemctl set-default graphical.target
    // %end
    //   `;

    return `
#version=RHEL8

# Use graphical install
graphical

#repo --name=default --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=fedora-$releasever&arch=$basearch
#repo --name=updates --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=updates-released-f$releasever&arch=$basearch
##repo --name=updates-testing --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=updates-testing-f$releasever&arch=$basearch
#url --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=fedora-$releasever&arch=$basearch

#repo --name=default --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=fedora-39&arch=x86_64
#repo --name=updates --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=updates-released-f$39&arch=x86_64
##repo --name=updates-testing --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=updates-testing-f$releasever&arch=$basearch
#url --mirrorlist=https://mirrors.fedoraproject.org/mirrorlist?repo=fedora-39&arch=x86_64

# Enable selinux
selinux --enforcing

# System language
lang en_US.UTF-8

# Keyboard layouts
keyboard us

# Network information
network --bootproto=dhcp --onboot=on --activate

# Root password
rootpw --lock --iscrypted locked

# System timezone
timezone America/New_York

# System bootloader configuration
bootloader --timeout=1

# Clear the Master Boot Record
zerombr

# Partition clearing information
# clearpart --all --initlabel --drives=vda
clearpart --all --initlabel --disklabel=msdos

# Disk partitioning information
# autopart --type=lvm
autopart --type=btrfs --noswap

# System services
services --enabled=sshd,NetworkManager,chronyd

# System authorization information
#auth  --useshadow  --passalgo=sha512

# Create a user
user "--name=${this.username}" "--password=${this.password}" --plaintext --gecos="${this.username}"

# Reboot After Installation
reboot --eject

# Firewall configuration
firewall --enabled --ssh

# Package Selection
%packages
# Install full fedora workstation (https://github.com/kororaproject/kp-config/blob/master/kickstart.d/fedora-workstation-common.ks)
# Exclude unwanted groups that fedora-live-base.ks pulls in

# VM performance
qemu-guest-agent
spice-vdagent

# Make sure to sync any additions / removals done here with
# workstation-product-environment in comps
@base-x
@core
@Fedora Workstation

# Exclude unwanted packages from @anaconda-tools group
-gfs2-utils
-reiserfs-utils
%end

%addon com_redhat_kdump --enable --reserve-mb='auto'
%end
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

  protected async modifyGrubConfig(grubCfgPath: string): Promise<void> {
    // Read the existing GRUB configuration file
    const grubConfig = fs.readFileSync(grubCfgPath, 'utf8');

    // Define the kickstart parameter
    const kickstartParam = `inst.ks=cdrom:/ks.cfg`;

    // Modify the GRUB configuration to include the kickstart file parameter
    let modifiedGrubConfig = grubConfig.replace(/(^\s*linux\s+.*)/gm, `$1 inst.ks=cdrom:/ks.cfg`);
    // Update inst.stage2=.* to be inst.stage2=live:CDLABEL=Infinibay
    modifiedGrubConfig = modifiedGrubConfig.replace(/(^\s*linux\s+.*\s+inst.stage2=)(.*?)(\s+.*)/gm, `$1live:CDLABEL=Infinibay $3`);
    // Write the modified GRUB configuration back to the file
    fs.writeFileSync(grubCfgPath, modifiedGrubConfig, 'utf8');
  }

  protected async createISO(newIsoPath: string, extractDir: string): Promise<void> {
    // Ensure the extractDir exists and has content
    if (!fs.existsSync(extractDir)) {
      throw new Error('Extraction directory does not exist.');
    }

    //move boot/grub2 into boot/grub
    await this.executeCommand(['mv', path.join(extractDir, 'boot/grub2'), path.join(extractDir, 'boot/grub')]);

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
  // ... other methods ...
}
