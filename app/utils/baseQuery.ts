import jwt from 'jsonwebtoken'

export interface BaseQuery {
    before(root: any, input: any, context: any, info: any): Promise<any>;
    after(root: any, input: any, context: any, info: any): Promise<any>;
    result(root: any, input: any, context: any, info: any): Promise<any>;
}

export class BaseQuery {
    public before(root: any, input: any, context: any, info: any): Promise<any> {
        return Promise.resolve(undefined);
    }

    public after(root: any, input: any, context: any, info: any): Promise<any> {
        return Promise.resolve(undefined);
    }

    public result(root: any, input: any, context: any, info: any): Promise<any> {
        return Promise.resolve(undefined);
    }

    public async call(root: any, input: any, context: any, info: any): Promise<any> {
        await this.before(root, input, context, info);
        const result = await this.result(root, input, context, info);
        await this.after(root, input, context, info);
        return result;
    }
}
