import { Application } from '@prisma/client';
import { Builder } from 'xml2js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promises as fsPromises } from 'fs';

import { Debugger } from '@utils/debug';
// ... other imports ...

export class UnattendedManagerBase {
  protected debug: Debugger = new Debugger('unattended-manager-base');

  configFileName: string | null = null;

  public generateConfig(): string {
    return '';
  }

  async generateNewImage(): Promise<string> {
    this.debug.log('Starting to generate new image');
    let extractDir: string | null = null;
    try {
      this.debug.log('Validating ISO path');
      const isoPath = this.validatePath(process.env.ISO_PATH, '/opt/infinibay/iso/fedora.iso');
      this.debug.log('Generating config');
      const configPath = await this.generateConfig();
      this.debug.log('Validating output path');
      const outputPath = this.validatePath(process.env.OUTPUT_PATH, '/opt/infinibay/isos');
  
      this.debug.log('Generating random file name for new ISO');
      const newIsoName = this.generateRandomFileName();
      const newIsoPath = path.join(outputPath, newIsoName);
  
      this.debug.log('Extracting ISO');
      extractDir = await this.extractISO(isoPath);
      if (this.configFileName) {
        this.debug.log('Adding autoinstall config file');
        await this.addAutonistallConfigFile(configPath, extractDir, this.configFileName);
      } else {
        this.debug.log('Error: configFileName is not set');
        throw new Error('configFileName is not set');
      }
      this.debug.log('Creating new ISO');
      await this.createISO(newIsoPath, extractDir);
      // TODO: We may need to delete the iso file in the future, after finishing the installation process
  
      // Optional: Clean up extracted files
      this.debug.log('Cleaning up extracted files');
      await this.cleanup(extractDir);
  
      this.debug.log('New image generated successfully');
      return newIsoPath;
    } catch (error) {
      this.debug.log(`Error generating new image: ${error}`);
      if (extractDir) {
        this.debug.log('Cleaning up extracted files due to error');
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
  protected validatePath(envPath: string | undefined, defaultPath: string): string {
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
  protected generateRandomFileName(): string {
    return Math.random().toString(36).substring(2, 15) + '.iso';
  }

  /**
   * This method extracts the ISO file to a temporary directory.
   * It uses the 7z command to extract the ISO file.
   * @param {string} isoPath - The path to the ISO file.
   * @returns {Promise<string>} The path to the directory where the ISO file was extracted.
   */
  protected async extractISO(isoPath: string): Promise<string> {
    const extractDir = path.join(os.tmpdir(), 'extracted_iso_' + Date.now());
    this.debug.log(`Creating directory ${extractDir} for ISO extraction`);
    await fsPromises.mkdir(extractDir, { recursive: true });
    this.debug.log(`Extracting ISO file ${isoPath} to ${extractDir}`);
    await this.executeCommand(['7z', 'x', isoPath, '-o' + extractDir]);
    this.debug.log(`ISO file ${isoPath} extracted successfully to ${extractDir}`);
    return extractDir;
  }

  /**
   * This method adds fileName to the file system.
   * It copies the XML file from the given path to the destination path.
   * @param {string} xmlPath - The path to the XML file.
   * @param {string} extractDir - The directory where the XML file will be copied.
   * @returns {Promise<void>}
   */
  protected async addAutonistallConfigFile(xmlPath: string, extractDir: string, fileName: string): Promise<void> {
    const destPath = path.join(extractDir, fileName);
    await fsPromises.copyFile(xmlPath, destPath);
  }

  /**
   * This method creates a new ISO file from the extracted directory.
   * It uses the 'mkisofs' command to create the ISO file.
   * @param {string} newIsoPath - The path where the new ISO file will be created.
   * @param {string} extractDir - The directory from which the ISO file will be created.
   * @returns {Promise<void>}
   */
  protected async createISO(newIsoPath: string, extractDir: string): Promise<void> {
    await this.executeCommand(['mkisofs', '-o', newIsoPath, '-b', 'boot/etfsboot.com', '-no-emul-boot', '-boot-load-size', '8', '-iso-level', '2', '-udf', '-joliet', '-D', '-N', '-relaxed-filenames', '-boot-info-table', '-v', extractDir]);
  }

  /**
   * This method cleans up the temporary directory used for ISO extraction.
   * It uses the fsPromises.rm method to delete the directory and all its contents.
   * @param {string} extractDir - The directory to be cleaned up.
   * @returns {Promise<void>}
   */
  protected async cleanup(extractDir: string): Promise<void> {
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
  protected executeCommand(commandParts: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`Executing command: `, commandParts[0], commandParts.slice(1));
        const process = spawn(commandParts[0], commandParts.slice(1));

        process.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        process.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        process.on('close', (code) => {
            if (code === 0) {
                console.log(`Command executed successfully: ${commandParts.join(' ')}`);
                resolve();
            } else {
                console.error(`Command failed with exit code ${code}: ${commandParts.join(' ')}`);
                reject(new Error(`Command failed with exit code ${code}`));
            }
        });

        process.on('error', (error) => {
            console.error(`Error occurred while executing command: ${commandParts.join(' ')}`);
            reject(error);
        });
    });
  }
}