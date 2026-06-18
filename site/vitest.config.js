import { defineConfig } from 'vitest/config';

// Vitest configuration for the XP desktop window manager test suite.
// Uses the happy-dom environment so DOM-driven window-manager logic and
// property-based tests (fast-check) can synthesize PointerEvent / KeyboardEvent.
export default defineConfig({
  test: {
    // happy-dom provides a lightweight DOM (document, window, Pointer/Keyboard events)
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.{js,ts,mjs}', 'tests/**/*.test.{js,ts,mjs}'],
  },
});
