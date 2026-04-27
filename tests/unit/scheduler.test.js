"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const scheduler_1 = require("@main/lib/scheduler");
describe('CronExpression', () => {
    describe('parsing', () => {
        it('accepts standard 5-field expressions', () => {
            expect(() => new scheduler_1.CronExpression('0 0 * * *')).not.toThrow();
            expect(() => new scheduler_1.CronExpression('*/5 * * * *')).not.toThrow();
            expect(() => new scheduler_1.CronExpression('0 9-17 * * 1-5')).not.toThrow();
            expect(() => new scheduler_1.CronExpression('0,15,30,45 * * * *')).not.toThrow();
        });
        it('rejects invalid expressions', () => {
            expect(() => new scheduler_1.CronExpression('* * * *')).toThrow(/expected 5 fields/);
            expect(() => new scheduler_1.CronExpression('60 * * * *')).toThrow(/out of bounds/);
            expect(() => new scheduler_1.CronExpression('* 24 * * *')).toThrow(/out of bounds/);
            expect(() => new scheduler_1.CronExpression('foo * * * *')).toThrow();
            expect(() => new scheduler_1.CronExpression('*/0 * * * *')).toThrow(/Invalid step/);
        });
        it('treats day-of-week 7 as Sunday', () => {
            const sunday = new Date('2026-01-04T12:00:00Z');
            expect(sunday.getUTCDay()).toBe(0);
            const expr = new scheduler_1.CronExpression('0 12 * * 7');
            expect(expr.matches(new Date('2026-01-04T12:00:00'))).toBe(true);
        });
    });
    describe('matches', () => {
        it('matches exact times', () => {
            const expr = new scheduler_1.CronExpression('30 14 * * *');
            expect(expr.matches(new Date(2026, 0, 1, 14, 30))).toBe(true);
            expect(expr.matches(new Date(2026, 0, 1, 14, 31))).toBe(false);
            expect(expr.matches(new Date(2026, 0, 1, 13, 30))).toBe(false);
        });
        it('honors step values', () => {
            const expr = new scheduler_1.CronExpression('*/15 * * * *');
            expect(expr.matches(new Date(2026, 0, 1, 9, 0))).toBe(true);
            expect(expr.matches(new Date(2026, 0, 1, 9, 15))).toBe(true);
            expect(expr.matches(new Date(2026, 0, 1, 9, 30))).toBe(true);
            expect(expr.matches(new Date(2026, 0, 1, 9, 10))).toBe(false);
        });
        it('ORs dom and dow when both are restricted', () => {
            const expr = new scheduler_1.CronExpression('0 0 1 * 0');
            expect(expr.matches(new Date(2026, 0, 1, 0, 0))).toBe(true); // day 1
            expect(expr.matches(new Date(2026, 0, 4, 0, 0))).toBe(true); // sunday
            expect(expr.matches(new Date(2026, 0, 6, 0, 0))).toBe(false); // tuesday, not 1st
        });
    });
    describe('next', () => {
        it('finds the next match', () => {
            const expr = new scheduler_1.CronExpression('0 3 * * *');
            const from = new Date(2026, 0, 1, 10, 0);
            const next = expr.next(from);
            expect(next.getHours()).toBe(3);
            expect(next.getMinutes()).toBe(0);
            expect(next.getDate()).toBe(2);
        });
        it('advances to next month when needed', () => {
            const expr = new scheduler_1.CronExpression('0 0 15 * *');
            const from = new Date(2026, 0, 20, 0, 0);
            const next = expr.next(from);
            expect(next.getMonth()).toBe(1);
            expect(next.getDate()).toBe(15);
        });
        it('returns a time strictly greater than baseDate even when base matches', () => {
            const expr = new scheduler_1.CronExpression('0 3 * * *');
            const base = new Date(2026, 0, 1, 3, 0);
            const next = expr.next(base);
            expect(next.getTime()).toBeGreaterThan(base.getTime());
        });
    });
});
describe('Scheduler', () => {
    let scheduler;
    beforeEach(() => { scheduler = new scheduler_1.Scheduler({ tickMs: 60000 }); });
    afterEach(() => { scheduler.stop(); });
    it('fires a matching job exactly once per minute', () => {
        const fn = jest.fn();
        scheduler.schedule('* * * * *', fn);
        scheduler.tick(new Date(2026, 0, 1, 12, 0, 0));
        scheduler.tick(new Date(2026, 0, 1, 12, 0, 30));
        expect(fn).toHaveBeenCalledTimes(1);
        scheduler.tick(new Date(2026, 0, 1, 12, 1, 0));
        expect(fn).toHaveBeenCalledTimes(2);
    });
    it('does not fire a non-matching job', () => {
        const fn = jest.fn();
        scheduler.schedule('0 3 * * *', fn);
        scheduler.tick(new Date(2026, 0, 1, 12, 0, 0));
        expect(fn).not.toHaveBeenCalled();
    });
    it('stops firing after handle.stop()', () => {
        const fn = jest.fn();
        const handle = scheduler.schedule('* * * * *', fn);
        handle.stop();
        scheduler.tick(new Date(2026, 0, 1, 12, 0, 0));
        expect(fn).not.toHaveBeenCalled();
    });
    it('isolates failures in one job from others', () => {
        const failing = jest.fn(() => { throw new Error('boom'); });
        const working = jest.fn();
        scheduler.schedule('* * * * *', failing);
        scheduler.schedule('* * * * *', working);
        scheduler.tick(new Date(2026, 0, 1, 12, 0, 0));
        expect(failing).toHaveBeenCalled();
        expect(working).toHaveBeenCalled();
    });
    it('exposes the next run date via the handle', () => {
        const handle = scheduler.schedule('0 3 * * *', () => { });
        const next = handle.getNextRunDate();
        expect(next).toBeDefined();
        expect(new Date(next).getHours()).toBe(3);
    });
});
describe('createScheduleAdapter', () => {
    it('returns a ScheduledJob compatible with infinization', () => {
        const scheduler = new scheduler_1.Scheduler();
        const adapter = (0, scheduler_1.createScheduleAdapter)(scheduler);
        const fn = jest.fn();
        const job = adapter.schedule('* * * * *', fn);
        expect(typeof job.stop).toBe('function');
        expect(typeof job.getNextRunDate).toBe('function');
        expect(job.getNextRunDate()).toBeDefined();
        job.stop();
        scheduler.stop();
    });
});
describe('describeCron', () => {
    it('describes common patterns in plain English', () => {
        expect((0, scheduler_1.describeCron)('0 0 * * *')).toBe('Daily at midnight');
        expect((0, scheduler_1.describeCron)('30 14 * * *')).toBe('Daily at 14:30');
        expect((0, scheduler_1.describeCron)('0 9 * * 1')).toBe('Weekly on Monday at 09:00');
        expect((0, scheduler_1.describeCron)('0 0 15 * *')).toBe('Monthly on day 15 at 00:00');
    });
    it('falls back for non-trivial expressions', () => {
        expect((0, scheduler_1.describeCron)('*/15 * * * *')).toContain('Custom');
    });
    it('flags invalid expressions', () => {
        expect((0, scheduler_1.describeCron)('not a cron')).toBe('Invalid schedule');
    });
});
