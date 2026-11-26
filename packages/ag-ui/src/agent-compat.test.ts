import { describe, expect, it } from 'vitest';

import { HttpAgent } from '@ag-ui/client';

import type { AgUiAgent, AgUiEventSource } from './host';

/**
 * The host takes a structural agent so the adapter does not depend on `@ag-ui/client` (ADR 0054).
 * This file is the proof that the real client still fits: if a client release changes the shape
 * of `addMessage`, `runAgent` or `subscribe`, the type check fails here.
 */
describe('@ag-ui/client compatibility', () => {
  it('accepts an HttpAgent as both the agent and the event source', () => {
    const agent = new HttpAgent({ url: 'http://localhost/agent' });
    const asAgent: AgUiAgent = agent;
    const asSource: AgUiEventSource = agent;
    expect(typeof asAgent.runAgent).toBe('function');
    expect(typeof asSource.subscribe).toBe('function');
  });
});
