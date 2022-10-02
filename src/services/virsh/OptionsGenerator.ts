import fs from 'fs';

import {
  CreateVmOptions,
  CreateDiskOptions,
  MAX_DISK_SIZE,
  MAX_RAM,
  MAX_VCPU,
  VALID_DISK_FORMATS,
} from '../VirshTypes';

import {
  DiskOptionGenerator,
} from './DiskOptionGenerator';



export interface OptionError {
  field: string,
  message: string
}

export class OptionsGenerator {
  private options: CreateVmOptions;
  private errors: OptionError[] = [];
  private _results: string[] = undefined;

  public constructor(options: CreateVmOptions) {
    this.options = options;
  }

  public generate(): this {
    // raise exception if options are invalid
    if (!this.validate()) {
      throw new Error('Invalid options');
    }
    const cli = [];
    cli.push('--name', this.options.name);
    cli.push('--memory', this.options.ram.toString());
    cli.push('--vcpus', this.options.vcpu.toString());
    
    return this;
  }

  public results(): string[] | undefined {
    return this._results;
  }

  public errorMessages() : OptionError[] {
    return this.errors;
  }

  // Private methods
  private validate(): boolean {
    return this.validateName() &&
      this.validateRam() &&
      this.validateVcpu() &&
      this.validateDisk() &&
      this.validateCdrom();
  }

  // All validators
  private validateName(): boolean {
    if (this.options.name.length <= 2) {
      this.errors.push({
        field: 'name',
        message: 'name must be longer than 2 characters',
      });
      return false;
    }
    return true;
  }

  private validateRam(): boolean {
    if (this.options.ram < 1) {
      this.errors.push({
        field: 'ram',
        message: 'ram must be greater than 1',
      });
      return false;
    }
    if (this.options.ram > MAX_RAM) {
      this.errors.push({
        field: 'ram',
        message: `ram must be less than ${MAX_RAM}`,
      });
      return false;
    }
    return true;
  }

  private validateVcpu(): boolean {
    if (this.options.vcpu < 1) {
      this.errors.push({
        field: 'vcpu',
        message: 'vcpu must be greater than 1',
      });

      return false;
    }
    if (this.options.vcpu > MAX_VCPU) {
      this.errors.push({
        field: 'vcpu',
        message: `vcpu must be less than ${MAX_VCPU}`,
      });
      return false;
    }
    return true;
  }

  private validateDisk(): boolean {
    // Delegate the validation to DiskOptionGenerator
    const diskOptions = new DiskOptionGenerator(this.options.disk);
    diskOptions.generate();
    if (diskOptions.errorMessages().length > 0) { // if there are errors
      this.errors = this.errors.concat(diskOptions.errorMessages());
      return false;
    }
    return true;
  }

  private validateCdrom(): boolean {
    if (this.options.cdrom.length <= 6) {
      // 6 chars is /a.iso
      this.errors.push({
        field: 'cdrom',
        message: 'cdrom must be longer than 6 characters',
      });
      return false;
    }
    if (!this.options.cdrom.endsWith('.iso')) {
      this.errors.push({
        field: 'cdrom',
        message: 'cdrom must be an iso file',
      });
      return false;
    }
    if (!this.options.cdrom.startsWith('/')) {
      this.errors.push({
        field: 'cdrom',
        message: 'cdrom must be an absolute path',
      });
      return false;
    }
    if (!fs.existsSync(this.options.cdrom)) {
      this.errors.push({
        field: 'cdrom',
        message: 'cdrom must be a valid path to a file',
      });
      return false;
    }
    if (!fs.lstatSync(this.options.cdrom).isFile()) {
      this.errors.push({
        field: 'cdrom',
        message: 'cdrom must be a valid path to a file',
      });
      return false;
    }

    return true;
  }
}
