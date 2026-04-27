"use strict";
/**
 * Unit tests for CreateMachineServiceV2.
 *
 * This service has many internal dependencies (fs, portfinder, systeminformation,
 * infinization, unattended managers, DepartmentNetworkService), so we use
 * jest.mock() extensively to isolate the logic.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const CreateMachineServiceV2_1 = require("../../../app/services/CreateMachineServiceV2");
const jest_mock_extended_1 = require("jest-mock-extended");
// ─── Mocks ──────────────────────────────────────────────────────────────────
const mockInfinization = {
    createVM: jest.fn(),
    getVMStatus: jest.fn(),
    stopVM: jest.fn(),
};
jest.mock('../../../app/services/InfinizationService', () => ({
    getInfinization: jest.fn(() => Promise.resolve(mockInfinization)),
}));
jest.mock('../../../app/services/network/DepartmentNetworkService', () => ({
    DepartmentNetworkService: jest.fn().mockImplementation(() => ({
        getBridgeForDepartment: jest.fn().mockResolvedValue('br-test'),
    })),
}));
jest.mock('fs', () => (Object.assign(Object.assign({}, jest.requireActual('fs')), { existsSync: jest.fn().mockReturnValue(false), readdirSync: jest.fn().mockReturnValue([]) })));
jest.mock('portfinder', () => ({
    basePort: 5900,
    getPortPromise: jest.fn().mockResolvedValue(5900),
}));
jest.mock('systeminformation', () => ({
    graphics: jest.fn().mockResolvedValue({ controllers: [] }),
}));
jest.mock('../../../app/services/unattendedWindowsManager', () => ({
    UnattendedWindowsManager: jest.fn().mockImplementation(() => ({
        isoPath: '',
        init: jest.fn(),
        generateNewImage: jest.fn().mockResolvedValue('/tmp/test-unattended.iso'),
    })),
}));
jest.mock('../../../app/services/unattendedUbuntuManager', () => ({
    UnattendedUbuntuManager: jest.fn().mockImplementation(() => ({
        isoPath: '',
        generateNewImage: jest.fn().mockResolvedValue('/tmp/test-unattended.iso'),
    })),
}));
jest.mock('../../../app/services/unattendedRedHatManager', () => ({
    UnattendedRedHatManager: jest.fn().mockImplementation(() => ({
        isoPath: '',
        generateNewImage: jest.fn().mockResolvedValue('/tmp/test-unattended.iso'),
    })),
}));
jest.mock('../../../app/services/unattendedManagerBase', () => ({
    UnattendedManagerBase: jest.fn().mockImplementation(() => ({})),
}));
// ─── Helpers ────────────────────────────────────────────────────────────────
function makeMachine(overrides) {
    return Object.assign({ id: 'vm-1', name: 'TestVM', internalName: 'vm-test-1', status: 'stopped', userId: null, templateId: 'tpl-1', os: 'ubuntu-22.04', cpuCores: 4, ramGB: 8, diskSizeGB: 100, gpuPciAddress: null, createdAt: new Date(), updatedAt: new Date(), departmentId: 'dept-1', localIP: null, publicIP: null, firewallRuleSetId: null, version: 1 }, overrides);
}
function makeTemplate() {
    return {
        id: 'tpl-1',
        name: 'Ubuntu Template',
        os: 'ubuntu-22.04',
        cores: 4,
        ram: 8,
        storage: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
        departmentId: 'dept-1',
        categoryId: null,
        description: 'Test template',
        icon: null,
    };
}
function makeConfiguration() {
    return {
        id: 'cfg-1',
        machineId: 'vm-1',
        xml: { domain: { name: 'test-vm' } },
        graphicProtocol: null,
        graphicPort: null,
        graphicPassword: null,
        graphicHost: null,
        assignedGpuBus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        qmpSocketPath: null,
        qemuPid: null,
        tapDeviceName: null,
        bridge: 'virbr0',
        networkModel: 'virtio-net-pci',
        networkQueues: 1,
        machineType: 'q35',
        cpuModel: 'host',
        diskBus: 'virtio',
        diskCacheMode: 'writeback',
        ioThreads: false,
        diskPaths: null,
        gpuRomFile: null,
        gpuAudioBus: null,
        memoryBalloon: false,
        hugepages: false,
        numaConfig: null,
        cpuPinning: null,
        enableNumaCtlPinning: false,
        cpuPinningStrategy: 'basic',
        uefiFirmware: null,
        secureboot: false,
        tpmSocketPath: null,
        guestAgentSocketPath: null,
        infiniServiceSocketPath: null,
        virtioDriversIso: null,
        enableAudio: false,
        enableUsbTablet: true,
        setupComplete: false,
    };
}
function makeCreateResult() {
    return {
        success: true,
        vmId: 'vm-1',
        displayPort: 5900,
        displayPassword: undefined,
        diskPaths: ['/var/lib/infinibay/disks/vm-1-disk0.qcow2'],
        tapDevice: 'tap0',
        pid: 12345,
        qmpSocketPath: '/opt/infinibay/sockets/vm-test-1-qmp.sock',
    };
}
// ─── Test Suite ─────────────────────────────────────────────────────────────
describe('CreateMachineServiceV2', () => {
    let service;
    let mockPrisma;
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        service = new CreateMachineServiceV2_1.CreateMachineServiceV2(mockPrisma);
    });
    // ─── validatePreconditions (via create) ────────────────────────────────
    describe('validatePreconditions', () => {
        it('throws if machine has no department assigned', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = makeMachine({ departmentId: null });
            yield expect(service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York')).rejects.toThrow('has no department assigned');
        }));
    });
    // ─── fetchMachineTemplate (via create) ─────────────────────────────────
    describe('fetchMachineTemplate', () => {
        it('throws if template not found in database', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = makeMachine();
            mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);
            mockPrisma.machineConfiguration.findUnique.mockResolvedValue(makeConfiguration());
            mockPrisma.machineApplication.findMany.mockResolvedValue([]);
            mockPrisma.scriptExecution.findMany.mockResolvedValue([]);
            yield expect(service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York')).rejects.toThrow('Template not found');
        }));
    });
    describe('fetchMachineConfiguration', () => {
        it('throws if configuration not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = makeMachine();
            mockPrisma.machineTemplate.findUnique.mockResolvedValue(makeTemplate());
            mockPrisma.machineConfiguration.findUnique.mockResolvedValue(null);
            yield expect(service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York')).rejects.toThrow('Configuration not found');
        }));
    });
    // ─── full create flow ──────────────────────────────────────────────────
    describe('create - success', () => {
        it('creates a VM successfully with all steps', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = makeMachine();
            const template = makeTemplate();
            const config = makeConfiguration();
            mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
            mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config);
            mockPrisma.machineApplication.findMany.mockResolvedValue([]);
            mockPrisma.scriptExecution.findMany.mockResolvedValue([]);
            mockPrisma.machine.update.mockResolvedValue(machine);
            mockPrisma.machineConfiguration.update.mockResolvedValue(config);
            mockInfinization.createVM.mockResolvedValue(makeCreateResult());
            const result = yield service.create(machine, 'admin', 'password123', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York');
            expect(result).toBe(true);
            // Verify status was set to 'building'
            expect(mockPrisma.machine.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'vm-1' },
                data: { status: 'building' },
            }));
            // Verify infinization was called
            expect(mockInfinization.createVM).toHaveBeenCalledWith(expect.objectContaining({
                vmId: 'vm-1',
                name: 'TestVM',
                os: 'ubuntu-22.04',
            }));
            // Verify machine configuration was updated with runtime values
            expect(mockPrisma.machineConfiguration.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { machineId: 'vm-1' },
                data: expect.objectContaining({
                    graphicPort: 5900,
                    qemuPid: 12345,
                    tapDeviceName: 'tap0',
                }),
            }));
        }));
        it('creates VM without template (uses machine specs)', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = makeMachine({ templateId: null });
            const config = makeConfiguration();
            mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config);
            mockPrisma.machineApplication.findMany.mockResolvedValue([]);
            mockPrisma.scriptExecution.findMany.mockResolvedValue([]);
            mockPrisma.machine.update.mockResolvedValue(machine);
            mockPrisma.machineConfiguration.update.mockResolvedValue(config);
            mockInfinization.createVM.mockResolvedValue(makeCreateResult());
            const result = yield service.create(machine, 'admin', 'password123', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York');
            expect(result).toBe(true);
            // Template should not be fetched if templateId is null
            expect(mockPrisma.machineTemplate.findUnique).not.toHaveBeenCalled();
        }));
    });
    // ─── create - failure and rollback ─────────────────────────────────────
    describe('create - failure', () => {
        it('rolls back and throws on infinization failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = makeMachine();
            const config = makeConfiguration();
            mockPrisma.machineTemplate.findUnique.mockResolvedValue(makeTemplate());
            mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config);
            mockPrisma.machineApplication.findMany.mockResolvedValue([]);
            mockPrisma.scriptExecution.findMany.mockResolvedValue([]);
            mockPrisma.machine.update.mockResolvedValue(machine);
            mockInfinization.createVM.mockResolvedValue({
                success: false,
                vmId: 'vm-1',
                displayPort: 0,
                diskPaths: [],
                tapDevice: '',
                pid: 0,
                qmpSocketPath: '',
            });
            mockInfinization.getVMStatus.mockResolvedValue({ processAlive: false });
            yield expect(service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York')).rejects.toThrow('Error creating machine');
            // Verify rollback: status should be set to 'error'
            const updateCalls = mockPrisma.machine.update.mock.calls;
            const errorUpdate = updateCalls.find((c) => { var _a, _b; return ((_b = (_a = c[0]) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.status) === 'error'; });
            expect(errorUpdate).toBeDefined();
        }));
        it('rolls back VM if it was started before failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = makeMachine();
            const config = makeConfiguration();
            mockPrisma.machineTemplate.findUnique.mockResolvedValue(makeTemplate());
            mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config);
            mockPrisma.machineApplication.findMany.mockResolvedValue([]);
            mockPrisma.scriptExecution.findMany.mockResolvedValue([]);
            mockPrisma.machine.update.mockResolvedValue(machine);
            // Make createVM throw (simulating a mid-creation error)
            mockInfinization.createVM.mockRejectedValue(new Error('QEMU crashed'));
            // For rollback, VM is alive and should be stopped
            mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true });
            mockInfinization.stopVM.mockResolvedValue(undefined);
            mockPrisma.machineConfiguration.update.mockResolvedValue(config);
            yield expect(service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York')).rejects.toThrow('Error creating machine');
            expect(mockInfinization.stopVM).toHaveBeenCalledWith('vm-1', { force: true });
        }));
    });
    // ─── getGraphicsInfo ───────────────────────────────────────────────────
    describe('getGraphicsInfo', () => {
        it('returns filtered GPU controllers from allowed vendors', () => __awaiter(void 0, void 0, void 0, function* () {
            const si = require('systeminformation');
            si.graphics.mockResolvedValue({
                controllers: [
                    { vendor: 'NVIDIA Corporation', name: 'RTX 3080' },
                    { vendor: 'Intel Corporation', name: 'UHD 630' },
                    { vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]', name: 'RX 6800' },
                ],
            });
            const result = yield service.getGraphicsInfo();
            expect(result).toHaveLength(2);
            expect(result[0].vendor).toBe('NVIDIA Corporation');
            expect(result[1].vendor).toBe('Advanced Micro Devices, Inc. [AMD/ATI]');
        }));
        it('returns empty array on error', () => __awaiter(void 0, void 0, void 0, function* () {
            const si = require('systeminformation');
            si.graphics.mockRejectedValue(new Error('No GPU info'));
            const result = yield service.getGraphicsInfo();
            expect(result).toEqual([]);
        }));
    });
});
