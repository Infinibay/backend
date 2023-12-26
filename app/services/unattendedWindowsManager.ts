import { Application } from '@prisma/client';
import { Builder } from 'xml2js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promises as fsPromises } from 'fs';


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
 *     '10.0.19041.0',
 *     'admin',
 *     'password',
 *     'productKey',
 *     applications
 * );
 * 
 * const xml = generator.generateXML();
 */

export class UnattendedWindowsManager {
  private static readonly COMPONENT_BASE_CONFIG: ComponentConfig = {
    name: 'Microsoft-Windows-Shell-Setup',
    processorArchitecture: 'amd64',
    publicKeyToken: '31bf3856ad364e35',
    language: 'neutral',
    versionScope: 'nonSxS',
    xmlns: 'http://schemas.microsoft.com/WMIConfig/2002/State',
  };

  constructor(
    private version: string,
    private username: string,
    private password: string,
    private productKey: string | null,
    private applications: Application[]
  ) {}

  /**
   * This method creates a base component with the specified pass.
   * The component is created with the base configuration defined in COMPONENT_BASE_CONFIG.
   * 
   * @param pass - The pass for which the component is being created.
   * 
   * @returns An object representing the base component.
   * 
   * For more information on passes, refer to:
   * https://docs.microsoft.com/en-us/windows-hardware/manufacture/desktop/windows-setup-automation-overview
   */
  private createBaseComponent(pass: string): any {
    return {
      $: { pass },
      component: [
        {
          $: UnattendedWindowsManager.COMPONENT_BASE_CONFIG,
        },
      ],
    };
  }

  /**
   * This method adds the AutoLogon component to the provided component.
   * The AutoLogon component is used to automatically log on to the computer and is configured with the username and password provided.
   * 
   * @param component - The component to which the AutoLogon component is being added.
   * 
   * For more information on the AutoLogon component, refer to:
   * https://docs.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-shell-setup-autologon
   */
  private addAutoLogon(component: any): void {
    component.component[0].AutoLogon = [
      {
        Password: [{ Value: this.password }],
        Enabled: ['true'],
        Username: [this.username],
      },
    ];
  }

  /**
   * This method adds the ProductKey component to the provided component.
   * The ProductKey component is used to specify the product key for the Windows installation.
   * 
   * @param component - The component to which the ProductKey component is being added.
   * 
   * For more information on the ProductKey component, refer to:
   * https://docs.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-setup-productkey
   */
  private addProductKey(component: any): void {
    if (this.productKey) {
      component.component[0].ProductKey = [this.productKey];
    }
  }

  /**
   * This method adds the OOBE (Out of Box Experience) component to the provided component.
   * The OOBE component is used to customize the initial Windows setup experience.
   * 
   * @param component - The component to which the OOBE component is being added.
   * 
   * For more information on the OOBE component, refer to:
   * https://docs.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-shell-setup-oobe
   */
  private addOOBE(component: any): void {
    component.component[0].OOBE = [
      {
        HideEULAPage: ['true'],
        HideOEMRegistrationScreen: ['true'],
        HideOnlineAccountScreens: ['true'],
        HideWirelessSetupInOOBE: ['true'],
        SkipUserOOBE: ['true'],
        SkipMachineOOBE: ['true'],
      },
    ];
  }

