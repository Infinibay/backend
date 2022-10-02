import { 
  CreateDiskOptions, 
  MAX_DISK_SIZE, 
  VALID_DISK_FORMATS 
} from "../VirshTypes";

export interface OptionError {
  field: string,
  message: string
}
export class DiskOptionGenerator {
  private options: CreateDiskOptions;
  private _results: string[] = undefined;
  private errors: OptionError[] = [];

  constructor(options: CreateDiskOptions) {
    this.options = options;
  }

  public generate(): this {
    this.validate();
    if (this.errors.length > 0) {
      return this;
    }
    this._results = [];
    this._results.push('--disk', `size=${this.options.size}`);
    this._results.push('--disk', `format=${this.options.format}`);
    this._results.push('--disk', `path=${this.options.path}`);

    return this;
  }

  public results(): string[] | undefined {
    return this._results;
  }

  public errorMessages() : OptionError[] {
    return this.errors;
  }

  public validate(): boolean {
    
    return true;
  }

  private validateSize(): boolean {
    if (this.options.size < 1) {
      this.errors.push({
        field: 'size',
        message: 'size must be greater than 1',
      });
      return false;
    }
    if (this.options.size > MAX_DISK_SIZE) {
      this.errors.push({
        field: 'size',
        message: `size must be less than ${MAX_DISK_SIZE}`,
      });
      return false;
    }
    return true;
  }

  private validateFormat(): boolean {
    if (!VALID_DISK_FORMATS.includes(this.options.format)) {
      this.errors.push({
        field: 'format',
        message: `format must be one of ${VALID_DISK_FORMATS}`,
      });
      return false;
    }
    return true;
  }
}