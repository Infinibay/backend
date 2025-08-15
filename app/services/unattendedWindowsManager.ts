import { MachineApplication, Application } from '@prisma/client'
import { Builder } from 'xml2js'
import { spawn, execSync } from 'child_process'
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

export interface LanguageConfig {
  uiLanguage: string;
  inputLocale: string;
  systemLocale: string;
  userLocale: string;
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

  private static readonly LANGUAGE_MAP: Record<string, LanguageConfig> = {
    'en-US': {
      uiLanguage: 'en-US',
      inputLocale: '0409:00000409',
      systemLocale: 'en-US',
      userLocale: 'en-US'
    },
    'es-ES': {
      uiLanguage: 'es-ES',
      inputLocale: '040a:0000040a',
      systemLocale: 'es-ES',
      userLocale: 'es-ES'
    },
    'es-MX': {
      uiLanguage: 'es-MX',
      inputLocale: '080a:0000080a',
      systemLocale: 'es-MX',
      userLocale: 'es-MX'
    },
    'fr-FR': {
      uiLanguage: 'fr-FR',
      inputLocale: '040c:0000040c',
      systemLocale: 'fr-FR',
      userLocale: 'fr-FR'
    },
    'de-DE': {
      uiLanguage: 'de-DE',
      inputLocale: '0407:00000407',
      systemLocale: 'de-DE',
      userLocale: 'de-DE'
    },
    'it-IT': {
      uiLanguage: 'it-IT',
      inputLocale: '0410:00000410',
      systemLocale: 'it-IT',
      userLocale: 'it-IT'
    },
    'pt-BR': {
      uiLanguage: 'pt-BR',
      inputLocale: '0416:00000416',
      systemLocale: 'pt-BR',
      userLocale: 'pt-BR'
    },
    'pt-PT': {
      uiLanguage: 'pt-PT',
      inputLocale: '0816:00000816',
      systemLocale: 'pt-PT',
      userLocale: 'pt-PT'
    },
    'ja-JP': {
      uiLanguage: 'ja-JP',
      inputLocale: '0411:e0010411',
      systemLocale: 'ja-JP',
      userLocale: 'ja-JP'
    },
    'zh-CN': {
      uiLanguage: 'zh-CN',
      inputLocale: '0804:00000804',
      systemLocale: 'zh-CN',
      userLocale: 'zh-CN'
    },
    'ko-KR': {
      uiLanguage: 'ko-KR',
      inputLocale: '0412:e0010412',
      systemLocale: 'ko-KR',
      userLocale: 'ko-KR'
    },
    'ru-RU': {
      uiLanguage: 'ru-RU',
      inputLocale: '0419:00000419',
      systemLocale: 'ru-RU',
      userLocale: 'ru-RU'
    }
  }

