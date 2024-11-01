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
    this.isoPath = path.join(path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'iso'), 'windows' + this.version.toString() + '.iso');
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
        },
        settings: []
      }
    };

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
          InputLocale: '0409:00000409',
          SystemLocale: 'en-US',
          UILanguage: 'en-US',
          UILanguageFallback: 'en-US',
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
          DiskConfiguration: {
            Disk: {
              $: {
                'wcm:action': 'add'
              },
              DiskID: 0,
              WillWipeDisk: true,
              CreatePartitions: {
                CreatePartition: [
                  {
                    $: {
                      'wcm:action': 'add'
                    },
                    Order: 1,
                    Type: 'Primary',
                    Size: 300
                  },
                  {
                    $: {
                      'wcm:action': 'add'
                    },
                    Order: 2,
                    Type: 'EFI',
                    Size: 500
                  },
                  {
                    $: {
                      'wcm:action': 'add'
                    },
                    Order: 3,
                    Type: 'MSR',
                    Size: 128
                  },
                  {
                    $: {
                      'wcm:action': 'add'
                    },
                    Order: 4,
                    Type: 'Primary',
                    Extend: true
                  }
                ]
              },
              ModifyPartitions: {
                ModifyPartition: [
                  {
                    $: {
                      'wcm:action': 'add'
                    },
                    Order: 1,
                    PartitionID: 1,
                    Label: 'WINRE',
                    Format: 'NTFS',
                    TypeID: 'DE94BBA4-06D1-4D40-A16A-BFD50179D6AC'
                  },
                  {
                    $: {
                      'wcm:action': 'add'
                    },
                    Order: 2,
                    PartitionID: 2,
                    Label: 'System',
                    Format: 'FAT32'
                  },
                  {
                    $: {
                      'wcm:action': 'add'
                    },
                    Order: 3,
                    PartitionID: 3
                  },
                  {
                    $: {
                      'wcm:action': 'add'
                    },
                    Order: 4,
                    PartitionID: 4,
                    Label: 'MainDiskName',
                    Letter: 'C',
                    Format: 'NTFS'
                  }
                ]
              }
            }
          },
          ImageInstall: {
            OSImage: {
              InstallTo: {
                DiskID: 0,
                PartitionID: 4
              },
              InstallToAvailablePartition: false
            }
          },
          UserData: {
            ProductKey: {
              Key: 'W269N-WFGWX-YVC9B-4J6C9-T83GX',
              WillShowUI: 'Never'
            },
            AcceptEula: true,
            FullName: this.username,
            Organization: 'OrgName'
          }
        },
        {
          $: {
            name: "Microsoft-Windows-PnpCustomizationsWinPE",
            processorArchitecture: "amd64",
            publicKeyToken: "31bf3856ad364e35",
            language: "neutral",
            versionScope: "nonSxS"
          },
          DriverPaths: {
            PathAndCredentials: {
              $: {
                'wcm:action': 'add',
                'wcm:keyValue': '1'
              },
              Path: (this.version >= 11 ? 'E:\\amd64\\w11' : 'E:\\amd64\\w10'),
              Credentials: {
                Domain: '',
                Username: '',
                Password: ''
              }
            }
          }
        }
      ]
    };

    let offlineServicing = {
      $: {
        pass: 'offlineServicing'
      },
      component: [
        {
          $: {
            name: 'Microsoft-Windows-LUA-Settings',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          EnableLUA: false
        }
      ]
    };

    let generalize = {
      $: {
        pass: 'generalize'
      },
      component: [
        {
          $: {
            name: 'Microsoft-Windows-Security-SPP',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          SkipRearm: 1
        }
      ]
    };

    let specialize = {
      $: {
        pass: 'specialize'
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
          InputLocale: '0409:00000409',
          SystemLocale: 'en-US',
          UILanguage: 'en-US',
          UILanguageFallback: 'en-US',
          UserLocale: 'en-US'
        },
        {
          $: {
            name: 'Microsoft-Windows-Security-SPP-UX',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          SkipAutoActivation: true
        },
        {
          $: {
            name: 'Microsoft-Windows-SQMApi',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          CEIPEnabled: 0
        },
        {
          $: {
            name: 'Microsoft-Windows-Shell-Setup',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          ComputerName: 'ComputerName',
          ProductKey: 'W269N-WFGWX-YVC9B-4J6C9-T83GX'
        }
      ]
    };

    let oobeSystem = {
      $: {
        pass: 'oobeSystem'
      },
      component: [
        {
          $: {
            name: 'Microsoft-Windows-Shell-Setup',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          AutoLogon: {
            Password: {
              Value: this.password,
              PlainText: true
            },
            Enabled: true,
            Username: this.username
          },
          OOBE: {
            HideEULAPage: true,
            HideOEMRegistrationScreen: true,
            HideOnlineAccountScreens: true,
            HideWirelessSetupInOOBE: true,
            NetworkLocation: 'Home',
            SkipUserOOBE: true,
            SkipMachineOOBE: true,
            ProtectYourPC: 1
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
                },
                Description: 'User Description',
                DisplayName: this.username
              }
            }
          },
          RegisteredOrganization: 'OrgName',
          RegisteredOwner: this.username,
          DisableAutoDaylightTimeSet: false,
          FirstLogonCommands: {
            SynchronousCommand: [
              {
                $: {
                  'wcm:action': 'add'
                },
                Description: 'Control Panel View',
                Order: 1,
                CommandLine: 'reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ControlPanel" /v StartupPage /t REG_DWORD /d 1 /f',
                RequiresUserInput: true
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 2,
                Description: 'Control Panel Icon Size',
                RequiresUserInput: false,
                CommandLine: 'reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ControlPanel" /v AllItemsIconView /t REG_DWORD /d 0 /f'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 3,
                RequiresUserInput: false,
                CommandLine: 'cmd /C wmic useraccount where name="Username" set PasswordExpires=false',
                Description: 'Password Never Expires'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 4,
                Description: 'Install Virtio Drivers',
                RequiresUserInput: false,
                CommandLine: 'msiexec /i E:\\virtio-win-gt-x64.msi /quiet /norestart'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 5,
                Description: 'Install Virtio Guest Tools',
                RequiresUserInput: false,
                CommandLine: 'E:\\virtio-win-guest-tools.exe /quiet /norestart'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 6,
                Description: 'Unmount Disk D',
                RequiresUserInput: false,
                CommandLine: 'powershell -Command "Dismount-DiskImage -ImagePath D:"'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 7,
                Description: 'Unmount Disk E',
                RequiresUserInput: false,
                CommandLine: 'powershell -Command "Dismount-DiskImage -ImagePath E:"'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 8,
                Description: 'Restart System',
                RequiresUserInput: false,
                CommandLine: 'shutdown /r /t 0'
              }
            ]
          },
          TimeZone: 'Eastern Standard Time'
        }
      ]
    };

    root['unattend']['settings'].push(windowsPE);
    root['unattend']['settings'].push(offlineServicing);
    root['unattend']['settings'].push(generalize);
    root['unattend']['settings'].push(specialize);
    root['unattend']['settings'].push(oobeSystem);

    let response = builder.buildObject(root);
    console.log(response);
    return response;
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
      '-b', 'efi/microsoft/boot/efisys_noprompt.bin',
      '-eltorito-alt-boot',
      '-e', 'efi/boot/bootx64.efi',
      '-no-emul-boot',
      '-isohybrid-gpt-basdat',
      '-o', newIsoPath,
      extractDir
    ];

    // Create a new ISO image
    await this.executeCommand(isoCreationCommandParts);

    // Remove the extracted directory
    await this.executeCommand(['rm', '-rf', extractDir]);
  }
}
