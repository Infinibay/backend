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
 *     '10.0.19041.0',
 *     'admin',
 *     'password',
 *     'productKey',
 *     applications
 * );
 * 
 * const xml = generator.generateXML();
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

  constructor(
    private version: string,
    private username: string,
    private password: string,
    private productKey: string | null,
    private applications: Application[]
  ) {
    super();
    this.configFileName = 'autounattend.xml';
    this.username = username;
    this.password = password;
    this.productKey = productKey;
    this.applications = applications;
  }

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
  generateConfig(): string {
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
}

