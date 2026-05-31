"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateId = void 0;
exports.createMockUser = createMockUser;
exports.createMockAdminUser = createMockAdminUser;
exports.createMockDepartment = createMockDepartment;
exports.createMockMachineTemplateCategory = createMockMachineTemplateCategory;
exports.createMockMachineTemplate = createMockMachineTemplate;
exports.createMockMachine = createMockMachine;
exports.createMockMachineConfiguration = createMockMachineConfiguration;
exports.createMockApplication = createMockApplication;
exports.createMockFirewallRuleSet = createMockFirewallRuleSet;
exports.createMockFirewallRuleRecord = createMockFirewallRuleRecord;
exports.createMockNWFilter = createMockNWFilter;
exports.createMockFWRule = createMockFWRule;
exports.createMockFilterReference = createMockFilterReference;
exports.createMockNode = createMockNode;
exports.createMockDisk = createMockDisk;
exports.createMockPendingCommand = createMockPendingCommand;
exports.createMockDepartmentConfiguration = createMockDepartmentConfiguration;
exports.createMockSystemMetrics = createMockSystemMetrics;
exports.createMockProcessSnapshot = createMockProcessSnapshot;
exports.createMockApplicationUsage = createMockApplicationUsage;
exports.createMockPortUsage = createMockPortUsage;
exports.createMockWindowsService = createMockWindowsService;
exports.createMockServiceStateHistory = createMockServiceStateHistory;
exports.createMockMachineWithRelations = createMockMachineWithRelations;
exports.createMockDepartmentWithMachines = createMockDepartmentWithMachines;
exports.createMockNetworkFilterWithRules = createMockNetworkFilterWithRules;
exports.createMockUsers = createMockUsers;
exports.createMockMachines = createMockMachines;
exports.createMockDepartments = createMockDepartments;
exports.createMockApplications = createMockApplications;
exports.createMockUserInput = createMockUserInput;
exports.createMockMachineInput = createMockMachineInput;
exports.createMockDepartmentInput = createMockDepartmentInput;
exports.createMockApplicationInput = createMockApplicationInput;
exports.createMockFirewallRuleInput = createMockFirewallRuleInput;
exports.createMockPaginatedResponse = createMockPaginatedResponse;
exports.createMockNetwork = createMockNetwork;
exports.createNetworkInput = createNetworkInput;
exports.createMockDomainXML = createMockDomainXML;
exports.createMockNetworkXML = createMockNetworkXML;
exports.createMockStoragePoolXML = createMockStoragePoolXML;
exports.createMockNWFilterXML = createMockNWFilterXML;
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const bcrypt_1 = __importDefault(require("bcrypt"));
const type_1 = require("@resolvers/machine/type");
// Generate random IDs
const generateId = () => (0, crypto_1.randomBytes)(16).toString('hex');
exports.generateId = generateId;
// User factory
// User factory
function createMockUser(overrides) {
    var _a;
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        email: (overrides === null || overrides === void 0 ? void 0 : overrides.email) || `user-${id}@example.com`,
        password: (overrides === null || overrides === void 0 ? void 0 : overrides.password) || bcrypt_1.default.hashSync('password123', 10),
        deleted: (_a = overrides === null || overrides === void 0 ? void 0 : overrides.deleted) !== null && _a !== void 0 ? _a : false,
        token: (overrides === null || overrides === void 0 ? void 0 : overrides.token) || `token-${id}`,
        firstName: (overrides === null || overrides === void 0 ? void 0 : overrides.firstName) || 'Test',
        lastName: (overrides === null || overrides === void 0 ? void 0 : overrides.lastName) || 'User',
        role: (overrides === null || overrides === void 0 ? void 0 : overrides.role) || client_1.UserRole.USER,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
function createMockAdminUser(overrides) {
    return createMockUser(Object.assign({ role: client_1.UserRole.ADMIN, firstName: 'Admin', lastName: 'User' }, overrides));
}
// Department factory
function createMockDepartment(overrides) {
    var _a, _b, _c, _d;
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Department-${id}`,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        internetSpeed: (_a = overrides === null || overrides === void 0 ? void 0 : overrides.internetSpeed) !== null && _a !== void 0 ? _a : 100,
        ipSubnet: (_b = overrides === null || overrides === void 0 ? void 0 : overrides.ipSubnet) !== null && _b !== void 0 ? _b : '192.168.1.0/24',
        firewallRuleSetId: (overrides === null || overrides === void 0 ? void 0 : overrides.firewallRuleSetId) || null,
        bridgeName: (_c = overrides === null || overrides === void 0 ? void 0 : overrides.bridgeName) !== null && _c !== void 0 ? _c : 'br-mock',
        gatewayIP: (overrides === null || overrides === void 0 ? void 0 : overrides.gatewayIP) || null,
        dhcpRangeStart: (overrides === null || overrides === void 0 ? void 0 : overrides.dhcpRangeStart) || null,
        dhcpRangeEnd: (overrides === null || overrides === void 0 ? void 0 : overrides.dhcpRangeEnd) || null,
        dnsmasqPid: (overrides === null || overrides === void 0 ? void 0 : overrides.dnsmasqPid) || null,
        dnsServers: (overrides === null || overrides === void 0 ? void 0 : overrides.dnsServers) || ['8.8.8.8', '8.8.4.4', '1.1.1.1'],
        ntpServers: (overrides === null || overrides === void 0 ? void 0 : overrides.ntpServers) || ['216.239.35.0', '162.159.200.1'],
        mtu: (_d = overrides === null || overrides === void 0 ? void 0 : overrides.mtu) !== null && _d !== void 0 ? _d : 1500,
        firewallPolicy: (overrides === null || overrides === void 0 ? void 0 : overrides.firewallPolicy) || client_1.FirewallPolicy.BLOCK_ALL,
        firewallDefaultConfig: (overrides === null || overrides === void 0 ? void 0 : overrides.firewallDefaultConfig) || 'allow_outbound',
        firewallCustomRules: (overrides === null || overrides === void 0 ? void 0 : overrides.firewallCustomRules) || null
    };
}
// Machine Template Category factory
function createMockMachineTemplateCategory(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Category-${id}`,
        description: (overrides === null || overrides === void 0 ? void 0 : overrides.description) || `Description for category ${id}`,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Machine Template factory
function createMockMachineTemplate(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Template-${id}`,
        description: (overrides === null || overrides === void 0 ? void 0 : overrides.description) || `Template description ${id}`,
        cores: (overrides === null || overrides === void 0 ? void 0 : overrides.cores) || 4,
        ram: (overrides === null || overrides === void 0 ? void 0 : overrides.ram) || 8,
        storage: (overrides === null || overrides === void 0 ? void 0 : overrides.storage) || 100,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        categoryId: (overrides === null || overrides === void 0 ? void 0 : overrides.categoryId) || null
    };
}
// Machine factory
function createMockMachine(overrides) {
    var _a;
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Machine-${id}`,
        internalName: (overrides === null || overrides === void 0 ? void 0 : overrides.internalName) || `vm-${id}`,
        status: (overrides === null || overrides === void 0 ? void 0 : overrides.status) || 'stopped',
        userId: (overrides === null || overrides === void 0 ? void 0 : overrides.userId) || null,
        templateId: (overrides === null || overrides === void 0 ? void 0 : overrides.templateId) || (0, exports.generateId)(),
        os: (overrides === null || overrides === void 0 ? void 0 : overrides.os) || 'ubuntu-22.04',
        cpuCores: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuCores) || 4,
        ramGB: (overrides === null || overrides === void 0 ? void 0 : overrides.ramGB) || 8,
        diskSizeGB: (overrides === null || overrides === void 0 ? void 0 : overrides.diskSizeGB) || 100,
        gpuPciAddress: (overrides === null || overrides === void 0 ? void 0 : overrides.gpuPciAddress) || null,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        departmentId: (overrides === null || overrides === void 0 ? void 0 : overrides.departmentId) || null,
        localIP: (overrides === null || overrides === void 0 ? void 0 : overrides.localIP) || null,
        publicIP: (overrides === null || overrides === void 0 ? void 0 : overrides.publicIP) || null,
        nodeId: (overrides === null || overrides === void 0 ? void 0 : overrides.nodeId) || null,
        firewallRuleSetId: (overrides === null || overrides === void 0 ? void 0 : overrides.firewallRuleSetId) || null,
        version: (overrides === null || overrides === void 0 ? void 0 : overrides.version) || 1,
        poolId: (_a = overrides === null || overrides === void 0 ? void 0 : overrides.poolId) !== null && _a !== void 0 ? _a : null
    };
}
// Machine Configuration factory
function createMockMachineConfiguration(overrides) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        machineId: (overrides === null || overrides === void 0 ? void 0 : overrides.machineId) || (0, exports.generateId)(),
        xml: (overrides === null || overrides === void 0 ? void 0 : overrides.xml) || { domain: { name: 'test-vm' } },
        graphicProtocol: (overrides === null || overrides === void 0 ? void 0 : overrides.graphicProtocol) || null,
        graphicPort: (overrides === null || overrides === void 0 ? void 0 : overrides.graphicPort) || null,
        graphicPassword: (overrides === null || overrides === void 0 ? void 0 : overrides.graphicPassword) || null,
        graphicHost: (overrides === null || overrides === void 0 ? void 0 : overrides.graphicHost) || null,
        assignedGpuBus: (overrides === null || overrides === void 0 ? void 0 : overrides.assignedGpuBus) || null,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        qmpSocketPath: (overrides === null || overrides === void 0 ? void 0 : overrides.qmpSocketPath) || null,
        qemuPid: (overrides === null || overrides === void 0 ? void 0 : overrides.qemuPid) || null,
        tapDeviceName: (overrides === null || overrides === void 0 ? void 0 : overrides.tapDeviceName) || null,
        bridge: (overrides === null || overrides === void 0 ? void 0 : overrides.bridge) || 'virbr0',
        networkModel: (overrides === null || overrides === void 0 ? void 0 : overrides.networkModel) || 'virtio-net-pci',
        networkQueues: (_a = overrides === null || overrides === void 0 ? void 0 : overrides.networkQueues) !== null && _a !== void 0 ? _a : 1,
        machineType: (overrides === null || overrides === void 0 ? void 0 : overrides.machineType) || 'q35',
        cpuModel: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuModel) || 'host',
        diskBus: (overrides === null || overrides === void 0 ? void 0 : overrides.diskBus) || 'virtio',
        diskCacheMode: (overrides === null || overrides === void 0 ? void 0 : overrides.diskCacheMode) || 'writeback',
        ioThreads: (_b = overrides === null || overrides === void 0 ? void 0 : overrides.ioThreads) !== null && _b !== void 0 ? _b : false,
        diskPaths: (overrides === null || overrides === void 0 ? void 0 : overrides.diskPaths) || null,
        gpuRomFile: (overrides === null || overrides === void 0 ? void 0 : overrides.gpuRomFile) || null,
        gpuAudioBus: (overrides === null || overrides === void 0 ? void 0 : overrides.gpuAudioBus) || null,
        memoryBalloon: (_c = overrides === null || overrides === void 0 ? void 0 : overrides.memoryBalloon) !== null && _c !== void 0 ? _c : false,
        hugepages: (_d = overrides === null || overrides === void 0 ? void 0 : overrides.hugepages) !== null && _d !== void 0 ? _d : false,
        numaConfig: (overrides === null || overrides === void 0 ? void 0 : overrides.numaConfig) || null,
        cpuPinning: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuPinning) || null,
        enableNumaCtlPinning: (_e = overrides === null || overrides === void 0 ? void 0 : overrides.enableNumaCtlPinning) !== null && _e !== void 0 ? _e : false,
        cpuPinningStrategy: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuPinningStrategy) || 'basic',
        uefiFirmware: (overrides === null || overrides === void 0 ? void 0 : overrides.uefiFirmware) || null,
        secureboot: (_f = overrides === null || overrides === void 0 ? void 0 : overrides.secureboot) !== null && _f !== void 0 ? _f : false,
        tpmSocketPath: (overrides === null || overrides === void 0 ? void 0 : overrides.tpmSocketPath) || null,
        guestAgentSocketPath: (overrides === null || overrides === void 0 ? void 0 : overrides.guestAgentSocketPath) || null,
        infiniServiceSocketPath: (overrides === null || overrides === void 0 ? void 0 : overrides.infiniServiceSocketPath) || null,
        virtioDriversIso: (overrides === null || overrides === void 0 ? void 0 : overrides.virtioDriversIso) || null,
        enableAudio: (_g = overrides === null || overrides === void 0 ? void 0 : overrides.enableAudio) !== null && _g !== void 0 ? _g : false,
        enableUsbTablet: (_h = overrides === null || overrides === void 0 ? void 0 : overrides.enableUsbTablet) !== null && _h !== void 0 ? _h : true,
        setupComplete: (_j = overrides === null || overrides === void 0 ? void 0 : overrides.setupComplete) !== null && _j !== void 0 ? _j : false
    };
}
// Application factory
function createMockApplication(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Application-${id}`,
        description: (overrides === null || overrides === void 0 ? void 0 : overrides.description) || `App description ${id}`,
        version: (overrides === null || overrides === void 0 ? void 0 : overrides.version) || '1.0.0',
        url: (overrides === null || overrides === void 0 ? void 0 : overrides.url) || `https://app-${id}.example.com`,
        icon: (overrides === null || overrides === void 0 ? void 0 : overrides.icon) || null,
        os: (overrides === null || overrides === void 0 ? void 0 : overrides.os) || ['windows', 'linux'],
        installCommand: (overrides === null || overrides === void 0 ? void 0 : overrides.installCommand) || { command: 'install.sh' },
        parameters: (overrides === null || overrides === void 0 ? void 0 : overrides.parameters) || {},
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Firewall Rule Set factory
function createMockFirewallRuleSet(overrides) {
    var _a;
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `ruleset-${id}`,
        internalName: (overrides === null || overrides === void 0 ? void 0 : overrides.internalName) || `fw-${id}`,
        entityType: (overrides === null || overrides === void 0 ? void 0 : overrides.entityType) || client_1.RuleSetType.DEPARTMENT,
        entityId: (overrides === null || overrides === void 0 ? void 0 : overrides.entityId) || (0, exports.generateId)(),
        priority: (overrides === null || overrides === void 0 ? void 0 : overrides.priority) || 500,
        isActive: (_a = overrides === null || overrides === void 0 ? void 0 : overrides.isActive) !== null && _a !== void 0 ? _a : true,
        libvirtUuid: (overrides === null || overrides === void 0 ? void 0 : overrides.libvirtUuid) || null,
        xmlContent: (overrides === null || overrides === void 0 ? void 0 : overrides.xmlContent) || null,
        lastSyncedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.lastSyncedAt) || null,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Firewall Rule factory (Prisma-based)
function createMockFirewallRuleRecord(overrides) {
    var _a, _b;
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        ruleSetId: (overrides === null || overrides === void 0 ? void 0 : overrides.ruleSetId) || (0, exports.generateId)(),
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `rule-${id}`,
        description: (overrides === null || overrides === void 0 ? void 0 : overrides.description) || null,
        action: (overrides === null || overrides === void 0 ? void 0 : overrides.action) || client_1.RuleAction.ACCEPT,
        direction: (overrides === null || overrides === void 0 ? void 0 : overrides.direction) || client_1.RuleDirection.INOUT,
        priority: (overrides === null || overrides === void 0 ? void 0 : overrides.priority) || 500,
        protocol: (overrides === null || overrides === void 0 ? void 0 : overrides.protocol) || 'all',
        srcPortStart: (overrides === null || overrides === void 0 ? void 0 : overrides.srcPortStart) || null,
        srcPortEnd: (overrides === null || overrides === void 0 ? void 0 : overrides.srcPortEnd) || null,
        dstPortStart: (overrides === null || overrides === void 0 ? void 0 : overrides.dstPortStart) || null,
        dstPortEnd: (overrides === null || overrides === void 0 ? void 0 : overrides.dstPortEnd) || null,
        srcIpAddr: (overrides === null || overrides === void 0 ? void 0 : overrides.srcIpAddr) || null,
        srcIpMask: (overrides === null || overrides === void 0 ? void 0 : overrides.srcIpMask) || null,
        dstIpAddr: (overrides === null || overrides === void 0 ? void 0 : overrides.dstIpAddr) || null,
        dstIpMask: (overrides === null || overrides === void 0 ? void 0 : overrides.dstIpMask) || null,
        connectionState: (overrides === null || overrides === void 0 ? void 0 : overrides.connectionState) || null,
        overridesDept: (_a = overrides === null || overrides === void 0 ? void 0 : overrides.overridesDept) !== null && _a !== void 0 ? _a : false,
        isSystemGenerated: (_b = overrides === null || overrides === void 0 ? void 0 : overrides.isSystemGenerated) !== null && _b !== void 0 ? _b : false,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Network Filter factory (legacy)
function createMockNWFilter(overrides) {
    var _a;
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `filter-${id}`,
        internalName: (overrides === null || overrides === void 0 ? void 0 : overrides.internalName) || `nwfilter-${id}`,
        uuid: (overrides === null || overrides === void 0 ? void 0 : overrides.uuid) || (0, exports.generateId)(),
        description: (overrides === null || overrides === void 0 ? void 0 : overrides.description) || `Filter description ${id}`,
        chain: (overrides === null || overrides === void 0 ? void 0 : overrides.chain) || 'ipv4',
        type: (overrides === null || overrides === void 0 ? void 0 : overrides.type) || 'generic',
        priority: (overrides === null || overrides === void 0 ? void 0 : overrides.priority) || 500,
        stateMatch: (_a = overrides === null || overrides === void 0 ? void 0 : overrides.stateMatch) !== null && _a !== void 0 ? _a : true,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        flushedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.flushedAt) || null
    };
}
// Firewall Rule factory (legacy)
function createMockFWRule(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        nwFilterId: (overrides === null || overrides === void 0 ? void 0 : overrides.nwFilterId) || (0, exports.generateId)(),
        action: (overrides === null || overrides === void 0 ? void 0 : overrides.action) || 'accept',
        direction: (overrides === null || overrides === void 0 ? void 0 : overrides.direction) || 'inout',
        priority: (overrides === null || overrides === void 0 ? void 0 : overrides.priority) || 500,
        protocol: (overrides === null || overrides === void 0 ? void 0 : overrides.protocol) || 'tcp',
        ipVersion: (overrides === null || overrides === void 0 ? void 0 : overrides.ipVersion) || 'ipv4',
        srcMacAddr: (overrides === null || overrides === void 0 ? void 0 : overrides.srcMacAddr) || null,
        srcIpAddr: (overrides === null || overrides === void 0 ? void 0 : overrides.srcIpAddr) || null,
        srcIpMask: (overrides === null || overrides === void 0 ? void 0 : overrides.srcIpMask) || null,
        dstIpAddr: (overrides === null || overrides === void 0 ? void 0 : overrides.dstIpAddr) || null,
        dstIpMask: (overrides === null || overrides === void 0 ? void 0 : overrides.dstIpMask) || null,
        srcPortStart: (overrides === null || overrides === void 0 ? void 0 : overrides.srcPortStart) || null,
        srcPortEnd: (overrides === null || overrides === void 0 ? void 0 : overrides.srcPortEnd) || null,
        dstPortStart: (overrides === null || overrides === void 0 ? void 0 : overrides.dstPortStart) || null,
        dstPortEnd: (overrides === null || overrides === void 0 ? void 0 : overrides.dstPortEnd) || null,
        state: (overrides === null || overrides === void 0 ? void 0 : overrides.state) || null,
        comment: (overrides === null || overrides === void 0 ? void 0 : overrides.comment) || null,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Filter Reference factory (legacy)
function createMockFilterReference(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        sourceFilterId: (overrides === null || overrides === void 0 ? void 0 : overrides.sourceFilterId) || (0, exports.generateId)(),
        targetFilterId: (overrides === null || overrides === void 0 ? void 0 : overrides.targetFilterId) || (0, exports.generateId)(),
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date()
    };
}
// Node factory
function createMockNode(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Node-${id}`,
        currentRaid: (overrides === null || overrides === void 0 ? void 0 : overrides.currentRaid) || 'RAID1',
        nextRaid: (overrides === null || overrides === void 0 ? void 0 : overrides.nextRaid) || null,
        cpuFlags: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuFlags) || { vmx: true, svm: false },
        ram: (overrides === null || overrides === void 0 ? void 0 : overrides.ram) || 32768,
        cores: (overrides === null || overrides === void 0 ? void 0 : overrides.cores) || 16,
        maintenanceMode: (overrides === null || overrides === void 0 ? void 0 : overrides.maintenanceMode) !== null && (overrides === null || overrides === void 0 ? void 0 : overrides.maintenanceMode) !== void 0 ? overrides.maintenanceMode : false,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Disk factory
function createMockDisk(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        path: (overrides === null || overrides === void 0 ? void 0 : overrides.path) || `/dev/sda${id}`,
        nodeId: (overrides === null || overrides === void 0 ? void 0 : overrides.nodeId) || (0, exports.generateId)(),
        status: (overrides === null || overrides === void 0 ? void 0 : overrides.status) || 'healthy',
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Pending Command factory
function createMockPendingCommand(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        machineId: (overrides === null || overrides === void 0 ? void 0 : overrides.machineId) || (0, exports.generateId)(),
        command: (overrides === null || overrides === void 0 ? void 0 : overrides.command) || 'UPDATE_SOFTWARE',
        parameters: (overrides === null || overrides === void 0 ? void 0 : overrides.parameters) || {},
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Department Configuration factory
function createMockDepartmentConfiguration(overrides) {
    var _a;
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        departmentId: (overrides === null || overrides === void 0 ? void 0 : overrides.departmentId) || (0, exports.generateId)(),
        cleanTraffic: (_a = overrides === null || overrides === void 0 ? void 0 : overrides.cleanTraffic) !== null && _a !== void 0 ? _a : false,
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// System Metrics factory (InfiniService)
function createMockSystemMetrics(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        machineId: (overrides === null || overrides === void 0 ? void 0 : overrides.machineId) || (0, exports.generateId)(),
        cpuUsagePercent: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuUsagePercent) || 25.5,
        cpuCoresUsage: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuCoresUsage) || [25.0, 30.0, 20.0, 35.0],
        cpuTemperature: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuTemperature) || 65.0,
        totalMemoryKB: (overrides === null || overrides === void 0 ? void 0 : overrides.totalMemoryKB) || BigInt(8192000),
        usedMemoryKB: (overrides === null || overrides === void 0 ? void 0 : overrides.usedMemoryKB) || BigInt(4096000),
        availableMemoryKB: (overrides === null || overrides === void 0 ? void 0 : overrides.availableMemoryKB) || BigInt(4096000),
        swapTotalKB: (overrides === null || overrides === void 0 ? void 0 : overrides.swapTotalKB) || BigInt(2048000),
        swapUsedKB: (overrides === null || overrides === void 0 ? void 0 : overrides.swapUsedKB) || BigInt(512000),
        diskUsageStats: (overrides === null || overrides === void 0 ? void 0 : overrides.diskUsageStats) || { '/': { total: 100000, used: 50000, free: 50000 } },
        diskIOStats: (overrides === null || overrides === void 0 ? void 0 : overrides.diskIOStats) || { read: 1000000, write: 500000 },
        networkStats: (overrides === null || overrides === void 0 ? void 0 : overrides.networkStats) || { rx: 1000000, tx: 500000 },
        uptime: (overrides === null || overrides === void 0 ? void 0 : overrides.uptime) || BigInt(86400),
        loadAverage: (overrides === null || overrides === void 0 ? void 0 : overrides.loadAverage) || [1.5, 1.2, 0.9],
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        timestamp: (overrides === null || overrides === void 0 ? void 0 : overrides.timestamp) || new Date()
    };
}
// Process Snapshot factory
function createMockProcessSnapshot(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        machineId: (overrides === null || overrides === void 0 ? void 0 : overrides.machineId) || (0, exports.generateId)(),
        processId: (overrides === null || overrides === void 0 ? void 0 : overrides.processId) || 1234,
        parentPid: (overrides === null || overrides === void 0 ? void 0 : overrides.parentPid) || 1,
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || 'test-process.exe',
        executablePath: (overrides === null || overrides === void 0 ? void 0 : overrides.executablePath) || '/usr/bin/test-process',
        commandLine: (overrides === null || overrides === void 0 ? void 0 : overrides.commandLine) || 'test-process --daemon',
        cpuUsagePercent: (overrides === null || overrides === void 0 ? void 0 : overrides.cpuUsagePercent) || 10.5,
        memoryUsageKB: (overrides === null || overrides === void 0 ? void 0 : overrides.memoryUsageKB) || BigInt(1024000),
        diskReadBytes: (overrides === null || overrides === void 0 ? void 0 : overrides.diskReadBytes) || BigInt(500000),
        diskWriteBytes: (overrides === null || overrides === void 0 ? void 0 : overrides.diskWriteBytes) || BigInt(250000),
        status: (overrides === null || overrides === void 0 ? void 0 : overrides.status) || 'running',
        startTime: (overrides === null || overrides === void 0 ? void 0 : overrides.startTime) || new Date(Date.now() - 3600000),
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        timestamp: (overrides === null || overrides === void 0 ? void 0 : overrides.timestamp) || new Date()
    };
}
// Application Usage factory
function createMockApplicationUsage(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        machineId: (overrides === null || overrides === void 0 ? void 0 : overrides.machineId) || (0, exports.generateId)(),
        executablePath: (overrides === null || overrides === void 0 ? void 0 : overrides.executablePath) || 'C:\\Program Files\\TestApp\\test.exe',
        applicationName: (overrides === null || overrides === void 0 ? void 0 : overrides.applicationName) || 'TestApp',
        version: (overrides === null || overrides === void 0 ? void 0 : overrides.version) || '1.0.0',
        description: (overrides === null || overrides === void 0 ? void 0 : overrides.description) || 'Test application',
        publisher: (overrides === null || overrides === void 0 ? void 0 : overrides.publisher) || 'Test Publisher',
        lastAccessTime: (overrides === null || overrides === void 0 ? void 0 : overrides.lastAccessTime) || new Date(),
        lastModifiedTime: (overrides === null || overrides === void 0 ? void 0 : overrides.lastModifiedTime) || new Date(Date.now() - 86400000),
        accessCount: (overrides === null || overrides === void 0 ? void 0 : overrides.accessCount) || 10,
        totalUsageMinutes: (overrides === null || overrides === void 0 ? void 0 : overrides.totalUsageMinutes) || 120,
        iconData: (overrides === null || overrides === void 0 ? void 0 : overrides.iconData) || null,
        iconFormat: (overrides === null || overrides === void 0 ? void 0 : overrides.iconFormat) || null,
        fileSize: (overrides === null || overrides === void 0 ? void 0 : overrides.fileSize) || BigInt(10485760),
        firstSeen: (overrides === null || overrides === void 0 ? void 0 : overrides.firstSeen) || new Date(Date.now() - 604800000),
        lastSeen: (overrides === null || overrides === void 0 ? void 0 : overrides.lastSeen) || new Date(),
        isActive: (overrides === null || overrides === void 0 ? void 0 : overrides.isActive) !== undefined ? overrides.isActive : true,
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Port Usage factory
function createMockPortUsage(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        machineId: (overrides === null || overrides === void 0 ? void 0 : overrides.machineId) || (0, exports.generateId)(),
        port: (overrides === null || overrides === void 0 ? void 0 : overrides.port) || 8080,
        protocol: (overrides === null || overrides === void 0 ? void 0 : overrides.protocol) || 'TCP',
        state: (overrides === null || overrides === void 0 ? void 0 : overrides.state) || 'LISTENING',
        processId: (overrides === null || overrides === void 0 ? void 0 : overrides.processId) || 1234,
        processName: (overrides === null || overrides === void 0 ? void 0 : overrides.processName) || 'node.exe',
        executablePath: (overrides === null || overrides === void 0 ? void 0 : overrides.executablePath) || '/usr/bin/node',
        isListening: (overrides === null || overrides === void 0 ? void 0 : overrides.isListening) !== undefined ? overrides.isListening : true,
        connectionCount: (overrides === null || overrides === void 0 ? void 0 : overrides.connectionCount) || 5,
        lastActivity: (overrides === null || overrides === void 0 ? void 0 : overrides.lastActivity) || new Date(),
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        timestamp: (overrides === null || overrides === void 0 ? void 0 : overrides.timestamp) || new Date()
    };
}
// Windows Service factory
function createMockWindowsService(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        machineId: (overrides === null || overrides === void 0 ? void 0 : overrides.machineId) || (0, exports.generateId)(),
        serviceName: (overrides === null || overrides === void 0 ? void 0 : overrides.serviceName) || 'TestService',
        displayName: (overrides === null || overrides === void 0 ? void 0 : overrides.displayName) || 'Test Service Display',
        description: (overrides === null || overrides === void 0 ? void 0 : overrides.description) || 'Test service for testing purposes',
        startType: (overrides === null || overrides === void 0 ? void 0 : overrides.startType) || 'Automatic',
        serviceType: (overrides === null || overrides === void 0 ? void 0 : overrides.serviceType) || 'Win32OwnProcess',
        executablePath: (overrides === null || overrides === void 0 ? void 0 : overrides.executablePath) || 'C:\\Windows\\System32\\svchost.exe',
        dependencies: (overrides === null || overrides === void 0 ? void 0 : overrides.dependencies) || null,
        currentState: (overrides === null || overrides === void 0 ? void 0 : overrides.currentState) || 'Running',
        processId: (overrides === null || overrides === void 0 ? void 0 : overrides.processId) || 1234,
        lastStateChange: (overrides === null || overrides === void 0 ? void 0 : overrides.lastStateChange) || new Date(),
        stateChangeCount: (overrides === null || overrides === void 0 ? void 0 : overrides.stateChangeCount) || 0,
        isDefaultService: (overrides === null || overrides === void 0 ? void 0 : overrides.isDefaultService) !== undefined ? overrides.isDefaultService : false,
        usageScore: (overrides === null || overrides === void 0 ? void 0 : overrides.usageScore) || 0.5,
        firstSeen: (overrides === null || overrides === void 0 ? void 0 : overrides.firstSeen) || new Date(),
        lastSeen: (overrides === null || overrides === void 0 ? void 0 : overrides.lastSeen) || new Date(),
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date()
    };
}
// Service State History factory
function createMockServiceStateHistory(overrides) {
    const id = (overrides === null || overrides === void 0 ? void 0 : overrides.id) || (0, exports.generateId)();
    return {
        id,
        serviceId: (overrides === null || overrides === void 0 ? void 0 : overrides.serviceId) || (0, exports.generateId)(),
        fromState: (overrides === null || overrides === void 0 ? void 0 : overrides.fromState) || 'Stopped',
        toState: (overrides === null || overrides === void 0 ? void 0 : overrides.toState) || 'Running',
        reason: (overrides === null || overrides === void 0 ? void 0 : overrides.reason) || 'Manual start',
        createdAt: (overrides === null || overrides === void 0 ? void 0 : overrides.createdAt) || new Date(),
        updatedAt: (overrides === null || overrides === void 0 ? void 0 : overrides.updatedAt) || new Date(),
        timestamp: (overrides === null || overrides === void 0 ? void 0 : overrides.timestamp) || new Date()
    };
}
// Helper functions for creating related data
function createMockMachineWithRelations() {
    const user = createMockUser();
    const department = createMockDepartment();
    const template = createMockMachineTemplate();
    const machine = createMockMachine({
        userId: user.id,
        departmentId: department.id,
        templateId: template.id
    });
    const configuration = createMockMachineConfiguration({
        machineId: machine.id
    });
    return {
        user,
        department,
        template,
        machine,
        configuration
    };
}
function createMockDepartmentWithMachines(machineCount = 3) {
    const department = createMockDepartment();
    const template = createMockMachineTemplate();
    const machines = Array.from({ length: machineCount }, () => createMockMachine({
        departmentId: department.id,
        templateId: template.id
    }));
    const configuration = createMockDepartmentConfiguration({
        departmentId: department.id
    });
    return {
        department,
        template,
        machines,
        configuration
    };
}
function createMockNetworkFilterWithRules(ruleCount = 5) {
    const filter = createMockNWFilter();
    const rules = Array.from({ length: ruleCount }, (_, index) => createMockFWRule({
        nwFilterId: filter.id,
        priority: (index + 1) * 100
    }));
    return {
        filter,
        rules
    };
}
// Batch creation helpers
function createMockUsers(count = 5) {
    return Array.from({ length: count }, () => createMockUser());
}
function createMockMachines(count = 5) {
    const template = createMockMachineTemplate();
    return Array.from({ length: count }, () => createMockMachine({ templateId: template.id }));
}
function createMockDepartments(count = 3) {
    return Array.from({ length: count }, () => createMockDepartment());
}
function createMockApplications(count = 5) {
    return Array.from({ length: count }, () => createMockApplication());
}
// GraphQL input type factories
function createMockUserInput(overrides) {
    const password = (overrides === null || overrides === void 0 ? void 0 : overrides.password) || 'SecurePass123!';
    return Object.assign({ email: (overrides === null || overrides === void 0 ? void 0 : overrides.email) || `test-${Date.now()}@example.com`, password, passwordConfirmation: (overrides === null || overrides === void 0 ? void 0 : overrides.passwordConfirmation) || password, firstName: (overrides === null || overrides === void 0 ? void 0 : overrides.firstName) || 'Test', lastName: (overrides === null || overrides === void 0 ? void 0 : overrides.lastName) || 'User', role: (overrides === null || overrides === void 0 ? void 0 : overrides.role) || client_1.UserRole.USER }, overrides);
}
function createMockMachineInput(overrides) {
    return Object.assign({ name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Test Machine ${Date.now()}`, templateId: (overrides === null || overrides === void 0 ? void 0 : overrides.templateId) || (0, exports.generateId)(), departmentId: (overrides === null || overrides === void 0 ? void 0 : overrides.departmentId) || (0, exports.generateId)(), os: (overrides === null || overrides === void 0 ? void 0 : overrides.os) || type_1.OsEnum.WINDOWS10, username: (overrides === null || overrides === void 0 ? void 0 : overrides.username) || 'testuser', password: (overrides === null || overrides === void 0 ? void 0 : overrides.password) || 'testpassword123', pciBus: (overrides === null || overrides === void 0 ? void 0 : overrides.pciBus) || null, applications: (overrides === null || overrides === void 0 ? void 0 : overrides.applications) || [], firstBootScripts: [] }, overrides);
}
function createMockDepartmentInput(overrides) {
    return Object.assign({ name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Test Department ${Date.now()}`, internetSpeed: (overrides === null || overrides === void 0 ? void 0 : overrides.internetSpeed) || 100, ipSubnet: (overrides === null || overrides === void 0 ? void 0 : overrides.ipSubnet) || '192.168.1.0/24' }, overrides);
}
function createMockApplicationInput(overrides) {
    return Object.assign({ name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || `Test App ${Date.now()}`, description: (overrides === null || overrides === void 0 ? void 0 : overrides.description) || 'Test application', version: (overrides === null || overrides === void 0 ? void 0 : overrides.version) || '1.0.0', os: (overrides === null || overrides === void 0 ? void 0 : overrides.os) || ['windows', 'linux'], installCommand: (overrides === null || overrides === void 0 ? void 0 : overrides.installCommand) || { command: 'install.sh' } }, overrides);
}
function createMockFirewallRuleInput(overrides) {
    return Object.assign({ action: (overrides === null || overrides === void 0 ? void 0 : overrides.action) || 'accept', direction: (overrides === null || overrides === void 0 ? void 0 : overrides.direction) || 'in', priority: (overrides === null || overrides === void 0 ? void 0 : overrides.priority) || 500, protocol: (overrides === null || overrides === void 0 ? void 0 : overrides.protocol) || 'tcp', dstPortStart: (overrides === null || overrides === void 0 ? void 0 : overrides.dstPortStart) || 80, dstPortEnd: (overrides === null || overrides === void 0 ? void 0 : overrides.dstPortEnd) || 80, comment: (overrides === null || overrides === void 0 ? void 0 : overrides.comment) || 'Test rule' }, overrides);
}
// Pagination helpers
function createMockPaginatedResponse(items, total, page = 1, pageSize = 10) {
    const actualTotal = total !== null && total !== void 0 ? total : items.length;
    const start = (page - 1) * pageSize;
    const paginatedItems = items.slice(start, start + pageSize);
    return {
        items: paginatedItems,
        total: actualTotal,
        page,
        pageSize,
        totalPages: Math.ceil(actualTotal / pageSize),
        hasNext: start + pageSize < actualTotal,
        hasPrevious: page > 1
    };
}
// Network mock
function createMockNetwork(overrides) {
    return {
        name: (overrides === null || overrides === void 0 ? void 0 : overrides.name) || 'test-network',
        active: (overrides === null || overrides === void 0 ? void 0 : overrides.active) !== undefined ? overrides.active : true,
        // This is the bridge name auto-generated by libvirt for the 'default' network
        bridgeName: 'virbr-default',
        ipAddress: '192.168.1.1',
        ipRange: '192.168.1.100-192.168.1.200',
        uuid: (0, exports.generateId)()
    };
}
function createNetworkInput() {
    return {
        name: `test-network-${Date.now()}`,
        ipRange: '192.168.1.0/24',
        // This is the bridge name auto-generated by libvirt for the 'default' network
        bridgeName: 'virbr-default'
    };
}
// Mock libvirt XML generators
function createMockDomainXML(name = 'test-vm') {
    return `<?xml version="1.0"?>
<domain type="kvm">
  <name>${name}</name>
  <uuid>${(0, exports.generateId)()}</uuid>
  <memory unit="KiB">8388608</memory>
  <currentMemory unit="KiB">8388608</currentMemory>
  <vcpu placement="static">4</vcpu>
  <os>
    <type arch="x86_64" machine="pc-q35-6.2">hvm</type>
    <boot dev="hd"/>
  </os>
  <devices>
    <disk type="file" device="disk">
      <driver name="qemu" type="qcow2"/>
      <source file="/var/lib/libvirt/images/${name}.qcow2"/>
      <target dev="vda" bus="virtio"/>
    </disk>
    <interface type="network">
      <mac address="52:54:00:${Math.random().toString(16).substr(2, 2)}:${Math.random().toString(16).substr(2, 2)}:${Math.random().toString(16).substr(2, 2)}"/>
      <source network="default"/>
      <model type="virtio"/>
    </interface>
    <graphics type="vnc" port="5900" autoport="yes" listen="0.0.0.0">
      <listen type="address" address="0.0.0.0"/>
    </graphics>
  </devices>
</domain>`;
}
function createMockNetworkXML(name = 'test-network') {
    return `<?xml version="1.0"?>
<network>
  <name>${name}</name>
  <uuid>${(0, exports.generateId)()}</uuid>
  <forward mode="nat"/>
  <bridge name="virbr1" stp="on" delay="0"/>
  <ip address="192.168.100.1" netmask="255.255.255.0">
    <dhcp>
      <range start="192.168.100.2" end="192.168.100.254"/>
    </dhcp>
  </ip>
</network>`;
}
function createMockStoragePoolXML(name = 'test-pool') {
    return `<?xml version="1.0"?>
<pool type="dir">
  <name>${name}</name>
  <uuid>${(0, exports.generateId)()}</uuid>
  <capacity unit="bytes">1099511627776</capacity>
  <allocation unit="bytes">0</allocation>
  <available unit="bytes">1099511627776</available>
  <source/>
  <target>
    <path>/var/lib/libvirt/images</path>
  </target>
</pool>`;
}
function createMockNWFilterXML(name = 'test-filter') {
    return `<?xml version="1.0"?>
<filter name="${name}" chain="ipv4" priority="500">
  <uuid>${(0, exports.generateId)()}</uuid>
  <rule action="accept" direction="out" priority="100">
    <ip protocol="tcp" dstportstart="80" dstportend="80"/>
  </rule>
  <rule action="accept" direction="in" priority="200">
    <ip protocol="tcp" srcportstart="80" srcportend="80"/>
  </rule>
</filter>`;
}
