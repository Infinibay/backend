// Mock VirtManager module for testing
// This provides a mock implementation of VirtManager for tests

export const VirtManager = {
  getInstance: jest.fn(() => ({
    createMachine: jest.fn(),
    destroyMachine: jest.fn(),
    powerOn: jest.fn(),
    powerOff: jest.fn(),
    suspend: jest.fn(),
    getMachineInfo: jest.fn(),
    getMachineStats: jest.fn(),
    attachDevice: jest.fn(),
    detachDevice: jest.fn(),
    takeSnapshot: jest.fn(),
    revertSnapshot: jest.fn(),
    deleteSnapshot: jest.fn(),
    listSnapshots: jest.fn(),
    getMachineXML: jest.fn(),
    setAutostart: jest.fn()
  }))
}

export default VirtManager