  private version: number = 0
  private username: string = ''
  private password: string = ''
  private productKey: string | undefined = undefined
  private applications: any[] = []
  private vmId: string = ''
  private languageConfig: LanguageConfig

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
    this.languageConfig = this.detectLanguage()
  }

  /**
   * Detects the appropriate language configuration for the Windows installation.
   * Priority: 1. ISO language, 2. Host system language, 3. Default to en-US
   */
  private detectLanguage(): LanguageConfig {
    // First try to detect ISO language
    const isoLanguage = this.detectISOLanguage()
    if (isoLanguage && UnattendedWindowsManager.LANGUAGE_MAP[isoLanguage]) {
      console.log(`Using ISO language: ${isoLanguage}`)
      return UnattendedWindowsManager.LANGUAGE_MAP[isoLanguage]
    }

    // Fallback to host system language
    const hostLanguage = this.getHostSystemLanguage()
    if (hostLanguage && UnattendedWindowsManager.LANGUAGE_MAP[hostLanguage]) {
      console.log(`Using host system language: ${hostLanguage}`)
      return UnattendedWindowsManager.LANGUAGE_MAP[hostLanguage]
    }

    // Default to en-US
    console.log('Using default language: en-US')
    return UnattendedWindowsManager.LANGUAGE_MAP['en-US']
  }

  /**
   * Attempts to detect the language from the Windows ISO file.
   * This checks the ISO filename and content for language indicators.
   */
  private detectISOLanguage(): string | null {
    try {
      // Check if ISO path is set and file exists
      if (!this.isoPath || !fs.existsSync(this.isoPath)) {
        return null
      }

      // Check filename for language codes
      const filename = path.basename(this.isoPath).toLowerCase()
      
      // Common patterns in Windows ISO filenames
      const languagePatterns: Record<string, string> = {
        'es-es': 'es-ES',
        'es_es': 'es-ES',
        'spanish': 'es-ES',
        'espanol': 'es-ES',
        'es-mx': 'es-MX',
        'es_mx': 'es-MX',
        'en-us': 'en-US',
        'en_us': 'en-US',
        'english': 'en-US',
        'fr-fr': 'fr-FR',
        'fr_fr': 'fr-FR',
        'french': 'fr-FR',
        'de-de': 'de-DE',
        'de_de': 'de-DE',
        'german': 'de-DE',
        'it-it': 'it-IT',
        'it_it': 'it-IT',
        'italian': 'it-IT',
        'pt-br': 'pt-BR',
        'pt_br': 'pt-BR',
        'brazilian': 'pt-BR',
        'pt-pt': 'pt-PT',
        'pt_pt': 'pt-PT',
        'portuguese': 'pt-PT',
        'ja-jp': 'ja-JP',
        'ja_jp': 'ja-JP',
        'japanese': 'ja-JP',
        'zh-cn': 'zh-CN',
        'zh_cn': 'zh-CN',
        'chinese': 'zh-CN',
        'ko-kr': 'ko-KR',
        'ko_kr': 'ko-KR',
        'korean': 'ko-KR',
        'ru-ru': 'ru-RU',
        'ru_ru': 'ru-RU',
        'russian': 'ru-RU'
      }

      for (const [pattern, language] of Object.entries(languagePatterns)) {
        if (filename.includes(pattern)) {
          return language
        }
      }

      // Try to extract ISO info using isoinfo if available
      try {
        const isoInfo = execSync(`isoinfo -d -i "${this.isoPath}" 2>/dev/null | grep -i "volume id" || true`, { encoding: 'utf-8' })
        const volumeId = isoInfo.toLowerCase()
        
        for (const [pattern, language] of Object.entries(languagePatterns)) {
          if (volumeId.includes(pattern)) {
            return language
          }
        }
      } catch (e) {
        // isoinfo not available or failed, continue
      }

      return null
    } catch (error) {
      console.error('Error detecting ISO language:', error)
      return null
    }
  }

  /**
   * Gets the language configuration from the host system.
   */
  private getHostSystemLanguage(): string | null {
    try {
      // Try to get locale from environment variables
      const locale = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES
      
      if (locale) {
        // Parse locale string (e.g., "es_ES.UTF-8" -> "es-ES")
        const match = locale.match(/^([a-z]{2})_([A-Z]{2})/)
        if (match) {
          const language = `${match[1]}-${match[2]}`
          // Check if we have a mapping for this language
          if (UnattendedWindowsManager.LANGUAGE_MAP[language]) {
            return language
          }
          // Try with just the language code
          const baseLanguage = Object.keys(UnattendedWindowsManager.LANGUAGE_MAP).find(
            key => key.startsWith(match[1] + '-')
          )
          if (baseLanguage) {
            return baseLanguage
          }
        }
      }

      // Try to get locale using the locale command
      try {
        const localeOutput = execSync('locale | grep LANG=', { encoding: 'utf-8' })
        const match = localeOutput.match(/LANG=([a-z]{2})_([A-Z]{2})/)
        if (match) {
          const language = `${match[1]}-${match[2]}`
          if (UnattendedWindowsManager.LANGUAGE_MAP[language]) {
            return language
          }
        }
      } catch (e) {
        // locale command not available or failed
      }

      return null
    } catch (error) {
      console.error('Error detecting host system language:', error)
      return null
    }
  }

  private getFirstLogonCommands (): any[] {
    let commands = [
      {
        $: { 'wcm:action': 'add' },
        Description: 'Control Panel View',
        Order: 1,
        CommandLine: 'reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ControlPanel" /v StartupPage /t REG_DWORD /d 1 /f',
        RequiresUserInput: false
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
        CommandLine: `powershell -Command "$log = 'C:\\Windows\\Temp\\network.log'; Write-Output 'Waiting for network...' | Tee-Object -FilePath $log -Append; while (!(Test-Connection -ComputerName google.com -Count 1 -Quiet)) { Start-Sleep -Seconds 5 }; Write-Output 'Network is now available' | Tee-Object -FilePath $log -Append"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: 10,
        Description: 'Wait and update winget',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$log = 'C:\\Windows\\Temp\\winget.log'; Write-Output 'Waiting for winget...' | Tee-Object -FilePath $log -Append; while (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 5 }; Write-Output 'Winget found, updating sources...' | Tee-Object -FilePath $log -Append; winget source update | Tee-Object -FilePath $log -Append; Write-Output 'Winget ready' | Tee-Object -FilePath $log -Append"`
      }
    ]

    // Add InfiniService installation commands (now returns 12 commands instead of 5)
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
        Description: 'Ensure C:\\Temp directory exists',
        RequiresUserInput: false,
        CommandLine: 'cmd.exe /c mkdir C:\\Temp 2>nul'
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 1,
        Description: 'Initialize InfiniService installation log',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; Write-Output \\"[$timestamp] === INFINISERVICE INSTALLATION STARTED ===\\" | Out-File -FilePath $logFile -Encoding UTF8; Write-Output \\"[$timestamp] VM ID: ${this.vmId}\\" | Out-File -FilePath $logFile -Append -Encoding UTF8; Write-Output \\"[$timestamp] Backend URL: ${baseUrl}\\" | Out-File -FilePath $logFile -Append -Encoding UTF8"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 2,
        Description: 'Create InfiniService temp directory',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "New-Item -ItemType Directory -Path C:\\Temp\\InfiniService -Force -ErrorAction SilentlyContinue | Out-Null; $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; Write-Output \\"[$timestamp] Created directory C:\\Temp\\InfiniService\\" | Out-File -FilePath 'C:\\Temp\\infiniservice_install.log' -Append -Encoding UTF8"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 3,
        Description: 'Download InfiniService binary',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; $url = '${baseUrl}/infiniservice/windows/binary'; $outFile = 'C:\\Temp\\InfiniService\\infiniservice.exe'; Write-Output \\"[$timestamp] Downloading from $url\\" | Out-File -FilePath $logFile -Append -Encoding UTF8; try { Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing; $fileSize = (Get-Item $outFile -ErrorAction SilentlyContinue).Length; Write-Output \\"[$timestamp] Downloaded binary: $fileSize bytes\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 } catch { Write-Output \\"[$timestamp] ERROR: Binary download failed - $_\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 }"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 4,
        Description: 'Verify binary download',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; $binaryPath = 'C:\\Temp\\InfiniService\\infiniservice.exe'; if (Test-Path $binaryPath) { $fileInfo = Get-Item $binaryPath; Write-Output \\"[$timestamp] Binary verified: $($fileInfo.Length) bytes\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 } else { Write-Output \\"[$timestamp] ERROR: Binary not found\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 }"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 5,
        Description: 'Download InfiniService installation script',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; $url = '${baseUrl}/infiniservice/windows/script'; $outFile = 'C:\\Temp\\InfiniService\\install-windows.ps1'; Write-Output \\"[$timestamp] Downloading from $url\\" | Out-File -FilePath $logFile -Append -Encoding UTF8; try { Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing; $fileSize = (Get-Item $outFile -ErrorAction SilentlyContinue).Length; Write-Output \\"[$timestamp] Downloaded script: $fileSize bytes\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 } catch { Write-Output \\"[$timestamp] ERROR: Script download failed - $_\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 }"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 6,
        Description: 'Verify script download',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; $scriptPath = 'C:\\Temp\\InfiniService\\install-windows.ps1'; if (Test-Path $scriptPath) { $fileInfo = Get-Item $scriptPath; Write-Output \\"[$timestamp] Script verified: $($fileInfo.Length) bytes\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 } else { Write-Output \\"[$timestamp] ERROR: Script not found\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 }"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 7,
        Description: 'Check PowerShell environment',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; $executionPolicy = Get-ExecutionPolicy; $psVersion = $PSVersionTable.PSVersion; Write-Output \\"[$timestamp] PowerShell $psVersion, Policy: $executionPolicy\\" | Out-File -FilePath $logFile -Append -Encoding UTF8"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 8,
        Description: 'Install InfiniService',
        RequiresUserInput: false,
        CommandLine: `powershell -ExecutionPolicy Bypass -Command "Set-Location 'C:\\Temp\\InfiniService'; $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; Write-Output \\"[$timestamp] Installing InfiniService for VM ${this.vmId}\\" | Out-File -FilePath $logFile -Append -Encoding UTF8; .\\install-windows.ps1 -ServiceMode 'normal' -VmId '${this.vmId}' *>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8; Write-Output \\"[$timestamp] Installation script completed\\" | Out-File -FilePath $logFile -Append -Encoding UTF8"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 9,
        Description: 'Verify InfiniService installation',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; $service = Get-Service -Name 'Infiniservice' -ErrorAction SilentlyContinue; if ($service) { Write-Output \\"[$timestamp] Service Status: $($service.Status)\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 } else { Write-Output \\"[$timestamp] ERROR: Service not found\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 }; if (Test-Path 'C:\\Program Files\\Infiniservice') { Write-Output \\"[$timestamp] Installation verified\\" | Out-File -FilePath $logFile -Append -Encoding UTF8 }"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 10,
        Description: 'Check environment variables',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $logFile = 'C:\\Temp\\infiniservice_install.log'; $vmId = [Environment]::GetEnvironmentVariable('INFINIBAY_VM_ID', 'Machine'); $mode = [Environment]::GetEnvironmentVariable('INFINISERVICE_MODE', 'Machine'); Write-Output \\"[$timestamp] VM_ID: $vmId, MODE: $mode\\" | Out-File -FilePath $logFile -Append -Encoding UTF8; Write-Output \\"[$timestamp] === INSTALLATION COMPLETED ===\\" | Out-File -FilePath $logFile -Append -Encoding UTF8"`
      },
      {
        $: { 'wcm:action': 'add' },
        Order: idx + 11,
        Description: 'Clean up InfiniService temp files',
        RequiresUserInput: false,
        CommandLine: `powershell -Command "Remove-Item -Path C:\\Temp\\InfiniService -Recurse -Force -ErrorAction SilentlyContinue; $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; Write-Output \\"[$timestamp] Cleanup completed\\" | Out-File -FilePath 'C:\\Temp\\infiniservice_install.log' -Append -Encoding UTF8"`
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
        const appNameSafe = app.name.replace(/\s+/g, '_').replace(/['"]/g, '')
        const appNameEscaped = app.name.replace(/'/g, "''")
        const wrappedCommand = `powershell -ExecutionPolicy Bypass -Command "$log = 'C:\\Windows\\Temp\\${appNameSafe}.log'; Write-Output 'Starting installation of ${appNameEscaped}...' | Tee-Object -FilePath $log -Append; try { ${parsedCommand} 2>&1 | Tee-Object -FilePath $log -Append; if ($LASTEXITCODE -eq 0) { Write-Output '${appNameEscaped} installed successfully' | Tee-Object -FilePath $log -Append } else { Write-Output '${appNameEscaped} installation failed with code $LASTEXITCODE' | Tee-Object -FilePath $log -Append } } catch { Write-Output $_.Exception.Message | Tee-Object -FilePath $log -Append }"`
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
            UILanguage: this.languageConfig.uiLanguage,
            WillShowUI: 'Never'
          },
          InputLocale: this.languageConfig.inputLocale,
          SystemLocale: this.languageConfig.systemLocale,
          UILanguage: this.languageConfig.uiLanguage,
          UILanguageFallback: this.languageConfig.uiLanguage,
          UserLocale: this.languageConfig.userLocale
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
          },
          RunSynchronous: this.version >= 11 ? {
            RunSynchronousCommand: [
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 1,
                Path: 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 2,
                Path: 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 3,
                Path: 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 4,
                Path: 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassStorageCheck /t REG_DWORD /d 1 /f'
              },
              {
                $: {
                  'wcm:action': 'add'
                },
                Order: 5,
                Path: 'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f'
              }
            ]
          } : undefined
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
          InputLocale: this.languageConfig.inputLocale,
          SystemLocale: this.languageConfig.systemLocale,
          UILanguage: this.languageConfig.uiLanguage,
          UILanguageFallback: this.languageConfig.uiLanguage,
          UserLocale: this.languageConfig.userLocale
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
            name: 'Microsoft-Windows-International-Core',
            processorArchitecture: 'amd64',
            publicKeyToken: '31bf3856ad364e35',
            language: 'neutral',
            versionScope: 'nonSxS'
          },
          InputLocale: this.languageConfig.inputLocale,
          SystemLocale: this.languageConfig.systemLocale,
          UILanguage: this.languageConfig.uiLanguage,
          UILanguageFallback: this.languageConfig.uiLanguage,
          UserLocale: this.languageConfig.userLocale
        },
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
            HideLocalAccountScreen: true,
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