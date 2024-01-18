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

  async generateConfig(): Promise<string> {
    const config = {
      version: 1,
      identity: {
        realname: this.username,
        username: this.username,
        password: pass.cryptPassword(this.password),
      },
      keyboard: {
        layout: 'us'
      },
      locale: 'en_US',
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
      timezone: 'America/Vancouver',
      apt: {
        geoip: true
      },
      storage: {
        layout: {
          name: 'lvm',
        },
        filesystems: [
          {
            device: '/dev/vda',
            format: 'ext4',
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

  async modifyBootConfig(grubCfgPath: string) {
    let config = fs.readFileSync(grubCfgPath, 'utf8');

    config = config.replace(
      /(linux\s.*\squiet)/,
      '$1 autoinstall ds=nocloud-net;s=http://{{IP}}:{{PORT}}/'
    );

    fs.writeFileSync(grubCfgPath, config);
  }

  // Inherited from UnattendedManagerBase
  async createISO(isoPath: string, extractDir: string) {
    // ...
  }
}
