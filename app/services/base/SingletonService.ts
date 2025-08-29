import { BaseService, ServiceConfig } from './BaseService'

export abstract class SingletonService extends BaseService {
  private static instances = new Map<string, SingletonService>()

  protected constructor (config: ServiceConfig) {
    super(config)
  }

  static getInstance<T extends SingletonService> (
    this: new (config: ServiceConfig) => T,
    config: ServiceConfig
  ): T {
    const key = config.name

    if (!SingletonService.instances.has(key)) {
      SingletonService.instances.set(key, new this(config))
    }

    return SingletonService.instances.get(key) as T
  }

  static async destroyInstance (name: string): Promise<void> {
    const instance = SingletonService.instances.get(name)
    if (instance) {
      await instance.shutdown()
      SingletonService.instances.delete(name)
    }
  }

  static async destroyAll (): Promise<void> {
    const shutdownPromises = Array.from(SingletonService.instances.values())
      .map(instance => instance.shutdown())

    await Promise.all(shutdownPromises)
    SingletonService.instances.clear()
  }

  static getInstanceCount (): number {
    return SingletonService.instances.size
  }

  static hasInstance (name: string): boolean {
    return SingletonService.instances.has(name)
  }

  static getInstanceNames (): string[] {
    return Array.from(SingletonService.instances.keys())
  }
}
