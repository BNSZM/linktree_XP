import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Smoke test verifying the test infrastructure is wired up correctly:
// - vitest runs under the happy-dom environment (document / window available)
// - fast-check is available for property-based testing
// - PointerEvent and KeyboardEvent can be synthesized and dispatched in happy-dom
describe('test infrastructure smoke test', () => {
  it('runs in a DOM environment', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });

  it('can synthesize and dispatch a PointerEvent', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    let received = null;
    el.addEventListener('pointerdown', (e) => {
      received = e;
    });

    const evt = new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: 42,
      clientY: 17,
    });
    el.dispatchEvent(evt);

    expect(received).not.toBeNull();
    expect(received.type).toBe('pointerdown');
    expect(received.clientX).toBe(42);
    expect(received.clientY).toBe(17);

    el.remove();
  });

  it('can synthesize and dispatch a KeyboardEvent', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    let received = null;
    el.addEventListener('keydown', (e) => {
      received = e;
    });

    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    el.dispatchEvent(evt);

    expect(received).not.toBeNull();
    expect(received.type).toBe('keydown');
    expect(received.key).toBe('Escape');

    el.remove();
  });

  it('runs a fast-check property over arbitrary integers', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 }
    );
  });
});
