"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const globals_1 = require("@jest/globals");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
(0, globals_1.describe)('GraphQL Schema Validation', () => {
    const schemaPath = path_1.default.resolve(__dirname, '../app/schema.graphql');
    let schemaContent;
    beforeAll(() => {
        schemaContent = (0, fs_1.readFileSync)(schemaPath, 'utf-8');
    });
    (0, globals_1.describe)('Required Queries', () => {
        (0, globals_1.it)('should contain getVMRecommendations query', () => {
            (0, globals_1.expect)(schemaContent).toContain('getVMRecommendations(');
        });
        (0, globals_1.it)('should contain VMRecommendationType definition', () => {
            (0, globals_1.expect)(schemaContent).toContain('type VMRecommendationType');
        });
        (0, globals_1.it)('should contain RecommendationType enum', () => {
            (0, globals_1.expect)(schemaContent).toContain('enum RecommendationType');
        });
        (0, globals_1.it)('should contain RecommendationFilterInput', () => {
            (0, globals_1.expect)(schemaContent).toContain('input RecommendationFilterInput');
        });
    });
    (0, globals_1.describe)('Query Structure Validation', () => {
        (0, globals_1.it)('should have properly structured getVMRecommendations query', () => {
            const queryMatch = schemaContent.match(/getVMRecommendations\([^)]+\): \[VMRecommendationType!\]!/);
            (0, globals_1.expect)(queryMatch).toBeTruthy();
        });
        (0, globals_1.it)('should include required parameters for getVMRecommendations', () => {
            const querySection = schemaContent.substring(schemaContent.indexOf('getVMRecommendations('), schemaContent.indexOf('): [VMRecommendationType!]!'));
            (0, globals_1.expect)(querySection).toContain('vmId: ID!');
            (0, globals_1.expect)(querySection).toContain('refresh: Boolean');
            (0, globals_1.expect)(querySection).toContain('filter: RecommendationFilterInput');
        });
    });
    (0, globals_1.describe)('Type Completeness', () => {
        (0, globals_1.it)('should have all required VMRecommendationType fields', () => {
            const typeSection = schemaContent.substring(schemaContent.indexOf('type VMRecommendationType'), schemaContent.indexOf('}', schemaContent.indexOf('type VMRecommendationType')));
            const requiredFields = ['id: ID!', 'machineId: ID!', 'type: RecommendationType!', 'text: String!', 'actionText: String!', 'createdAt: DateTimeISO!'];
            requiredFields.forEach(field => {
                (0, globals_1.expect)(typeSection).toContain(field);
            });
        });
        (0, globals_1.it)('should have all RecommendationType enum values', () => {
            const enumSection = schemaContent.substring(schemaContent.indexOf('enum RecommendationType'), schemaContent.indexOf('}', schemaContent.indexOf('enum RecommendationType')));
            const requiredEnumValues = [
                'DISK_SPACE_LOW',
                'OVER_PROVISIONED',
                'UNDER_PROVISIONED',
                'OS_UPDATE_AVAILABLE',
                'APP_UPDATE_AVAILABLE',
                'DEFENDER_DISABLED',
                'DEFENDER_THREAT',
                'HIGH_CPU_APP',
                'HIGH_RAM_APP',
                'PORT_BLOCKED',
                'OTHER'
            ];
            requiredEnumValues.forEach(enumValue => {
                (0, globals_1.expect)(enumSection).toContain(enumValue);
            });
        });
    });
    (0, globals_1.describe)('Documentation Presence', () => {
        (0, globals_1.it)('should have query documentation', () => {
            const queryDocPattern = /"""[^"]*Get automated recommendations[^"]*"""/;
            (0, globals_1.expect)(schemaContent).toMatch(queryDocPattern);
        });
        (0, globals_1.it)('should have enum documentation', () => {
            const enumDocPattern = /"""[^"]*Types of VM recommendations[^"]*"""/;
            (0, globals_1.expect)(schemaContent).toMatch(enumDocPattern);
        });
        (0, globals_1.it)('should have type documentation', () => {
            const typeDocPattern = /"""[^"]*automated recommendation[^"]*"""/;
            (0, globals_1.expect)(schemaContent).toMatch(typeDocPattern);
        });
    });
});
