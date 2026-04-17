// Mock GraphicPortService for testing

export class GraphicPortService {
  constructor() {}
  
  allocatePort(): Promise<number> {
    return Promise.resolve(5900)
  }
  
  releasePort(port: number): Promise<void> {
    return Promise.resolve()
  }
  
  getAllocatedPorts(): Promise<number[]> {
    return Promise.resolve([])
  }
}

export default GraphicPortService
