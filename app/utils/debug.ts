import debug from 'debug';

/**
 * Debugger class is a utility for logging debug information.
 * It creates and manages different debug instances based on the module and subDebug provided.
 * 
 * Example usage:
 * const debugger = new Debugger('module1');
 * debugger.log('Hello World'); // logs to the 'default' debug instance
 * debugger.log('errror', 'Hello World'); // logs to the 'module1:error' debug instance
 */
export class Debugger {
  private debuggers: { [key: string]: debug.Debugger } = {};

  constructor(private module: string) {
      this.debuggers['default'] = debug('infinibay:' + module);
  }

  public log(...args: string[]) {
      if (args.length === 1) {
          // If there is only one argument, log to the default debug
          this.debuggers['default'](args[0]);
      } else if (args.length === 2) {
          // If there are two arguments, log to the specified debug
          const [subDebug, message] = args;
          if (!this.debuggers[subDebug]) {
              this.debuggers[subDebug] = debug(`${this.module}:${subDebug}`);
          }
          this.debuggers[subDebug](message);
      }
  }
}

