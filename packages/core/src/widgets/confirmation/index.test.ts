import { asAnyWidget, createWidgetRegistry } from '../../registry';
import { validateOptional } from '../../validate';
import { ConfirmationWidget } from './component';
import { confirmationWidget } from './index';

describe('the confirmation registry entry', () => {
  it('registers the component under an exact type@version pair', () => {
    expect(confirmationWidget.type).toBe('confirmation');
    expect(confirmationWidget.version).toBe('1.0.0');
    expect(confirmationWidget.component).toBe(ConfirmationWidget);
  });

  it('places itself in the message slot', () => {
    expect(confirmationWidget.placement).toEqual({ slot: 'message' });
  });

  it('declares the lifecycle of a widget that is answered once and then replayed', () => {
    expect(confirmationWidget.lifecycle).toEqual({
      persist: 'forever',
      expiry: [{ on: 'interact' }],
      afterExpiry: 'snapshot',
    });
  });

  it('opts into nothing it does not need', () => {
    // Absent `acceptsVersion` is what keeps resolution exact (ADR 0009), and absent `migrate`
    // records that 1.0.0 is the first shape there has ever been (ADR 0030). Both are load-bearing
    // omissions, so they are asserted rather than assumed.
    expect(confirmationWidget.acceptsVersion).toBeUndefined();
    expect(confirmationWidget.migrate).toBeUndefined();
    expect(confirmationWidget.reducer).toBeUndefined();
  });

  it('resolves out of a registry at its own version and at no other', () => {
    const registry = createWidgetRegistry([asAnyWidget(confirmationWidget)]);

    expect(registry.get('confirmation', '1.0.0')?.type).toBe('confirmation');
    expect(registry.has('confirmation', '1.0')).toBe(false);
    expect(registry.has('confirmation', '2.0.0')).toBe(false);
  });

  it('carries the schemas the boundary validates against', () => {
    const payload = validateOptional(confirmationWidget.payloadSchema, { title: 'Delete?' });
    const state = validateOptional(confirmationWidget.stateSchema, { decision: 'confirmed' });

    expect(payload).toEqual({ ok: true, value: { title: 'Delete?' } });
    expect(state).toEqual({ ok: true, value: { decision: 'confirmed' } });
  });

  it('degrades a malformed payload into issues rather than throwing', () => {
    const outcome = validateOptional(confirmationWidget.payloadSchema, { description: 'no title' });

    expect(outcome.ok).toBe(false);
  });
});
