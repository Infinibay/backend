import { PrismaClient } from '@prisma/client';
import { beforeCreateMachine, afterCreateMachine } from './modelCallbacks/machine';

const prisma = new PrismaClient();

class ModelsCallbackManager {
    private callbacks:any = {
            'before': {},
            'after': {}
        }
    private prisma: PrismaClient;
    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    registerCallback(type: 'before' | 'after', action: string, model, callback: Function) {
        if (!this.callbacks[type][action]) {
            this.callbacks[type][action] = {};
        }
        this.callbacks[type][action][model] = callback;
    }

    runsBeforeCallback(action, model, params) {
        const type = 'before';
        if (!this.callbacks[type][action]) {
            this.callbacks[type][action] = {};
        }
        if (this.callbacks[type][action][model]) {
            this.callbacks[type][action][model](params);
        }
    }

    runsAfterCallback(action, model, params, result) {
        const type = 'after';
        if (!this.callbacks[type][action]) {
            this.callbacks[type][action] = {};
        }
        if (this.callbacks[type][action][model]) {
            this.callbacks[type][action][model](params, result);
        }
    }
}

const mcbm = new ModelsCallbackManager(prisma);

mcbm.registerCallback('before', 'create', 'Machine', beforeCreateMachine);
mcbm.registerCallback('after', 'create', 'Machine', afterCreateMachine);

// Middleware 1
prisma.$use(async (params, next) => {

    mcbm.runsBeforeCallback(params.action, params.model, params);
    const result = await next(params)
    mcbm.runsAfterCallback(params.action, params.model, params, result);

    return result;
});