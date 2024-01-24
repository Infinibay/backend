import { Application } from '@prisma/client';
import { Builder } from 'xml2js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promises as fsPromises } from 'fs';

import { UnattendedManagerBase } from './unattendedManagerBase';


export interface ComponentConfig {
    name: string;
    processorArchitecture: string;
    publicKeyToken: string;
    language: string;
    versionScope: string;
    xmlns: string;
}

/**
 * This class is used to generate an unattended Windows XML file.
 *
 * Example usage:
 *
 * const generator = new UnattendedWindowsManager(
 *     'admin',
 *     'password',
 *     'productKey',
 *     applications
 * );
 *
 * const xml = generator.generateNewImage();
 */

export class UnattendedWindowsManager extends UnattendedManagerBase {
  private static readonly COMPONENT_BASE_CONFIG: ComponentConfig = {
    name: 'Microsoft-Windows-Shell-Setup',
    processorArchitecture: 'amd64',
    publicKeyToken: '31bf3856ad364e35',
    language: 'neutral',
    versionScope: 'nonSxS',
    xmlns: 'http://schemas.microsoft.com/WMIConfig/2002/State',
  };

  private version: number = 0;
  private username: string = '';
  private password: string = '';
  private productKey: string | undefined = undefined;
  private applications: Application[] = [];

  constructor(
    version: number,
    username: string,
    password: string,
    productKey: string | undefined,
    applications: Application[]
  ) {
    super();
    this.configFileName = 'autounattend.xml';
    this.version = version;
    this.username = username;
    this.password = password;
    this.productKey = productKey;
    this.applications = applications;
    this.isoPath = path.join(process.env.ISO_PATH ?? '/opt/infinibay/iso', 'windows' + this.version.toString() + '.iso');
  }

  /**
   * This method is used to add applications to the settings.
   * It iterates over the applications and for each application that supports 'windows',
   * it creates a 'specialize' component with a 'FirstLogonCommands' section.
   * The 'FirstLogonCommands' section contains a 'SynchronousCommand' to install the application.
   * The created component is then added to the settings.
   *
   * @param settings - The settings to which the applications are being added.
   *
   * For more information on the 'FirstLogonCommands' component, refer to:
   * https://docs.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-shell-setup-firstlogoncommands
   */
  private addApplicationsToSettings(settings: any[]): void {
  }