  /**
   * This method adds the DiskConfiguration component to the provided component.
   * The DiskConfiguration component is used to specify the disk configuration for the Windows installation.
   * 
   * @param component - The component to which the DiskConfiguration component is being added.
   * 
   * For more information on the DiskConfiguration component, refer to:
   * https://docs.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-setup-diskconfiguration
   */
  private addDiskConfiguration(component: any): void {
    component.component[0]['DiskConfiguration'] = [
      {
        Disk: [
          {
            $: { 'wcm:action': 'add' },
            DiskID: ['0'],
            WillWipeDisk: ['true'],
            CreatePartitions: [
              {
                CreatePartition: [
                  {
                    $: { 'wcm:action': 'add' },
                    Order: ['1'],
                    Type: ['Primary'],
                    Extend: ['true'],
                  },
                ],
              },
            ],
            ModifyPartitions: [
              {
                ModifyPartition: [
                  {
                    $: { 'wcm:action': 'add' },
                    Order: ['1'],
                    PartitionID: ['1'],
                    Format: ['NTFS'],
                    Label: ['Windows'],
                    Active: ['true'],
                  },
                ],
              },
            ],
          },
        ],
        ImageInstall: [
          {
            OSImage: [
              {
                InstallTo: [
                  {
                    DiskID: ['0'],
                    PartitionID: ['1'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
  }

  /**
   * This method is used to add user accounts to the component.
   * It sets the AdministratorPassword and creates a LocalAccount with the provided username and password.
   * The created LocalAccount is added to the Administrators group.
   * 
   * @param component - The component to which the UserAccounts are being added.
   * 
   * For more information on the UserAccounts component, refer to:
   * https://docs.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/microsoft-windows-shell-setup-useraccounts
   */
  private addUserAccounts(component: any): void {
    component.component[0]['UserAccounts'] = {
      AdministratorPassword: {
        Value: this.password,
        PlainText: ['true']
      },
      LocalAccounts: {
        LocalAccount: [
          {
            $: { 'wcm:action': 'add' },
            Name: this.username,
            Password: {
              Value: this.password,
              PlainText: ['true']
            },
            Group: ['Administrators'],
            DisplayName: this.username,
            Description: 'Local administrator account'
          }
        ]
      }
    };
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
    this.applications.forEach((app, appIndex) => {
      app.os.forEach((os, osIndex) => {
        if (os === 'windows') {
          const appComponent = this.createBaseComponent('specialize');
          appComponent.component[0]['FirstLogonCommands'] = {
            SynchronousCommand: [
              {
                $: { 'wcm:action': 'add' },
                Order: [appIndex.toString()],
                CommandLine: app.installCommands[osIndex],
                Description: 'Install ' + app.name,
              },
            ],
          };
          settings.push(appComponent);
        }
      });
    });
  }

  /**
   * This method is used to generate the XML for the unattended Windows installation.
   * It first creates a new XML builder, then initializes an empty settings array.
   * It then creates and adds various components to the settings array, such as the 'specialize' pass logic,
   * the 'OOBE' logic, the disk configuration logic, and the applications.
   * Finally, it builds and returns the XML string.
   */
  generateXML(): string {
    const builder = new Builder();
    const settings: any[] = [];

    // Specialize pass logic
    const specializeComponent = this.createBaseComponent('specialize');
    this.addAutoLogon(specializeComponent);
    this.addProductKey(specializeComponent);
    this.addUserAccounts(specializeComponent);
    settings.push(specializeComponent);

    // OOBE logic
    const oobeComponent = this.createBaseComponent('oobeSystem');
    this.addOOBE(oobeComponent);
    settings.push(oobeComponent);

    // Disk configuration logic
    const diskConfigComponent = this.createBaseComponent('windowsPE');
    this.addDiskConfiguration(diskConfigComponent);
    settings.push(diskConfigComponent);

    // Add applications
    this.addApplicationsToSettings(settings);

    const obj = {
      unattend: {
        $: { xmlns: 'urn:schemas-microsoft-com:unattend' },
        settings,
      },
    };

    return builder.buildObject(obj);
  }

  /**
   * This method generates a new image for the unattended Windows installation.
   * It first validates the paths for the ISO, XML, and output files.
   * Then, it generates a random file name for the new ISO and creates a path for it.
   * It extracts the ISO to a temporary directory, adds the XML to the file system, and creates a new ISO.
   * Finally, it cleans up the extracted files and returns the path of the new ISO.
   * @returns {Promise<string>} The path of the new ISO.
   * @throws {Error} If there is an error during the process.
   */
  async generateNewImage(): Promise<string> {
    let extractDir: string | null = null;
    try {
      const isoPath = this.validatePath(process.env.ISO_PATH, '/mnt/tmp/iso');
      const xmlPath = this.validatePath(process.env.XML_PATH, '/mnt/tmp/autounattend');
      const outputPath = this.validatePath(process.env.OUTPUT_PATH, '/mnt/tmp/isos');
  
      const newIsoName = this.generateRandomFileName();
      const newIsoPath = path.join(outputPath, newIsoName);
  
      extractDir = await this.extractISO(isoPath);
      await this.addXMLToFileSystem(xmlPath, extractDir);
      await this.createISO(newIsoPath, extractDir);
  
      // Optional: Clean up extracted files
      await this.cleanup(extractDir);
  
      return newIsoPath;
    } catch (error) {
      console.error('Error generating new image:', error);
      if (extractDir) {
        await this.cleanup(extractDir);
      }
      throw error;
    }
  }

  /**
   * Validates the given path. If the path is not set or invalid, it uses the default path.
   * @param {string | undefined} envPath - The path to validate.
   * @param {string} defaultPath - The default path to use if the envPath is not set or invalid.
   * @returns {string} The validated path.
   */
  private validatePath(envPath: string | undefined, defaultPath: string): string {
    if (!envPath || !fs.existsSync(envPath)) {
      console.warn(`Path not set or invalid. Using default path: ${defaultPath}`);
      return defaultPath;
    }
    return envPath;
  }

  /**
   * This method generates a random file name for the new ISO.
   * It uses the Math.random function to generate a random number, converts it to a string with base 36,
   * and then takes a substring of the result. It appends the '.iso' extension to the end of the string.
   * @returns {string} The random file name.
   */
  private generateRandomFileName(): string {
    return Math.random().toString(36).substring(2, 15) + '.iso';
  }

  /**
   * This method extracts the ISO file to a temporary directory.
   * It uses the 7z command to extract the ISO file.
   * @param {string} isoPath - The path to the ISO file.
   * @returns {Promise<string>} The path to the directory where the ISO file was extracted.
   */
  private async extractISO(isoPath: string): Promise<string> {
    const extractDir = path.join(os.tmpdir(), 'extracted_iso_' + Date.now());
    await fsPromises.mkdir(extractDir, { recursive: true });
    await this.executeCommand(['7z', 'x', isoPath, '-o' + extractDir]);
    return extractDir;
  }

  /**
   * This method adds an XML file to the file system.
   * It copies the XML file from the given path to the destination path.
   * @param {string} xmlPath - The path to the XML file.
   * @param {string} extractDir - The directory where the XML file will be copied.
   * @returns {Promise<void>}
   */
  private async addXMLToFileSystem(xmlPath: string, extractDir: string): Promise<void> {
    const destPath = path.join(extractDir, 'autounattend.xml');
    await fsPromises.copyFile(xmlPath, destPath);
  }

  /**
   * This method creates a new ISO file from the extracted directory.
   * It uses the 'mkisofs' command to create the ISO file.
   * @param {string} newIsoPath - The path where the new ISO file will be created.
   * @param {string} extractDir - The directory from which the ISO file will be created.
   * @returns {Promise<void>}
   */
  private async createISO(newIsoPath: string, extractDir: string): Promise<void> {
    await this.executeCommand(['mkisofs', '-o', newIsoPath, '-b', 'boot/etfsboot.com', '-no-emul-boot', '-boot-load-size', '8', '-iso-level', '2', '-udf', '-joliet', '-D', '-N', '-relaxed-filenames', '-boot-info-table', '-v', extractDir]);
  }

  /**
   * This method cleans up the temporary directory used for ISO extraction.
   * It uses the fsPromises.rm method to delete the directory and all its contents.
   * @param {string} extractDir - The directory to be cleaned up.
   * @returns {Promise<void>}
   */
  private async cleanup(extractDir: string): Promise<void> {
    try {
        // Safety check: Ensure extractDir is not undefined and is the expected path
        if (!extractDir || !extractDir.includes('expected_path_identifier')) {
            throw new Error('Invalid directory path for cleanup.');
        }

        console.log(`Starting cleanup of directory: ${extractDir}`);
        await fsPromises.rm(extractDir, { recursive: true, force: true });
        console.log(`Successfully cleaned up directory: ${extractDir}`);
    } catch (error) {
        console.error(`Error during cleanup: ${error}`);
        // Handle or rethrow error based on your error handling strategy
    }
}
  
  /**
   * This method executes a command using the spawn function from the 'child_process' module.
   * It takes an array of command parts as input, where the first element is the command and the rest are the arguments.
   * The method returns a Promise that resolves when the command finishes successfully, and rejects if the command fails or an error occurs.
   * @param {string[]} commandParts - The command to execute and its arguments.
   * @returns {Promise<void>}
   */
  private executeCommand(commandParts: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const process = spawn(commandParts[0], commandParts.slice(1));

        process.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        process.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with exit code ${code}`));
            }
        });

        process.on('error', (error) => {
            reject(error);
        });
    });
  }
}

