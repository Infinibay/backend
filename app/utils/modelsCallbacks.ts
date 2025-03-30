import { PrismaClient } from '@prisma/client';
import { beforeCreateMachine, afterCreateMachine } from './modelCallbacks/machine';
import { afterCreateDepartment } from './modelCallbacks/department';
import { afterCreateNWfilter } from './modelCallbacks/nwfilter';

class ModelsCallbackManager {
    private callbacks: any = {
        'before': {},
        'after': {}
    }
    private prisma: PrismaClient;
    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    registerCallback(type: 'before' | 'after', action: string, model: any, callback: Function) {
        if (!this.callbacks[type][action]) {
            this.callbacks[type][action] = {};
        }
        this.callbacks[type][action][model] = callback;
    }

    runsBeforeCallback(action: any, model: any, params: any) {
        const type = 'before';
        if (!this.callbacks[type][action]) {
            this.callbacks[type][action] = {};
        }
        if (this.callbacks[type][action][model]) {
            this.callbacks[type][action][model](this.prisma, params);
        }
    }

    runsAfterCallback(action: any, model: any, params: any, result: any) {
        const type = 'after';
        if (!this.callbacks[type][action]) {
            this.callbacks[type][action] = {};
        }
        if (this.callbacks[type][action][model]) {
            this.callbacks[type][action][model](this.prisma, params, result);
        }
    }
}

export default async function installCallbacks(prisma: PrismaClient) {
    const mcbm = new ModelsCallbackManager(prisma);

    mcbm.registerCallback('before', 'create', 'Machine', beforeCreateMachine);
    mcbm.registerCallback('after', 'create', 'Machine', afterCreateMachine);
    mcbm.registerCallback('after', 'create', 'Department', afterCreateDepartment);
    mcbm.registerCallback('after', 'create', 'NWFilter', afterCreateNWfilter);


    // Middleware 1
    prisma.$use(async (params, next) => {

        mcbm.runsBeforeCallback(params.action, params.model, params);
        const result = await next(params)
        mcbm.runsAfterCallback(params.action, params.model, params, result);

        return result;
    });
}