// ABOUTME: Tests for the structured logger — levels, context binding, and output shape.
// ABOUTME: Captures the sink instead of console so test output stays pristine.

import { describe, expect, it } from 'vitest';
import { createLogger, type LogRecord } from './index.js';

function capture() {
	const records: LogRecord[] = [];
	return { records, sink: (record: LogRecord) => records.push(record) };
}

describe('createLogger', () => {
	it('emits structured records with level, message, and timestamp', () => {
		const { records, sink } = capture();
		const log = createLogger({ sink });
		log.info('server started', { port: 3000 });
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ level: 'info', message: 'server started', port: 3000 });
		expect(typeof records[0]?.time).toBe('string');
	});

	it('filters records below the configured level', () => {
		const { records, sink } = capture();
		const log = createLogger({ sink, level: 'warn' });
		log.debug('noise');
		log.info('noise');
		log.warn('kept');
		log.error('kept');
		expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
	});

	it('binds context onto child loggers', () => {
		const { records, sink } = capture();
		const log = createLogger({ sink }).child({ product: 'clementine' });
		log.info('key issued', { tier: 'yearly' });
		expect(records[0]).toMatchObject({
			message: 'key issued',
			product: 'clementine',
			tier: 'yearly',
		});
	});

	it('lets record fields win over child context on collision', () => {
		const { records, sink } = capture();
		const log = createLogger({ sink }).child({ tier: 'lifetime' });
		log.info('override', { tier: 'trial' });
		expect(records[0]?.tier).toBe('trial');
	});
});
