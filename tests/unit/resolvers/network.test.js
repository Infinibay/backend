"use strict";
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
require("reflect-metadata");
const resolver_1 = require("@graphql/resolvers/networks/resolver");
const test_helpers_1 = require("../../setup/test-helpers");
// Mock NetworkService
jest.mock('@services/networkService');
describe('NetworkResolver', () => {
    let resolver;
    let mockNetworkService;
    const context = (0, test_helpers_1.createAdminContext)();
    beforeEach(() => {
        jest.clearAllMocks();
        resolver = new resolver_1.NetworkResolver();
        // Create a proper mock instance
        mockNetworkService = {
            getAllNetworks: jest.fn(),
            getNetwork: jest.fn(),
            createNetwork: jest.fn(),
            deleteNetwork: jest.fn(),
            setNetworkIp: jest.fn(),
            setIpRange: jest.fn(),
            setBridgeName: jest.fn()
        };
        // Replace the service in the resolver
        resolver.networkService = mockNetworkService;
        (0, test_helpers_1.setupLibvirtMockState)({
            networks: [
                { name: 'default', xml: '<network><name>default</name></network>', active: true },
                { name: 'isolated', xml: '<network><name>isolated</name></network>', active: false }
            ]
        });
    });
    describe('Query: networks', () => {
        it('should return all networks', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockNetworks = [
                { name: 'default', xml: { uuid: ['uuid1'], bridge: [{ $: { name: 'br0', stp: 'on', delay: '0' } }], ip: [{ $: { address: '192.168.1.1', netmask: '255.255.255.0' } }] } },
                { name: 'isolated', xml: { uuid: ['uuid2'] } }
            ];
            mockNetworkService.getAllNetworks.mockResolvedValue(mockNetworks);
            const result = yield resolver.networks();
            expect(mockNetworkService.getAllNetworks).toHaveBeenCalled();
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('default');
            expect(result[1].name).toBe('isolated');
        }));
        it('should return empty array when no networks', () => __awaiter(void 0, void 0, void 0, function* () {
            mockNetworkService.getAllNetworks.mockResolvedValue([]);
            const result = yield resolver.networks();
            expect(result).toEqual([]);
        }));
    });
    describe('Query: network', () => {
        it('should return network by name', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockNetwork = {
                name: 'default',
                xml: {
                    uuid: ['test-uuid'],
                    bridge: [{ $: { name: 'br0', stp: 'on', delay: '0' } }],
                    ip: [{ $: { address: '192.168.1.1', netmask: '255.255.255.0' } }]
                }
            };
            mockNetworkService.getNetwork.mockResolvedValue(mockNetwork);
            const result = yield resolver.network('default');
            expect(mockNetworkService.getNetwork).toHaveBeenCalledWith('default');
            expect(result.name).toBe('default');
            expect(result.uuid).toBe('test-uuid');
        }));
    });
    describe('Mutation: createNetwork', () => {
        it('should create a new network', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'new-network',
                bridgeName: 'br0',
                description: 'Test network'
            };
            mockNetworkService.createNetwork.mockResolvedValue(undefined);
            const result = yield resolver.createNetwork(input);
            expect(mockNetworkService.createNetwork).toHaveBeenCalledWith(input);
            expect(result).toBe(true);
        }));
        it('should handle creation errors', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'default',
                bridgeName: 'br0',
                description: 'Duplicate network'
            };
            mockNetworkService.createNetwork.mockRejectedValue(new Error('Network with name default already exists'));
            yield expect(resolver.createNetwork(input))
                .rejects.toThrow('Network with name default already exists');
        }));
    });
    describe('Mutation: setNetworkIpRange', () => {
        it('should set network IP range', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                networkName: 'default',
                start: '192.168.122.100',
                end: '192.168.122.200'
            };
            mockNetworkService.setIpRange.mockResolvedValue(undefined);
            const result = yield resolver.setNetworkIpRange(input);
            expect(mockNetworkService.setIpRange).toHaveBeenCalledWith('default', '192.168.122.100', '192.168.122.200');
            expect(result).toBe(true);
        }));
    });
    describe('Mutation: setNetworkIp', () => {
        it('should set network IP configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                networkName: 'default',
                address: '192.168.1.1',
                netmask: '255.255.255.0'
            };
            mockNetworkService.setNetworkIp.mockResolvedValue(undefined);
            const result = yield resolver.setNetworkIp(input);
            expect(mockNetworkService.setNetworkIp).toHaveBeenCalledWith('default', '192.168.1.1', '255.255.255.0');
            expect(result).toBe(true);
        }));
    });
    describe('Mutation: setNetworkBridgeName', () => {
        it('should set network bridge name', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                networkName: 'default',
                bridgeName: 'br1'
            };
            mockNetworkService.setBridgeName.mockResolvedValue(undefined);
            const result = yield resolver.setNetworkBridgeName(input);
            expect(mockNetworkService.setBridgeName).toHaveBeenCalledWith('default', 'br1');
            expect(result).toBe(true);
        }));
    });
    describe('Mutation: deleteNetwork', () => {
        it('should delete a network', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'isolated'
            };
            mockNetworkService.deleteNetwork.mockResolvedValue(undefined);
            const result = yield resolver.deleteNetwork(input);
            expect(mockNetworkService.deleteNetwork).toHaveBeenCalledWith('isolated');
            expect(result).toBe(true);
        }));
        it('should handle deletion errors', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'default'
            };
            mockNetworkService.deleteNetwork.mockRejectedValue(new Error('Cannot delete default network'));
            yield expect(resolver.deleteNetwork(input))
                .rejects.toThrow('Failed to delete network: Cannot delete default network');
        }));
    });
});
