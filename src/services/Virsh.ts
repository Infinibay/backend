const { spawnSync } = require("child_process");

import {
  CreateVmOptions,
  CreateDiskOptions,
} from './VirshTypes';

import {
  OptionsGenerator
} from './virsh/OptionsGenerator';

export class Virsh {
  private static instance: Virsh;
  private constructor() {}
  public static getInstance(): Virsh {
    if (!Virsh.instance) {
      Virsh.instance = new Virsh();
    }
    return Virsh.instance;
  }
  // Basic create options
  public async createVm(opts: CreateVmOptions): Promise<void> {
    let options = new OptionsGenerator(opts)
    options.generate()
    console.log(options.results())
    if (options.errorMessages().length > 0) {
      throw new Error('Invalid options')
    }
    const {stdout, stderr, status} = spawnSync('virsh', options.results())
    if (status !== 0) {
      throw new Error(stderr.
        toString().
        split('\n').
        filter((line) => line.length > 0).
        join('.')
      )
    }
    console.log("VM created: ", stdout.toString())
  }

}