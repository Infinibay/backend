export interface CreateDiskOptions {
  size: number
  format: string
  path: string
}

export interface CreateVmOptions {
  name: string
  description: string
  ram: number
  vcpu: number
  disk: CreateDiskOptions
  cdrom: string
}

export const MAX_DISK_SIZE = 1000  // TODO: Use a seeting for this
export const MAX_RAM = 128 * 1024  // TODO: Use a seeting for this
export const MAX_VCPU = 32         // TODO: Use a seeting for this
export const VALID_DISK_FORMATS = ['qcow2', 'raw']  // TODO:  Add more formats