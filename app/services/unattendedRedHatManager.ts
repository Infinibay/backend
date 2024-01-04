import { Application } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

import { UnattendedManagerBase } from './unattendedManagerBase';
import { Debugger } from '@utils/debug';

export class UnattendedRedHatManager extends UnattendedManagerBase {
  private username: string;
  private password: string;
  private applications: Application[];
  protected debug: Debugger = new Debugger('unattended-redhat-manager');

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

  // ... other methods ...
}