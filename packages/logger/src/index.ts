// ABOUTME: Structured logger for Cool Beans — leveled, contextual, zero dependencies.
// ABOUTME: Emits JSON lines through a pluggable sink so it runs identically on Node and Workers.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
	level: LogLevel;
	message: string;
	time: string;
	[key: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
	level?: LogLevel;
	sink?: LogSink;
	context?: Record<string, unknown>;
}

export interface Logger {
	debug(message: string, fields?: Record<string, unknown>): void;
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
	child(context: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const consoleSink: LogSink = (record) => {
	const line = JSON.stringify(record);
	if (record.level === 'error') {
		console.error(line);
	} else if (record.level === 'warn') {
		console.warn(line);
	} else {
		console.log(line);
	}
};

export function createLogger(options: LoggerOptions = {}): Logger {
	const { level = 'info', sink = consoleSink, context = {} } = options;
	const threshold = LEVEL_ORDER[level];

	const emit = (recordLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
		if (LEVEL_ORDER[recordLevel] < threshold) {
			return;
		}
		sink({ ...context, ...fields, level: recordLevel, message, time: new Date().toISOString() });
	};

	return {
		debug: (message, fields) => emit('debug', message, fields),
		info: (message, fields) => emit('info', message, fields),
		warn: (message, fields) => emit('warn', message, fields),
		error: (message, fields) => emit('error', message, fields),
		child: (childContext) =>
			createLogger({ level, sink, context: { ...context, ...childContext } }),
	};
}