  /**
   * Generates a configuration string using XML format for a specific software.
   *
   * @returns {Promise<string>} The generated configuration string.
   */
  async generateConfig(): Promise<string> {
    const builder = new Builder();
    const settings: any[] = [];
    let root: any = {
      unattend: {
        $: {
          xmlns: 'urn:schemas-microsoft-com:unattend',
          'xmlns:wcm': 'http://schemas.microsoft.com/WMIConfig/2002/State'
          // processorArchitecture: 'amd64',
          // publicKeyToken: '31bf3856ad364e35',
          // language: 'neutral',
          // versionScope: 'nonSxS'
        },
        settings: []
      }
    }

    let windowsPE = {
      $: {
        pass: 'windowsPE'
      },
      component: [
        {
          $: {
            name: 'Microsoft-Windows-International-Core-WinPE',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          SetupUILanguage: {
            UILanguage: 'en-US'
          },
          InputLocale: 'en-US',
          SystemLocale: 'en-US',
          UILanguage: 'en-US',
          UserLocale: 'en-US'
        },
      {
          $: {
            name: 'Microsoft-Windows-Setup',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          ImageInstall: {
            OSImage: {
              InstallTo: {
                DiskID: 0,
                PartitionID: 2
              }
            }
          },
          UserData: {
            ProductKey: {
              // This product key does not activate windows, just set the version to install, in our case
              // we use windows 10 home or 11 home. Both keys are Windows Generic key.
              // DON'T WORRY, IT'S 100 LEGAL, these are not stolen keys, are just generic one used by
              // microsoft to specify the version
              // https://devicepartner.microsoft.com/en-us/communications/comm-windows-10-build
              // https://learn.microsoft.com/en-us/windows-server/get-started/kms-client-activation-keys
              Key: 'TX9XD-98N7V-6WMQ6-BX7FG-H8Q99' // both 10 home and 11 home use the same generic key
            },
            AcceptEula: true
          },
          DiskConfiguration: {
            DiskID: 0,
            WillWipeDisk: true,
            CreatePartitions: [
              {
                CreatePartition: {
                  $: {
                    'wcm:action': 'add'
                  },
                  Order: 1,
                  Type: 'Primary',
                  Size: 300
                }
              },
              {
                CreatePartition: {
                  $: {
                    'wcm:action': 'add'
                  },
                  Order: 2,
                  Type: 'Primary',
                  Extend: true
                }
              }
            ],
            ModifyPartitions: [
              {
                ModifyPartition: {
                  $: {
                    'wcm:action': 'add'
                  },
                  Order: 1,
                  PartitionID: 1,
                  Label: 'System',
                  Format: 'NTFS',
                  Active: true
                }
              },
              {
                ModifyPartition: {
                  $: {
                    'wcm:action': 'add'
                  },
                  Order: 2,
                  PartitionID: 2,
                  Label: 'Windows',
                  Letter: 'C',
                  Format: 'NTFS'
                }
              }
            ],
            WillShowUI: 'OnError'
          }
        }
      ]
    }

    const generalize = {
      $: {
        pass: 'generalize'
      }
    }

    // Right now, does nothing, but could be used to modify windows register and enable or dissable features
    const specialize = {
      $: {
        pass: 'specialize'
      },
      component: {
        $: {
          name: 'Microsoft-Windows-Deployment',
          processorArchitecture: 'amd64',
          publicKeyToken: '31bf3856ad364e35',
          language: 'neutral',
          versionScope: 'nonSxS'
        },
      }
    }

    const auditSystem = {
      $: {
        pass: 'auditSystem'
      }
    }

    const auditUser = {
      $: {
        pass: 'auditUser'
      }
    }

    let oobeSystem: any = {
      $: {
        pass: 'oobeSystem'
      },
      component: [
        {
          $: {
            name: 'Microsoft-Windows-International-Core',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          SetupUILanguage: {
            UILanguage: 'en-US'
          },
          InputLocale: 'en-US',
          SystemLocale: 'en-US',
          UILanguage: 'en-US',
          UserLocale: 'en-US'
        },
        {
          $: {
            name: 'Microsoft-Windows-Shell-Setup',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          UserAccounts: {
            LocalAccounts: {
              LocalAccount: {
                $: {
                  'wcm:action': 'add'
                },
                Name: this.username,
                Group: 'Administrators',
                Password: {
                  Value: this.password,
                  PlainText: true
                }
              }
            }
          },
          OOBE: {
            ProtectYourPC: 3, // Turn off sharing data and things like that
            HideEULAPage: true,
            HideWirelessSetupInOOBE: true
          }
        }
      ]
    }

    if (this.productKey) {
      oobeSystem['component'][1]["ProductKey"] = this.productKey
    }

    // lets add everything to root component
    root['unattend']['settings'].push(windowsPE)
    root['unattend']['settings'].push(generalize)
    root['unattend']['settings'].push(specialize)
    root['unattend']['settings'].push(auditSystem)
    root['unattend']['settings'].push(auditUser)
    root['unattend']['settings'].push(oobeSystem)

    return builder.buildObject(root);
  }

  /**
   * Creates a new ISO image from the specified extracted directory.
   *
   * @param {string} newIsoPath - The path where the new ISO image should be saved.
   * @param {string} extractDir - The path of the directory from which to create the new ISO image.
   * @throws {Error} If the extraction directory does not exist.
   * @returns {Promise<void>} A Promise that resolves when the ISO image is created and the extracted directory is removed.
   */
  async createISO(newIsoPath: string, extractDir: string) {
    // Ensure the extractDir exists and has content
    if (!fs.existsSync(extractDir)) {
      throw new Error('Extraction directory does not exist.');
    }

    // save the config to
    const imageName = "windows" + this.version.toString() + ".iso";
    // Define the command and arguments for creating a new ISO image
    /*
    mkisofs -b boot/etfsboot.com -no-emul-boot -c BOOT.CAT -iso-level 4 -J -l -D -N -joliet-long -relaxed-filenames -v -V "Custom" -udf -boot-info-table -eltorito-alt-boot -eltorito-boot efi/microsoft/boot/efisys_noprompt.bin -no-emul-boot -o install.iso -allow-limited-size /tmp/extracted_iso_1705986374004/

    xorriso -as mkisofs -iso-level 4 -l -R -D -volid "CCCOMA_X64FRE_EN-US_DV9" -b boot/etfsboot.com -no-emul-boot -boot-load-size 8 -hide boot.catalog -eltorito-alt-boot -eltorito-platform efi -no-emul-boot -b efi/microsoft/boot/efisys.bin -eltorito-alt-boot -e efi/boot/bootx64.efi -no-emul-boot -isohybrid-gpt-basdat -o install.iso newWin
     */
    const isoCreationCommandParts = [
      'xorriso',
      '-as', 'mkisofs',
      '-iso-level', '4',
      '-l',
      '-R',
      '-D',
      '-volid', 'CCCOMA_X64FRE_EN-US_DV9',
      '-b', 'boot/etfsboot.com',
      '-no-emul-boot',
      '-boot-load-size', '8',
      '-hide', 'boot.catalog',
      '-eltorito-alt-boot',
      '-eltorito-platform', 'efi',
      '-no-emul-boot',
      '-b', 'efi/microsoft/boot/efisys.bin',
      '-eltorito-alt-boot',
      '-e', 'efi/boot/bootx64.efi',
      '-no-emul-boot',
      '-isohybrid-gpt-basdat',
      '-allow-limited-size',
      '-o', newIsoPath,
      extractDir
    ];

    // Create a new ISO image
    await this.executeCommand(isoCreationCommandParts);

    // Remove the extracted directory
    await this.executeCommand(['rm', '-rf', extractDir]);
  }
}
