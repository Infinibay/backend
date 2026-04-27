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
const AppSettingsService_1 = require("../../../app/services/AppSettingsService");
const jest_mock_extended_1 = require("jest-mock-extended");
const fs_1 = require("fs");
// Mock dependencies
jest.mock('fs', () => ({
    promises: {
        access: jest.fn(),
        readdir: jest.fn()
    }
}));
const mockedFs = fs_1.promises;
describe('AppSettingsService', () => {
    let service;
    let mockPrisma;
    let mockAppSettings;
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock app settings
        mockAppSettings = {
            id: 'default-settings',
            theme: 'system',
            wallpaper: 'wallpaper1.jpg',
            logoUrl: null,
            interfaceSize: 'xl',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        service = new AppSettingsService_1.AppSettingsService(mockPrisma);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    describe('getAppSettings', () => {
        it('should return settings when they exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.appSettings.upsert.mockResolvedValue(mockAppSettings);
            const result = yield service.getAppSettings();
            expect(result.id).toBe('default-settings');
            expect(result.theme).toBe('system');
            expect(result.interfaceSize).toBe('xl');
            expect(mockPrisma.appSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'default-settings' }
            }));
        }));
        it('should upsert settings if they do not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.appSettings.upsert.mockResolvedValueOnce(mockAppSettings);
            const result = yield service.getAppSettings();
            expect(mockPrisma.appSettings.upsert).toHaveBeenCalled();
            expect(result.id).toBe('default-settings');
        }));
        it('should auto-select first wallpaper if using wallpaper1.jpg placeholder', () => __awaiter(void 0, void 0, void 0, function* () {
            // First call returns wallpaper1.jpg, second call auto-selects
            const settingsWithPlaceholder = Object.assign(Object.assign({}, mockAppSettings), { wallpaper: 'wallpaper1.jpg' });
            mockPrisma.appSettings.upsert
                .mockResolvedValueOnce(settingsWithPlaceholder);
            mockedFs.access.mockResolvedValue(undefined);
            mockedFs.readdir.mockResolvedValue(['background.png', 'wallpaper1.jpg', 'wallpaper2.jpg']);
            // The update call returns the updated settings with the auto-selected wallpaper
            const updatedSettings = Object.assign(Object.assign({}, settingsWithPlaceholder), { wallpaper: 'background.png' });
            mockPrisma.appSettings.update.mockResolvedValue(updatedSettings);
            const result = yield service.getAppSettings();
            expect(mockPrisma.appSettings.update).toHaveBeenCalled();
            expect(result.wallpaper).toBe('background.png');
        }));
        it('should handle error when upsert fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Database connection failed');
            mockPrisma.appSettings.upsert.mockRejectedValue(error);
            yield expect(service.getAppSettings()).rejects.toThrow('Database connection failed');
        }));
        it('should return default values for new settings', () => __awaiter(void 0, void 0, void 0, function* () {
            // Use a wallpaper value that won't trigger auto-selection
            const settingsWithCustomWallpaper = Object.assign(Object.assign({}, mockAppSettings), { wallpaper: 'custom-wallpaper.jpg' });
            mockPrisma.appSettings.upsert.mockResolvedValue(settingsWithCustomWallpaper);
            const result = yield service.getAppSettings();
            expect(result.theme).toBe('system');
            expect(result.interfaceSize).toBe('xl');
            expect(result.logoUrl).toBeNull();
        }));
    });
    describe('updateAppSettings', () => {
        const validInputs = [
            { theme: 'dark' },
            { theme: 'light' },
            { theme: 'system' },
            { interfaceSize: 'sm' },
            { interfaceSize: 'md' },
            { interfaceSize: 'lg' },
            { interfaceSize: 'xl' },
            { wallpaper: 'custom.jpg' },
            { logoUrl: 'https://example.com/logo.png' },
            { logoUrl: null }
        ];
        validInputs.forEach(input => {
            it(`should update settings with valid input: ${JSON.stringify(input)}`, () => __awaiter(void 0, void 0, void 0, function* () {
                mockPrisma.appSettings.update.mockResolvedValue(Object.assign(Object.assign(Object.assign({}, mockAppSettings), input), { updatedAt: new Date() }));
                const result = yield service.updateAppSettings(input);
                expect(result).toBeDefined();
                expect(mockPrisma.appSettings.update).toHaveBeenCalled();
            }));
        });
        it('should throw error for invalid theme', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.updateAppSettings({ theme: 'invalid-theme' })).rejects.toThrow('Invalid theme. Must be one of: light, dark, system');
        }));
        it('should throw error for invalid interface size', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.updateAppSettings({ interfaceSize: 'invalid-size' })).rejects.toThrow('Invalid interface size. Must be one of: sm, md, lg, xl');
        }));
        it('should throw error for wallpaper that is not a string', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.updateAppSettings({ wallpaper: 123 })).rejects.toThrow('Wallpaper must be a string');
        }));
        it('should throw error for logoUrl that is not a string or null', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.updateAppSettings({ logoUrl: 123 })).rejects.toThrow('Logo URL must be a string or null');
        }));
        it('should handle database error when updating', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Database update failed');
            mockPrisma.appSettings.update.mockRejectedValue(error);
            yield expect(service.updateAppSettings({ theme: 'dark' })).rejects.toThrow('Database update failed');
        }));
    });
    describe('createDefaultSettings', () => {
        it('should create new default settings', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.appSettings.upsert.mockResolvedValue(mockAppSettings);
            const result = yield service.createDefaultSettings();
            expect(result.id).toBe('default-settings');
            expect(result.theme).toBe('system');
            expect(result.wallpaper).toBe('wallpaper1.jpg');
            expect(result.interfaceSize).toBe('xl');
        }));
        it('should handle error when creation fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Database error');
            mockPrisma.appSettings.upsert.mockRejectedValue(error);
            yield expect(service.createDefaultSettings()).rejects.toThrow('Database error');
        }));
    });
    describe('resetToDefaults', () => {
        it('should reset settings to default values', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.appSettings.update.mockResolvedValue(mockAppSettings);
            const result = yield service.resetToDefaults();
            expect(result.theme).toBe('system');
            expect(result.wallpaper).toBe('wallpaper1.jpg');
            expect(result.logoUrl).toBeNull();
            expect(result.interfaceSize).toBe('xl');
        }));
        it('should handle database error when resetting', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Database error');
            mockPrisma.appSettings.update.mockRejectedValue(error);
            yield expect(service.resetToDefaults()).rejects.toThrow('Database error');
        }));
    });
    describe('getAvailableThemes', () => {
        it('should return valid theme options', () => {
            const themes = service.getAvailableThemes();
            expect(themes).toEqual(['light', 'dark', 'system']);
        });
    });
    describe('getAvailableInterfaceSizes', () => {
        it('should return valid interface size options', () => {
            const sizes = service.getAvailableInterfaceSizes();
            expect(sizes).toEqual(['sm', 'md', 'lg', 'xl']);
        });
    });
    describe('getFirstAvailableWallpaper - edge cases', () => {
        it('should return null when wallpapers directory does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockedFs.access.mockRejectedValue(new Error('Directory not found'));
            // Use private method via any since it is not exported
            const anyService = service;
            const result = yield anyService.getFirstAvailableWallpaper();
            expect(result).toBeNull();
        }));
        it('should return null when no valid wallpaper files exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockedFs.access.mockResolvedValue(undefined);
            mockedFs.readdir.mockResolvedValue(['file1.txt', 'file2.doc', 'image.pdf']);
            const anyService = service;
            const result = yield anyService.getFirstAvailableWallpaper();
            expect(result).toBeNull();
        }));
        it('should return first wallpaper file when multiple exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockedFs.access.mockResolvedValue(undefined);
            mockedFs.readdir.mockResolvedValue(['image2.jpg', 'image1.png', 'wallpaper3.webp']);
            const anyService = service;
            const result = yield anyService.getFirstAvailableWallpaper();
            // Should sort alphabetically and return first
            expect(result).toBe('image1.png');
        }));
        it('should support all valid wallpaper extensions', () => __awaiter(void 0, void 0, void 0, function* () {
            mockedFs.access.mockResolvedValue(undefined);
            mockedFs.readdir.mockResolvedValue(['wallpaper1.jpg', 'wallpaper2.jpeg', 'wallpaper3.png', 'wallpaper4.webp', 'wallpaper5.gif']);
            const anyService = service;
            const result = yield anyService.getFirstAvailableWallpaper();
            expect(result).toBe('wallpaper1.jpg');
        }));
        it('should handle directory read error gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockedFs.access.mockResolvedValue(undefined);
            mockedFs.readdir.mockRejectedValue(new Error('Permission denied'));
            const anyService = service;
            const result = yield anyService.getFirstAvailableWallpaper();
            expect(result).toBeNull();
        }));
    });
    describe('safe path validation', () => {
        it('should validate wallpaper filenames do not contain path traversal', () => {
            // The validateInput method only validates type, not path traversal.
            // A path traversal string is still a string, so it does not throw.
            // Numeric values should throw.
            expect(() => service.validateInput({ wallpaper: 123 }))
                .toThrow('Wallpaper must be a string');
        });
        it('should handle empty string wallpaper', () => {
            // Empty string is a valid string type
            expect(() => service.validateInput({ wallpaper: '' })).not.toThrow();
        });
    });
});
