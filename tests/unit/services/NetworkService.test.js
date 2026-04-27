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
const globals_1 = require("@jest/globals");
const networkService_1 = require("../../../app/services/networkService");
(0, globals_1.describe)('NetworkService (Deprecated)', () => {
    let networkService;
    (0, globals_1.beforeEach)(() => {
        networkService = new networkService_1.NetworkService();
    });
    (0, globals_1.describe)('validateNetworkName', () => {
        (0, globals_1.it)('should throw deprecation error', () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, globals_1.expect)(networkService.validateNetworkName('test-network'))
                .rejects.toThrow('Libvirt networks are deprecated');
        }));
    });
    (0, globals_1.describe)('getAllNetworks', () => {
        (0, globals_1.it)('should return empty array', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield networkService.getAllNetworks();
            (0, globals_1.expect)(result).toEqual([]);
        }));
    });
    (0, globals_1.describe)('getNetwork', () => {
        (0, globals_1.it)('should throw deprecation error with network name', () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, globals_1.expect)(networkService.getNetwork('test-network'))
                .rejects.toThrow('Libvirt networks are deprecated');
        }));
    });
    (0, globals_1.describe)('createNetwork', () => {
        (0, globals_1.it)('should throw deprecation error', () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, globals_1.expect)(networkService.createNetwork({}))
                .rejects.toThrow('Libvirt networks are deprecated');
        }));
    });
    (0, globals_1.describe)('deleteNetwork', () => {
        (0, globals_1.it)('should throw deprecation error', () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, globals_1.expect)(networkService.deleteNetwork('test-network'))
                .rejects.toThrow('Libvirt networks are deprecated');
        }));
    });
    (0, globals_1.describe)('setIpRange', () => {
        (0, globals_1.it)('should throw deprecation error', () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, globals_1.expect)(networkService.setIpRange('net', '192.168.1.100', '192.168.1.200'))
                .rejects.toThrow('Libvirt networks are deprecated');
        }));
    });
    (0, globals_1.describe)('validateDhcpRange', () => {
        (0, globals_1.it)('should throw deprecation error', () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, globals_1.expect)(networkService.validateDhcpRange({
                address: '192.168.1.1',
                netmask: '255.255.255.0'
            })).rejects.toThrow('Libvirt networks are deprecated');
        }));
    });
});
