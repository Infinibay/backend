// Mock CpuPinning for testing

export class HybridRandom {
  constructor() {}
  
  calculate(): any {
    return { vcpus: [], hostCpus: [] }
  }
}

export class BasicStrategy {
  constructor() {}
  
  calculate(): any {
    return { vcpus: [], hostCpus: [] }
  }
}

export class BasePinningStrategy {
  constructor() {}
  
  calculate(): any {
    return { vcpus: [], hostCpus: [] }
  }
}
