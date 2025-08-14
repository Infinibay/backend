import { MachineApplication, Application } from '@prisma/client'
import { Builder } from 'xml2js'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promises as fsPromises } from 'fs'

import { UnattendedManagerBase } from './unattendedManagerBase'

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
    xmlns: 'http://schemas.microsoft.com/WMIConfig/2002/State'
  }

  private version: number = 0
  private username: string = ''
  private password: string = ''
  private productKey: string | undefined = undefined
  private applications: any[] = []
  private vmId: string = ''

  constructor (
    version: number,
    username: string,
    password: string,
    productKey: string | undefined,
    applications: any[],
    vmId?: string
  ) {
    super()
    this.configFileName = 'autounattend.xml'
    this.version = version
    this.username = username
    this.password = password
    this.productKey = productKey
    this.applications = applications
    this.vmId = vmId || ''
    this.isoPath = path.join(path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'iso'), 'windows' + this.version.toString() + '.iso')
  }

  private getFirstLogonCommands (): any[] {
    let commands = [
      {
        $: { 'wcm:action': 'add' },
        Description: 'Control Panel View',
        Order: 1,
        CommandLine: 'reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ControlPanel" /v StartupPage /t REG_DWORD /d 1 /f',
        RequiresUserInput: true
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 2,
        Description: 'Control Panel Icon Size',
        RequiresUserInput: false,
        CommandLine: 'reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ControlPanel" /v AllItemsIconView /t REG_DWORD /d 0 /f'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 3,
        RequiresUserInput: false,
        CommandLine: 'cmd /C wmic useraccount where name="' + this.username + '" set PasswordExpires=false',
        Description: 'Password Never Expires'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 4,
        Description: 'Install Virtio Drivers',
        RequiresUserInput: false,
        CommandLine: 'msiexec /i E:\\virtio-win-gt-x64.msi /quiet /norestart'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 5,
        Description: 'Install Virtio Guest Tools',
        RequiresUserInput: false,
        CommandLine: 'E:\\virtio-win-guest-tools.exe /quiet /norestart'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 6,
        Description: 'Unmount Disk D',
        RequiresUserInput: false,
        CommandLine: 'powershell -Command "(New-Object -ComObject Shell.Application).NameSpace(17).ParseName(\'D:\').InvokeVerb(\'Eject\')"'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 7,
        Description: 'Unmount Disk E',
        RequiresUserInput: false,
        CommandLine: 'powershell -Command "(New-Object -ComObject Shell.Application).NameSpace(17).ParseName(\'E:\').InvokeVerb(\'Eject\')"'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 8,
        Description: 'Create log directory',
        RequiresUserInput: false,
        CommandLine: 'mkdir C:\\Windows\\Temp\\InstallLogs'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 9,
        Description: 'Wait for network connectivity',
        RequiresUserInput: false,
        CommandLine: 'powershell -Command "& { $log = \'C:\\Windows\\Temp\\network.log\'; Write-Output \'Waiting for network...\' | Tee-Object -FilePath $log -Append; while (!(Test-Connection -ComputerName google.com -Count 1 -Quiet)) { Start-Sleep -Seconds 5 }; Write-Output \'Network is now available\' | Tee-Object -FilePath $log -Append }"'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 10,
        Description: 'Wait and update winget',
        RequiresUserInput: false,
        CommandLine: 'powershell -Command "& { $log = \'C:\\Windows\\Temp\\winget.log\'; Write-Output \'Waiting for winget...\' | Tee-Object -FilePath $log -Append; while (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 5 }; Write-Output \'Winget found, updating sources...\' | Tee-Object -FilePath $log -Append; winget source update | Tee-Object -FilePath $log -Append; Write-Output \'Winget ready\' | Tee-Object -FilePath $log -Append }"'
      }
    ]

    // Add InfiniService installation commands
    const infiniServiceCommands = this.generateInfiniServiceInstallCommands(11)
    commands = commands.concat(infiniServiceCommands)

    const apps = this.generateAppsToInstallScripts(11 + infiniServiceCommands.length)

    commands = commands.concat(apps)

    commands.push({
      $: { 'wcm:action': 'add' },
      Order: 11 + infiniServiceCommands.length + apps.length,
      Description: 'Restart System',
      RequiresUserInput: false,
      CommandLine: 'shutdown /r /t 0'
    })
    return commands
  }

  /**
   * Generates commands to install InfiniService on Windows.
   * Downloads the binary and installation script from the backend server.
   * 
   * @param idx - The starting order index for the commands
   * @returns Array of FirstLogonCommands for InfiniService installation
   */
  private generateInfiniServiceInstallCommands (idx: number): any[] {
    const backendHost = process.env.APP_HOST || 'localhost'
    const backendPort = process.env.PORT || '4000'
    const baseUrl = `http://${backendHost}:${backendPort}`
    
    const commands = [
      {
        $: { 'wcm:action': 'add' },
        Order: idx,
        Description: 'Create InfiniService temp directory',
        RequiresUserInput: false,
        CommandLine: 'powershell -Command "New-Item -ItemType Directory -Path C:\\Temp\\InfiniService -Force"'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 1,
        Description: 'Download InfiniService binary',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "& { $log = 'C:\\Windows\\Temp\\infiniservice_download.log'; try { Write-Output 'Downloading InfiniService binary...' | Tee-Object -FilePath $log -Append; Invoke-WebRequest -Uri '${baseUrl}/infiniservice/windows/binary' -OutFile 'C:\\Temp\\InfiniService\\infiniservice.exe' -UseBasicParsing; Write-Output 'Binary downloaded successfully' | Tee-Object -FilePath $log -Append } catch { Write-Output $_.Exception.Message | Tee-Object -FilePath $log -Append } }"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 2,
        Description: 'Download InfiniService installation script',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "& { $log = 'C:\\Windows\\Temp\\infiniservice_download.log'; try { Write-Output 'Downloading InfiniService installation script...' | Tee-Object -FilePath $log -Append; Invoke-WebRequest -Uri '${baseUrl}/infiniservice/windows/script' -OutFile 'C:\\Temp\\InfiniService\\install-windows.ps1' -UseBasicParsing; Write-Output 'Script downloaded successfully' | Tee-Object -FilePath $log -Append } catch { Write-Output $_.Exception.Message | Tee-Object -FilePath $log -Append } }"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 3,
        Description: 'Install InfiniService',
        RequiresUserInput: false,
        CommandLine: `powershell -ExecutionPolicy Bypass -Command "& { $log = 'C:\\Windows\\Temp\\infiniservice_install.log'; try { Write-Output 'Installing InfiniService...' | Tee-Object -FilePath $log -Append; Set-Location 'C:\\Temp\\InfiniService'; .\\install-windows.ps1 -ServiceMode 'normal' -VmId '${this.vmId}' | Tee-Object -FilePath $log -Append; Write-Output 'InfiniService installed successfully' | Tee-Object -FilePath $log -Append } catch { Write-Output $_.Exception.Message | Tee-Object -FilePath $log -Append } }"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 4,
        Description: 'Clean up InfiniService temp files',
        RequiresUserInput: false,
        CommandLine: 'powershell -Command "Remove-Item -Path C:\\Temp\\InfiniService -Recurse -Force -ErrorAction SilentlyContinue"'
      }
    ]
    
    return commands
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
  private generateAppsToInstallScripts (idx: number): any[] {
    return this.applications
      .map((app, localIndex) => {
        const installCommand = app.installCommand.windows
        // Note: The application data is already included in the app object
        // No need to fetch it again from the database
        if (!installCommand) {
          return null
        }
        const parsedCommand = this.parseInstallCommand(installCommand, app.parameters)
        const wrappedCommand = `powershell -Command "& { $log = 'C:\\Windows\\Temp\\${app.name.replace(/\s+/g, '_')}.log'; Write-Output 'Starting installation of ${app.name}...' | Tee-Object -FilePath $log -Append; $result = $null; try { $result = (${parsedCommand}) 2>&1 | Tee-Object -FilePath $log -Append; if ($LASTEXITCODE -eq 0) { Write-Output '${app.name} installed successfully' | Tee-Object -FilePath $log -Append } else { Write-Output '${app.name} installation failed with code $LASTEXITCODE' | Tee-Object -FilePath $log -Append } } catch { Write-Output $_.Exception.Message | Tee-Object -FilePath $log -Append } }"`
        return {
          $: { 'wcm:action': 'add' },
          Description: 'Install ' + app.name,
          Order: idx + localIndex,
          CommandLine: wrappedCommand,
          RequiresUserInput: false
        }
      })
      .filter(app => app !== null)
  }

  private parseInstallCommand (command: string, parameters: any = null): string {
    // Replace placeholders in the command with actual parameters
    let parsedCommand = command
    if (parameters) {
      for (const [key, value] of Object.entries(parameters)) {
        const placeholder = `{{${key}}}`
        parsedCommand = parsedCommand.replace(new RegExp(placeholder, 'g'), value as string)
      }
    }
    // TODO: Add some script to tell the host that the vm was installed properly if no error was thrown
    // or to tell the host that the vm was not installed properly if an error was thrown
    return parsedCommand
  }

  private getWindowsPEConfig (): any {
    return {
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
            name: 'Microsoft-Windows-PnpCustomizationsWinPE',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
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
    }
  }

  private getOfflineServicingConfig (): any {
    return {
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
    }
  }

  private getGeneralizeConfig (): any {
    return {
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
    }
  }

  private getSpecializeConfig (): any {
    return {
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
    }
  }

  private getOobeSystemConfig (): any {
    return {
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
            SynchronousCommand: this.getFirstLogonCommands()
          },
          TimeZone: 'Eastern Standard Time'
        }
      ]
    }
  }

  /**
   * Generates a configuration string using XML format for a specific software.
   *
   * @returns {Promise<string>} The generated configuration string.
   */
  async generateConfig (): Promise<string> {
    const builder = new Builder()
    const settings: any[] = []

    settings.push(this.getWindowsPEConfig())
    settings.push(this.getOfflineServicingConfig())
    settings.push(this.getGeneralizeConfig())
    settings.push(this.getSpecializeConfig())
    settings.push(this.getOobeSystemConfig())

    const root: any = {
      unattend: {
        $: {
          xmlns: 'urn:schemas-microsoft-com:unattend',
          'xmlns:wcm': 'http://schemas.microsoft.com/WMIConfig/2002/State'
        },
        settings
      }
    }

    const response = builder.buildObject(root)
    return response
  }

  /**
   * Creates a new ISO image from the specified extracted directory.
   *
   * @param {string} newIsoPath - The path where the new ISO image should be saved.
   * @param {string} extractDir - The path of the directory from which to create the new ISO image.
   * @throws {Error} If the extraction directory does not exist.
   * @returns {Promise<void>} A Promise that resolves when the ISO image is created and the extracted directory is removed.
   */
  async createISO (newIsoPath: string, extractDir: string) {
    // Ensure the extractDir exists and has content
    if (!fs.existsSync(extractDir)) {
      throw new Error('Extraction directory does not exist.')
    }

    // save the config to
    const imageName = 'windows' + this.version.toString() + '.iso'
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
    ]

    // Create a new ISO image
    await this.executeCommand(isoCreationCommandParts)

    // Remove the extracted directory
    await this.executeCommand(['rm', '-rf', extractDir])
  }
}
