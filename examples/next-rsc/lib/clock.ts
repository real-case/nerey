/**
 * The example's only clock (production-ready plan, step 5.3). Every timestamp the scripted stream
 * writes and every lifecycle decision the client makes reads this, so a server render, the
 * hydrating client and the smoke test agree on what "now" is without anyone calling `Date.now()`.
 *
 * A real application passes its own clock to `host.now`; what matters is that the server and the
 * client read the same one (ADR 0046).
 */
export const SCRIPTED_NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

export const now = (): number => SCRIPTED_NOW;
