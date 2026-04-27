"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
// @ts-nocheck
require("reflect-metadata");
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const events_1 = require("events");
const VirtioSocketWatcherService_1 = require("../../../app/services/VirtioSocketWatcherService");
const jest_setup_1 = require("../../setup/jest.setup");
const mockWatcher = new events_1.EventEmitter();
mockWatcher.close = jest.fn().mockResolvedValue(undefined);
jest.mock('chokidar', () => ({
    watch: jest.fn(() => mockWatcher)
}));
// Mock fs
jest.mock('fs', () => (Object.assign(Object.assign({}, jest.requireActual('fs')), { promises: {
        mkdir: jest.fn().mockResolvedValue(undefined),
        unlink: jest.fn().mockResolvedValue(undefined),
        readdir: jest.fn().mockResolvedValue([]) // Default to empty directory
    }, access: jest.fn((path, mode, cb) => cb(null)), existsSync: jest.fn().mockReturnValue(true) })));
// Mock net.Socket
class MockSocket extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.connect = jest.fn().mockImplementation(() => {
            // Simulate async connection success
            process.nextTick(() => this.emit('connect'));
        });
        this.write = jest.fn().mockReturnValue(true);
        this.destroy = jest.fn();
        this.setTimeout = jest.fn();
        this.removeAllListeners = jest.fn(() => {
            super.removeAllListeners();
            return this;
        });
    }
}
jest.mock('net', () => ({
    Socket: jest.fn(() => new MockSocket())
}));
describe('VirtioSocketWatcherService', () => {
    let service;
    let mockSocket;
    const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay';
    const socketsDir = path.join(baseDir, 'sockets');
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        jest.clearAllMocks();
        // Stop the previous service if it was running
        if (service) {
            try {
                yield service.stop();
            }
            catch (e) { /* ignore */ }
        }
        // Create a fresh instance directly (bypass singleton)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service = new VirtioSocketWatcherService_1.VirtioSocketWatcherService(jest_setup_1.mockPrisma);
        // Get the mock socket instance
        mockSocket = new MockSocket();
        net.Socket.mockImplementation(() => mockSocket);
    }));
    describe('Service Lifecycle', () => {
        it('should start the service successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            expect(fs.promises.mkdir).toHaveBeenCalledWith(expect.stringContaining('sockets'), { recursive: true });
            const chokidar = require('chokidar');
            expect(chokidar.watch).toHaveBeenCalledWith(expect.stringContaining('sockets'), expect.objectContaining({
                persistent: true,
                ignoreInitial: false
            }));
        }));
        it('should stop the service and clean up connections', () => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            // Simulate a socket connection
            const socketPath = path.join(socketsDir, 'test-vm.socket');
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: 'test-vm',
                name: 'Test VM',
                status: 'running'
            });
            mockWatcher.emit('add', socketPath);
            yield new Promise(resolve => setTimeout(resolve, 100));
            yield service.stop();
            expect(mockWatcher.close).toHaveBeenCalled();
            expect(mockSocket.destroy).toHaveBeenCalled();
        }));
        it('should not start if already running', () => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            yield service.start();
            const chokidar = require('chokidar');
            expect(chokidar.watch).toHaveBeenCalledTimes(1);
        }));
    });
    describe('Socket Connection Management', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
        }));
        it('should connect to VM when socket file is added', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm-123';
            const socketPath = path.join(socketsDir, `${vmId}.socket`);
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: vmId,
                name: 'Test VM',
                status: 'running'
            });
            mockWatcher.emit('add', socketPath);
            yield new Promise(resolve => setTimeout(resolve, 100));
            expect(jest_setup_1.mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: vmId },
                select: { id: true, name: true, status: true }
            });
            expect(mockSocket.connect).toHaveBeenCalledWith(socketPath);
        }));
        it('should ignore non-socket files', () => __awaiter(void 0, void 0, void 0, function* () {
            const filePath = path.join(socketsDir, 'random.txt');
            mockWatcher.emit('add', filePath);
            yield new Promise(resolve => setTimeout(resolve, 100));
            expect(jest_setup_1.mockPrisma.machine.findUnique).not.toHaveBeenCalled();
            expect(mockSocket.connect).not.toHaveBeenCalled();
        }));
        it('should not connect if VM does not exist in database', () => __awaiter(void 0, void 0, void 0, function* () {
            const socketPath = path.join(socketsDir, 'unknown-vm.socket');
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null);
            mockWatcher.emit('add', socketPath);
            yield new Promise(resolve => setTimeout(resolve, 100));
            expect(mockSocket.connect).not.toHaveBeenCalled();
        }));
        it('should close connection when socket file is removed', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm';
            const socketPath = path.join(socketsDir, `${vmId}.socket`);
            // First connect
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: vmId,
                name: 'Test VM',
                status: 'running'
            });
            mockWatcher.emit('add', socketPath);
            yield new Promise(resolve => setTimeout(resolve, 100));
            // Then remove
            mockWatcher.emit('unlink', socketPath);
            yield new Promise(resolve => setTimeout(resolve, 100));
            expect(mockSocket.destroy).toHaveBeenCalled();
        }));
    });
    describe('Message Processing', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            // Setup a connected VM
            const vmId = 'test-vm';
            const socketPath = path.join(socketsDir, `${vmId}.socket`);
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: vmId,
                name: 'Test VM',
                status: 'running'
            });
            mockWatcher.emit('add', socketPath);
            yield new Promise(resolve => setTimeout(resolve, 100));
            mockSocket.emit('connect');
        }));
        it('should process incoming ping messages', () => __awaiter(void 0, void 0, void 0, function* () {
            const pingMessage = JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }) + '\n';
            mockSocket.emit('data', Buffer.from(pingMessage));
            yield new Promise(resolve => setTimeout(resolve, 100));
            // Service doesn't implement ping/pong - it just updates lastMessageTime
            const connectionDetails = service.getConnectionDetails('test-vm');
            expect(connectionDetails).toBeDefined();
            expect(connectionDetails === null || connectionDetails === void 0 ? void 0 : connectionDetails.isConnected).toBe(true);
        }));
        it('should store metrics in database', () => __awaiter(void 0, void 0, void 0, function* () {
            const metricsMessage = {
                type: 'metrics',
                timestamp: new Date().toISOString(),
                data: {
                    system: {
                        cpu: {
                            usage_percent: 45.5,
                            cores_usage: [50, 40, 45, 42],
                            temperature: 65
                        },
                        memory: {
                            total_kb: 8388608,
                            used_kb: 4194304,
                            available_kb: 4194304,
                            swap_total_kb: 2097152,
                            swap_used_kb: 0
                        },
                        disk: {
                            usage_stats: [
                                {
                                    mount_point: '/',
                                    total_gb: 100,
                                    used_gb: 50,
                                    available_gb: 50
                                }
                            ],
                            io_stats: {
                                read_bytes_per_sec: 1024,
                                write_bytes_per_sec: 2048,
                                read_ops_per_sec: 10,
                                write_ops_per_sec: 20
                            }
                        },
                        network: {
                            interfaces: [
                                {
                                    name: 'eth0',
                                    bytes_received: 1000000,
                                    bytes_sent: 500000,
                                    packets_received: 1000,
                                    packets_sent: 500
                                }
                            ]
                        },
                        uptime_seconds: 3600,
                        load_average: {
                            load_1min: 1.5,
                            load_5min: 1.2,
                            load_15min: 1.0
                        }
                    }
                }
            };
            jest_setup_1.mockPrisma.systemMetrics.create.mockResolvedValue({
                id: 'metrics-1',
                machineId: 'test-vm',
                cpuUsagePercent: 45.5,
                cpuCoresUsage: [50, 40, 45, 42],
                cpuTemperature: 65,
                totalMemoryKB: BigInt(8388608),
                usedMemoryKB: BigInt(4194304),
                availableMemoryKB: BigInt(4194304),
                swapTotalKB: BigInt(2097152),
                swapUsedKB: BigInt(0),
                diskUsageStats: metricsMessage.data.system.disk.usage_stats,
                diskIOStats: metricsMessage.data.system.disk.io_stats,
                networkStats: metricsMessage.data.system.network.interfaces,
                uptime: BigInt(3600),
                loadAverage: metricsMessage.data.system.load_average,
                timestamp: new Date()
            });
            mockSocket.emit('data', Buffer.from(JSON.stringify(metricsMessage) + '\n'));
            yield new Promise(resolve => setTimeout(resolve, 100));
            expect(jest_setup_1.mockPrisma.systemMetrics.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    machineId: 'test-vm',
                    cpuUsagePercent: 45.5
                })
            }));
        }));
        it('should handle malformed JSON gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const badMessage = 'not valid json\n';
            // Should not throw
            expect(() => {
                mockSocket.emit('data', Buffer.from(badMessage));
            }).not.toThrow();
        }));
        it('should handle partial messages and buffer them', () => __awaiter(void 0, void 0, void 0, function* () {
            const metricsMessage = {
                type: 'metrics',
                timestamp: new Date().toISOString(),
                data: {
                    system: {
                        cpu: { usage_percent: 50, cores_usage: [], temperature: 60 },
                        memory: { total_kb: 8000000, used_kb: 4000000, available_kb: 4000000 },
                        disk: {
                            usage_stats: [],
                            io_stats: { read_bytes_per_sec: 0, write_bytes_per_sec: 0, read_ops_per_sec: 0, write_ops_per_sec: 0 }
                        },
                        network: { interfaces: [] },
                        uptime_seconds: 1000
                    }
                }
            };
            const fullMessage = JSON.stringify(metricsMessage) + '\n';
            const part1 = fullMessage.slice(0, 20);
            const part2 = fullMessage.slice(20);
            // Clear any previous database calls
            jest_setup_1.mockPrisma.systemMetrics.create.mockClear();
            mockSocket.emit('data', Buffer.from(part1));
            // Message not complete yet, should not process
            yield new Promise(resolve => setTimeout(resolve, 50));
            expect(jest_setup_1.mockPrisma.systemMetrics.create).not.toHaveBeenCalled();
            mockSocket.emit('data', Buffer.from(part2));
            yield new Promise(resolve => setTimeout(resolve, 100));
            // Now message is complete, should be processed
            expect(jest_setup_1.mockPrisma.systemMetrics.create).toHaveBeenCalled();
        }));
    });
    describe('Reconnection Logic', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            jest.useFakeTimers();
        }));
        afterEach(() => {
            jest.useRealTimers();
        });
        it('should attempt reconnection on socket error', () => __awaiter(void 0, void 0, void 0, function* () {
            // Stop any existing service before this test
            if (service && service.getServiceStatus()) {
                yield service.stop();
            }
            // Create a fresh service and socket for this test
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            service = (0, VirtioSocketWatcherService_1.createVirtioSocketWatcherService)(jest_setup_1.mockPrisma);
            const freshSocket = new MockSocket();
            net.Socket.mockImplementation(() => freshSocket);
            yield service.start();
            const vmId = 'test-vm';
            const socketPath = path.join(socketsDir, `${vmId}.socket`);
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: vmId,
                name: 'Test VM',
                status: 'running'
            });
            mockWatcher.emit('add', socketPath);
            yield Promise.resolve();
            // Initial connection attempt(s)
            expect(freshSocket.connect).toHaveBeenCalled();
            // Simulate connection error
            freshSocket.emit('error', new Error('Connection failed'));
            fs.access.mockImplementation((path, callback) => {
                if (callback)
                    callback(null);
            });
            // Fast-forward time to trigger reconnection (base delay is 1000ms)
            jest.advanceTimersByTime(2000);
            yield Promise.resolve();
            // Should have attempted reconnection
            expect(freshSocket.connect.mock.calls.length).toBeGreaterThanOrEqual(2);
        }));
    });
    describe('Health Monitoring', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            jest.useFakeTimers();
        }));
        afterEach(() => {
            jest.useRealTimers();
        });
        it('should monitor connection health without active pinging', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm';
            const socketPath = path.join(socketsDir, `${vmId}.socket`);
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: vmId,
                name: 'Test VM',
                status: 'running'
            });
            mockWatcher.emit('add', socketPath);
            yield Promise.resolve();
            mockSocket.emit('connect');
            // Service monitors connections but doesn't actively ping
            // It relies on incoming messages to detect stale connections
            const connectionDetails = service.getConnectionDetails(vmId);
            expect(connectionDetails).toBeDefined();
            expect(connectionDetails === null || connectionDetails === void 0 ? void 0 : connectionDetails.isConnected).toBe(true);
            // Fast-forward past the timeout threshold (70 seconds)
            // The service keeps connections open even when stale (no auto-disconnect)
            // It has a 5 minute grace period after connection and does NOT destroy
            // connections due to message timeout (by design - waits for VM)
            jest.advanceTimersByTime(70000);
            // Connection should remain open - the service intentionally keeps stale connections
            expect(connectionDetails === null || connectionDetails === void 0 ? void 0 : connectionDetails.isConnected).toBe(true);
        }));
    });
    describe('Statistics and Monitoring', () => {
        it('should return correct connection statistics', () => __awaiter(void 0, void 0, void 0, function* () {
            // Stop any existing service and create fresh one
            if (service && service.getServiceStatus()) {
                yield service.stop();
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            service = (0, VirtioSocketWatcherService_1.createVirtioSocketWatcherService)(jest_setup_1.mockPrisma);
            service = (0, VirtioSocketWatcherService_1.createVirtioSocketWatcherService)(jest_setup_1.mockPrisma);
            // Add two VMs
            const vm1 = { id: 'vm-1', name: 'VM 1', status: 'running' };
            const vm2 = { id: 'vm-2', name: 'VM 2', status: 'running' };
            jest_setup_1.mockPrisma.machine.findUnique
                .mockResolvedValueOnce(vm1)
                .mockResolvedValueOnce(vm2);
            // Create two different socket mocks
            const socket1 = new MockSocket();
            const socket2 = new MockSocket();
            let callCount = 0;
            net.Socket.mockImplementation(() => {
                callCount++;
                return (callCount === 1 ? socket1 : socket2);
            });
            yield service.start();
            mockWatcher.emit('add', path.join(socketsDir, 'vm-1.socket'));
            yield new Promise(resolve => setTimeout(resolve, 100));
            mockWatcher.emit('add', path.join(socketsDir, 'vm-2.socket'));
            yield new Promise(resolve => setTimeout(resolve, 100));
            // Connect first VM
            socket1.emit('connect');
            yield new Promise(resolve => setTimeout(resolve, 100));
            const stats = service.getConnectionStats();
            expect(stats.totalConnections).toBeGreaterThanOrEqual(1);
            expect(stats.activeConnections).toBeGreaterThanOrEqual(0);
            expect(stats.connections.length).toBeGreaterThanOrEqual(1);
        }));
    });
    describe('VM Cleanup', () => {
        it('should cleanup VM connection and socket file', () => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            const vmId = 'test-vm';
            const socketPath = path.join(socketsDir, `${vmId}.socket`);
            // Setup connection
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: vmId,
                name: 'Test VM',
                status: 'running'
            });
            mockWatcher.emit('add', socketPath);
            yield new Promise(resolve => setTimeout(resolve, 100));
            // Cleanup
            yield service.cleanupVmConnection(vmId);
            expect(mockSocket.destroy).toHaveBeenCalled();
            expect(fs.promises.unlink).toHaveBeenCalledWith(socketPath);
        }));
        it('should handle cleanup when socket file does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            fs.promises.unlink.mockRejectedValue({ code: 'ENOENT' });
            // Should not throw
            yield expect(service.cleanupVmConnection('non-existent-vm')).resolves.not.toThrow();
        }));
    });
    describe('Stale Socket Cleanup', () => {
        it('should remove stale sockets for VMs that do not exist on startup', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock readdir to return socket files
            const mockReaddir = fs.promises.readdir;
            mockReaddir.mockResolvedValue(['orphan-vm.socket', 'running-vm.socket', 'random.txt']);
            // Mock database lookup: orphan-vm doesn't exist, running-vm exists and is running
            jest_setup_1.mockPrisma.machine.findUnique
                .mockResolvedValueOnce(null) // orphan-vm doesn't exist
                .mockResolvedValueOnce({ id: 'running-vm', status: 'running' }); // running-vm exists
            yield service.start();
            // Should have tried to delete the orphan socket
            expect(fs.promises.unlink).toHaveBeenCalledWith(expect.stringContaining('orphan-vm.socket'));
            // Should NOT have tried to delete the running VM's socket
            expect(fs.promises.unlink).not.toHaveBeenCalledWith(expect.stringContaining('running-vm.socket'));
        }));
        it('should remove stale sockets for VMs that exist but are not running', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockReaddir = fs.promises.readdir;
            mockReaddir.mockResolvedValue(['stopped-vm.socket']);
            // Mock database lookup: VM exists but is stopped
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: 'stopped-vm',
                status: 'off'
            });
            yield service.start();
            // Should have tried to delete the stopped VM's socket
            expect(fs.promises.unlink).toHaveBeenCalledWith(expect.stringContaining('stopped-vm.socket'));
        }));
        it('should keep sockets for running VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockReaddir = fs.promises.readdir;
            mockReaddir.mockResolvedValue(['running-vm.socket']);
            fs.promises.unlink.mockClear();
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: 'running-vm',
                status: 'running'
            });
            yield service.start();
            // Should NOT have tried to delete the running VM's socket
            expect(fs.promises.unlink).not.toHaveBeenCalledWith(expect.stringContaining('running-vm.socket'));
        }));
        it('should silently ignore ENOENT errors during cleanup', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockReaddir = fs.promises.readdir;
            mockReaddir.mockResolvedValue(['disappearing-vm.socket']);
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null) // VM doesn't exist
            ;
            fs.promises.unlink.mockRejectedValue({ code: 'ENOENT' });
            // Should not throw
            yield expect(service.start()).resolves.not.toThrow();
        }));
        it('should ignore non-.socket files during cleanup', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockReaddir = fs.promises.readdir;
            mockReaddir.mockResolvedValue(['some-file.txt', 'another.sock', 'config.json']);
            // Reset mocks
            jest_setup_1.mockPrisma.machine.findUnique.mockClear();
            fs.promises.unlink.mockClear();
            yield service.start();
            // Should NOT have queried database for non-.socket files
            expect(jest_setup_1.mockPrisma.machine.findUnique).not.toHaveBeenCalled();
            // Should NOT have tried to delete any files
            expect(fs.promises.unlink).not.toHaveBeenCalled();
        }));
    });
    describe('Command Execution', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield service.start();
            // Setup VM in database
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue({
                id: 'test-vm',
                name: 'Test VM',
                status: 'running'
            });
            mockWatcher.emit('add', path.join(socketsDir, 'test-vm.socket'));
            yield new Promise(resolve => setTimeout(resolve, 100));
            mockSocket.emit('connect');
            yield new Promise(resolve => setTimeout(resolve, 100));
        }));
        describe('Safe Command Format Tests', () => {
            it('should send SafeCommand with correct flattened format structure', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', {
                    action: 'ServiceList',
                    params: undefined
                });
                // Wait for command to be sent
                yield new Promise(resolve => setTimeout(resolve, 50));
                // Verify command was sent with correct structure
                expect(mockSocket.write).toHaveBeenCalled();
                // Extract and parse the sent message
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                // Verify the exact structure matches InfiniService serde expectations
                expect(commandData).toMatchObject({
                    type: 'SafeCommand',
                    id: expect.any(String),
                    command_type: {
                        action: 'ServiceList'
                    },
                    params: null,
                    timeout: expect.any(Number)
                });
                // Should NOT have nested SafeCommand property
                expect(commandData.SafeCommand).toBeUndefined();
                const commandId = commandData.id;
                // Simulate response from VM
                const response = {
                    type: 'response',
                    id: commandId,
                    success: true,
                    exit_code: 0,
                    stdout: 'Service list output',
                    stderr: '',
                    execution_time_ms: 150,
                    command_type: 'safe',
                    data: [
                        { name: 'nginx', status: 'running' },
                        { name: 'mysql', status: 'stopped' }
                    ]
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                const result = yield commandPromise;
                expect(result).toMatchObject({
                    id: commandId,
                    success: true,
                    exit_code: 0,
                    stdout: 'Service list output',
                    execution_time_ms: 150,
                    command_type: 'safe'
                });
            }));
            it('should send PackageSearch command with correct flattened structure', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', {
                    action: 'PackageSearch',
                    params: { query: 'slack' }
                });
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                expect(commandData).toMatchObject({
                    type: 'SafeCommand',
                    id: expect.any(String),
                    command_type: {
                        action: 'PackageSearch',
                        query: 'slack'
                    },
                    params: null,
                    timeout: expect.any(Number)
                });
                // Complete the command to prevent hanging
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    data: []
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
            it('should send PackageInstall command with package parameter', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', {
                    action: 'PackageInstall',
                    params: { package: 'vim' }
                });
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                expect(commandData).toMatchObject({
                    type: 'SafeCommand',
                    id: expect.any(String),
                    command_type: {
                        action: 'PackageInstall',
                        package: 'vim'
                    },
                    params: null,
                    timeout: expect.any(Number)
                });
                // Complete the command
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    data: []
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
            it('should send ProcessList command with limit parameter', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', {
                    action: 'ProcessList',
                    params: { limit: 10 }
                });
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                expect(commandData).toMatchObject({
                    type: 'SafeCommand',
                    id: expect.any(String),
                    command_type: {
                        action: 'ProcessList',
                        limit: 10
                    },
                    params: null,
                    timeout: expect.any(Number)
                });
                // Complete the command
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    data: []
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
            it('should send ProcessKill command with pid and force parameters', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', {
                    action: 'ProcessKill',
                    params: { pid: 1234, force: true }
                });
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                expect(commandData).toMatchObject({
                    type: 'SafeCommand',
                    id: expect.any(String),
                    command_type: {
                        action: 'ProcessKill',
                        pid: 1234,
                        force: true
                    },
                    params: null,
                    timeout: expect.any(Number)
                });
                // Complete the command
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    data: []
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
            it('should send ExecutePowerShellScript command with all parameters', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', {
                    action: 'ExecutePowerShellScript',
                    params: {
                        script: 'Write-Host "Hello World"',
                        script_type: 'inline',
                        timeout_seconds: 300,
                        working_directory: 'C:\\Scripts',
                        environment_vars: { VAR1: 'value1', VAR2: 'value2' },
                        run_as_admin: true
                    }
                });
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                expect(commandData).toMatchObject({
                    type: 'SafeCommand',
                    id: expect.any(String),
                    command_type: {
                        action: 'ExecutePowerShellScript',
                        script: 'Write-Host "Hello World"',
                        script_type: 'inline',
                        timeout_seconds: 300,
                        working_directory: 'C:\\Scripts',
                        environment_vars: { VAR1: 'value1', VAR2: 'value2' },
                        run_as_admin: true
                    },
                    params: null,
                    timeout: expect.any(Number)
                });
                // Complete the command
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    exit_code: 0,
                    stdout: 'Hello World',
                    stderr: ''
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
            it('should send ExecutePowerShellScript with minimal parameters', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', {
                    action: 'ExecutePowerShellScript',
                    params: {
                        script: 'Get-Date'
                    }
                });
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                expect(commandData.command_type).toMatchObject({
                    action: 'ExecutePowerShellScript',
                    script: 'Get-Date',
                    script_type: 'inline', // Default value
                    run_as_admin: false // Default value
                });
                // Optional fields should be omitted (undefined)
                expect(commandData.command_type.timeout_seconds).toBeUndefined();
                expect(commandData.command_type.working_directory).toBeUndefined();
                expect(commandData.command_type.environment_vars).toBeUndefined();
                // Complete the command
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    data: []
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
            it('should preserve timeout_seconds value of 0', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', {
                    action: 'ExecutePowerShellScript',
                    params: {
                        script: 'Test-Script',
                        timeout_seconds: 0 // Should be preserved, not converted to undefined
                    }
                });
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                // With ?? operator, 0 should be preserved
                expect(commandData.command_type.timeout_seconds).toBe(0);
                // Complete the command
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    data: []
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
        });
        describe('Unsafe Command Format Tests', () => {
            it('should send UnsafeCommand with correct flattened format structure', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendUnsafeCommand('test-vm', 'ls -la /tmp', {
                    shell: 'bash',
                    workingDir: '/home/user',
                    envVars: { TEST_VAR: 'value' }
                }, 5000);
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                // Verify the exact structure matches InfiniService serde expectations
                expect(commandData).toMatchObject({
                    type: 'UnsafeCommand',
                    id: expect.any(String),
                    raw_command: 'ls -la /tmp',
                    shell: 'bash',
                    timeout: 5, // Should be converted to seconds
                    working_dir: '/home/user',
                    env_vars: { TEST_VAR: 'value' }
                });
                // Should NOT have nested UnsafeCommand property
                expect(commandData.UnsafeCommand).toBeUndefined();
                // Simulate response
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    exit_code: 0,
                    stdout: 'file1.txt\nfile2.txt',
                    stderr: '',
                    execution_time_ms: 50,
                    command_type: 'unsafe'
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                const result = yield commandPromise;
                expect(result.success).toBe(true);
                expect(result.stdout).toContain('file1.txt');
            }));
            it('should send UnsafeCommand with minimal parameters', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendUnsafeCommand('test-vm', 'pwd');
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                // JSON serialization omits undefined values, so they won't be in the message
                expect(commandData).toMatchObject({
                    type: 'UnsafeCommand',
                    id: expect.any(String),
                    raw_command: 'pwd',
                    timeout: 30 // Default 30 seconds
                    // shell, working_dir, env_vars should be omitted when undefined
                });
                // Verify that undefined fields are not present in the serialized JSON
                expect(commandData.shell).toBeUndefined();
                expect(commandData.working_dir).toBeUndefined();
                expect(commandData.env_vars).toBeUndefined();
                // Complete the command
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    stdout: '/home/user',
                    data: []
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
            it('should convert timeout from milliseconds to seconds', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendUnsafeCommand('test-vm', 'sleep 1', {}, 45000);
                yield new Promise(resolve => setTimeout(resolve, 50));
                const sentMessage = mockSocket.write.mock.calls[0][0];
                const commandData = JSON.parse(sentMessage.replace('\n', ''));
                expect(commandData.timeout).toBe(45); // 45000ms = 45s
                // Complete the command
                const response = {
                    type: 'response',
                    id: commandData.id,
                    success: true,
                    data: []
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                yield commandPromise;
            }));
        });
        describe('Command Execution Edge Cases', () => {
            it('should handle command timeout', () => __awaiter(void 0, void 0, void 0, function* () {
                const commandPromise = service.sendSafeCommand('test-vm', { action: 'ServiceList' }, 1000 // 1 second timeout
                );
                // Don't send response, let it timeout
                yield expect(commandPromise).rejects.toThrow('Command timeout after 1000ms');
            }));
            it('should handle unknown command response', () => __awaiter(void 0, void 0, void 0, function* () {
                // Send response for non-existent command
                const response = {
                    type: 'response',
                    id: 'non-existent-id',
                    success: true,
                    stdout: 'output'
                };
                mockSocket.emit('data', Buffer.from(JSON.stringify(response) + '\n'));
                // Should log warning but not crash
                yield new Promise(resolve => setTimeout(resolve, 100));
                // No error should be thrown
            }));
        });
    });
});
