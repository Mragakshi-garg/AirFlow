import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';

export interface LoggerConfig {
  serviceName: string;
  level?: string;
  pretty?: boolean;
}

export interface LogContext {
  correlationId?: string;
  userId?: string;
  flightId?: string;
  bookingId?: string;
  [key: string]: unknown;
}

export class Logger {
  private pinoInstance: PinoLogger;
  readonly serviceName: string;

  constructor(config: LoggerConfig) {
    this.serviceName = config.serviceName;

    const options: LoggerOptions = {
      name: config.serviceName,
      level: config.level || process.env.LOG_LEVEL || 'info',
      base: {
        service: config.serviceName,
        env: process.env.NODE_ENV || 'development',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    };

    if (config.pretty || (process.env.NODE_ENV !== 'production' && !process.env.CI)) {
      // Use standard Pino JSON or pretty stream if configured
      this.pinoInstance = pino(options);
    } else {
      this.pinoInstance = pino(options);
    }
  }

  info(message: string, context?: LogContext): void {
    if (context) {
      this.pinoInstance.info(context, message);
    } else {
      this.pinoInstance.info(message);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (context) {
      this.pinoInstance.warn(context, message);
    } else {
      this.pinoInstance.warn(message);
    }
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errObj = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { rawError: error };

    this.pinoInstance.error({ ...context, err: errObj }, message);
  }

  debug(message: string, context?: LogContext): void {
    if (context) {
      this.pinoInstance.debug(context, message);
    } else {
      this.pinoInstance.debug(message);
    }
  }

  child(context: LogContext): Logger {
    const childLogger = Object.create(this);
    childLogger.pinoInstance = this.pinoInstance.child(context);
    return childLogger;
  }
}

export function createLogger(serviceName: string, options?: Partial<LoggerConfig>): Logger {
  return new Logger({
    serviceName,
    level: options?.level || process.env.LOG_LEVEL || 'info',
    pretty: options?.pretty ?? process.env.NODE_ENV !== 'production',
  });
}
