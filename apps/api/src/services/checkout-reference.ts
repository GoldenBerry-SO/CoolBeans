// ABOUTME: Recognizes a namespaced opaque checkout attempt without retaining arbitrary provider reference text.
// ABOUTME: Invalid or absent references remain unlinked and never prevent paid licence issuance.
export function checkoutAttemptId(value: unknown): string | null {
	return typeof value === 'string' &&
		value.length === 48 &&
		/^gb_checkout_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
		? value.toLowerCase()
		: null;
}
