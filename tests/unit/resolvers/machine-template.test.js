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
const resolver_1 = require("@resolvers/machine_template/resolver");
const jest_setup_1 = require("../../setup/jest.setup");
const mock_factories_1 = require("../../setup/mock-factories");
const test_helpers_1 = require("../../setup/test-helpers");
const errors_1 = require("@utils/errors");
const type_1 = require("@graphql/resolvers/machine_template/type");
const pagination_1 = require("@utils/pagination");
describe('MachineTemplateResolver', () => {
    let resolver;
    const ctx = (0, test_helpers_1.createAdminContext)();
    beforeEach(() => {
        resolver = new resolver_1.MachineTemplateResolver();
        jest.clearAllMocks();
    });
    describe('Query: machineTemplate', () => {
        it('should return template by id with totalMachines count', () => __awaiter(void 0, void 0, void 0, function* () {
            const category = (0, mock_factories_1.createMockMachineTemplateCategory)();
            const template = (0, mock_factories_1.createMockMachineTemplate)({ categoryId: category.id });
            const templateWithCategory = Object.assign(Object.assign({}, template), { category });
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(templateWithCategory);
            jest_setup_1.mockPrisma.machine.count.mockResolvedValue(5);
            const result = yield resolver.machineTemplate(template.id, ctx);
            expect(jest_setup_1.mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
                where: { id: template.id },
                include: {
                    category: true
                }
            });
            expect(jest_setup_1.mockPrisma.machine.count).toHaveBeenCalledWith({
                where: { templateId: template.id }
            });
            expect(result).toEqual(Object.assign(Object.assign({}, templateWithCategory), { totalMachines: 5 }));
        }));
        it('should return null if template not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);
            jest_setup_1.mockPrisma.machine.count.mockResolvedValue(0);
            const result = yield resolver.machineTemplate('non-existent-id', ctx);
            expect(result).toBeNull();
        }));
    });
    describe('Query: machineTemplates', () => {
        it('should return all templates with default pagination', () => __awaiter(void 0, void 0, void 0, function* () {
            const templates = Array.from({ length: 5 }, () => (0, mock_factories_1.createMockMachineTemplate)());
            jest_setup_1.mockPrisma.machineTemplate.findMany.mockResolvedValue(templates);
            templates.forEach(() => {
                jest_setup_1.mockPrisma.machine.count.mockResolvedValueOnce(3);
            });
            const result = yield resolver.machineTemplates(undefined, undefined, ctx);
            expect(jest_setup_1.mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
                skip: 0,
                take: 10,
                include: {
                    category: true
                },
                orderBy: undefined
            });
            expect(result).toHaveLength(5);
            result.forEach(template => {
                expect(template).toHaveProperty('totalMachines', 3);
            });
        }));
        it('should apply pagination parameters', () => __awaiter(void 0, void 0, void 0, function* () {
            const templates = Array.from({ length: 3 }, () => (0, mock_factories_1.createMockMachineTemplate)());
            const pagination = { skip: 5, take: 3 };
            jest_setup_1.mockPrisma.machineTemplate.findMany.mockResolvedValue(templates);
            templates.forEach(() => {
                jest_setup_1.mockPrisma.machine.count.mockResolvedValueOnce(2);
            });
            const result = yield resolver.machineTemplates(pagination, undefined, ctx);
            expect(jest_setup_1.mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
                skip: pagination.skip,
                take: pagination.take,
                include: {
                    category: true
                },
                orderBy: undefined
            });
            expect(result).toHaveLength(3);
        }));
        it('should apply custom ordering', () => __awaiter(void 0, void 0, void 0, function* () {
            const templates = Array.from({ length: 5 }, () => (0, mock_factories_1.createMockMachineTemplate)());
            const orderBy = {
                fieldName: type_1.MachineTemplateOrderByEnum.CORES,
                direction: pagination_1.OrderByDirection.DESC
            };
            jest_setup_1.mockPrisma.machineTemplate.findMany.mockResolvedValue(templates);
            templates.forEach(() => {
                jest_setup_1.mockPrisma.machine.count.mockResolvedValueOnce(1);
            });
            const result = yield resolver.machineTemplates(undefined, orderBy, ctx);
            expect(jest_setup_1.mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
                skip: 0,
                take: 10,
                include: {
                    category: true
                },
                orderBy: { cores: pagination_1.OrderByDirection.DESC }
            });
            expect(result).toHaveLength(5);
        }));
        it('should return empty array when no templates exist', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machineTemplate.findMany.mockResolvedValue([]);
            const result = yield resolver.machineTemplates(undefined, undefined, ctx);
            expect(result).toEqual([]);
        }));
    });
    describe('Mutation: createMachineTemplate', () => {
        it('should create a new template', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'New Template',
                description: 'Test template',
                cores: 4,
                ram: 8,
                storage: 100,
                categoryId: 'category-123'
            };
            const createdTemplate = (0, mock_factories_1.createMockMachineTemplate)(input);
            jest_setup_1.mockPrisma.machineTemplate.findFirst.mockResolvedValue(null); // Name doesn't exist
            jest_setup_1.mockPrisma.machineTemplate.create.mockResolvedValue(createdTemplate);
            const result = yield resolver.createMachineTemplate(input, ctx);
            expect(jest_setup_1.mockPrisma.machineTemplate.findFirst).toHaveBeenCalledWith({
                where: { name: input.name }
            });
            expect(jest_setup_1.mockPrisma.machineTemplate.create).toHaveBeenCalledWith({
                data: {
                    name: input.name,
                    description: input.description,
                    cores: input.cores,
                    ram: input.ram,
                    storage: input.storage,
                    categoryId: input.categoryId
                },
                include: {
                    category: true
                }
            });
            expect(result).toEqual(createdTemplate);
        }));
        it('should throw error if template name already exists', () => __awaiter(void 0, void 0, void 0, function* () {
            const existingTemplate = (0, mock_factories_1.createMockMachineTemplate)({ name: 'Existing Template' });
            const input = {
                name: 'Existing Template',
                description: 'Test',
                cores: 2,
                ram: 4,
                storage: 50,
                categoryId: null
            };
            jest_setup_1.mockPrisma.machineTemplate.findFirst.mockResolvedValue(existingTemplate);
            yield expect(resolver.createMachineTemplate(input, ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('should throw error if cores out of range', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Invalid Template',
                description: 'Test',
                cores: 100, // Max is 64
                ram: 8,
                storage: 100,
                categoryId: null
            };
            jest_setup_1.mockPrisma.machineTemplate.findFirst.mockResolvedValue(null);
            yield expect(resolver.createMachineTemplate(input, ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('should throw error if RAM out of range', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Invalid Template',
                description: 'Test',
                cores: 4,
                ram: 600, // Max is 512
                storage: 100,
                categoryId: null
            };
            jest_setup_1.mockPrisma.machineTemplate.findFirst.mockResolvedValue(null);
            yield expect(resolver.createMachineTemplate(input, ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('should throw error if storage out of range', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Invalid Template',
                description: 'Test',
                cores: 4,
                ram: 8,
                storage: 2000, // Max is 1024
                categoryId: null
            };
            jest_setup_1.mockPrisma.machineTemplate.findFirst.mockResolvedValue(null);
            yield expect(resolver.createMachineTemplate(input, ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
    });
    describe('Mutation: updateMachineTemplate', () => {
        it('should update an existing template', () => __awaiter(void 0, void 0, void 0, function* () {
            const templateId = 'template-123';
            const existingTemplate = (0, mock_factories_1.createMockMachineTemplate)({ id: templateId });
            const updateInput = {
                name: 'Updated Template',
                description: 'Updated description',
                cores: 8,
                ram: 16,
                storage: 200,
                categoryId: null
            };
            const updatedTemplate = Object.assign(Object.assign({}, existingTemplate), updateInput);
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(existingTemplate);
            jest_setup_1.mockPrisma.machineTemplate.update.mockResolvedValue(updatedTemplate);
            const result = yield resolver.updateMachineTemplate(templateId, updateInput, ctx);
            expect(jest_setup_1.mockPrisma.machineTemplate.update).toHaveBeenCalledWith({
                where: { id: templateId },
                data: {
                    name: updateInput.name,
                    description: updateInput.description,
                    cores: updateInput.cores,
                    ram: updateInput.ram,
                    storage: updateInput.storage,
                    categoryId: updateInput.categoryId
                },
                include: {
                    category: true
                }
            });
            expect(result).toEqual(updatedTemplate);
        }));
        it('should throw error if template not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);
            const updateInput = {
                name: 'Test',
                description: 'Test',
                cores: 4,
                ram: 8,
                storage: 100,
                categoryId: null
            };
            yield expect(resolver.updateMachineTemplate('non-existent', updateInput, ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
    });
    describe('Mutation: destroyMachineTemplate', () => {
        it('should delete a template without machines', () => __awaiter(void 0, void 0, void 0, function* () {
            const templateId = 'template-123';
            const template = (0, mock_factories_1.createMockMachineTemplate)({ id: templateId });
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
            jest_setup_1.mockPrisma.machine.count.mockResolvedValue(0); // No machines using this template
            jest_setup_1.mockPrisma.machineTemplate.delete.mockResolvedValue(template);
            const result = yield resolver.destroyMachineTemplate(templateId, ctx);
            expect(jest_setup_1.mockPrisma.machineTemplate.delete).toHaveBeenCalledWith({
                where: { id: templateId }
            });
            expect(result).toBe(true);
        }));
        it('should throw error if template not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);
            yield expect(resolver.destroyMachineTemplate('non-existent', ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('should throw error if template has machines', () => __awaiter(void 0, void 0, void 0, function* () {
            const templateId = 'template-123';
            const template = (0, mock_factories_1.createMockMachineTemplate)({ id: templateId });
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
            jest_setup_1.mockPrisma.machine.count.mockResolvedValue(2); // Has machines using this template
            yield expect(resolver.destroyMachineTemplate(templateId, ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
    });
});
