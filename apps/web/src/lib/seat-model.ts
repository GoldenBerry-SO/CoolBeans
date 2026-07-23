// ABOUTME: How a product's seat model reads in the console — plain labels over the wire values.
// ABOUTME: The values stay node_locked/floating (the frozen §9 contract); only the words change.

export interface SeatModel {
	/** The wire value the API stores and the frozen contract names. Never shown to a user. */
	value: 'node_locked' | 'floating';
	/** What the console shows instead of the jargon. */
	label: string;
	/** One line under the field explaining what choosing this means. */
	hint: string;
}

export const SEAT_MODELS: readonly SeatModel[] = [
	{
		value: 'node_locked',
		label: 'Per device',
		hint: 'Each seat binds to one machine until you deactivate it.',
	},
	{
		value: 'floating',
		label: 'Concurrent',
		hint: 'Seats are a shared pool; a machine holds one while running, releases it when it stops.',
	},
];

const NODE_LOCKED = SEAT_MODELS[0];

/** The label for a wire value. Falls back to "Per device", the default model. */
export function seatModelLabel(value: string): string {
	return (SEAT_MODELS.find((m) => m.value === value) ?? NODE_LOCKED).label;
}

/** The hint for a wire value. Falls back to the default model's. */
export function seatModelHint(value: string): string {
	return (SEAT_MODELS.find((m) => m.value === value) ?? NODE_LOCKED).hint;
}
