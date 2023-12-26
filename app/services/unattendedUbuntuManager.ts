import { Application } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import * as yaml from 'js-yaml';

export class AutoinstallUbuntuManager {
  private username: string;
  private password: string;
  private applications: Application[];

  constructor(username: string, password: string, applications: Application[]) {
    this.username = username;
    this.password = password;
    this.applications = applications;
  }

  async generateAutoinstallConfig(): Promise<string> {
    const config = {
      version: 1,
      identity: {
        realname: this.username,
        username: this.username,
        password: this.password,
      },
      network: {
        network: {
          version: 2,
          ethernets: {
            enp3s0: {
              dhcp4: true,
            },
          },
        },
      },
      storage: {
        layout: {
          name: 'lvm',
        },
        filesystems: [
          {
            device: '/dev/sda1',
            format: 'ext4',
          },
        ],
      },
      'late-commands': this.applications.map(app => this.getUbuntuInstallCommand(app)),
    };

    const configPath = path.join(os.tmpdir(), 'autoinstall_' + Date.now() + '.yaml');
    await fsPromises.writeFile(configPath, yaml.dump(config));
    return configPath;
  }

  private getUbuntuInstallCommand(app: Application): string | undefined {
    for (let i = 0; i < app.os.length; i++) {
      if (app.os[i] === 'ubuntu') {
        return app.installCommand[i];
      }
    }
  }

  // Other methods similar to UnattendedWindowsManager...
}
