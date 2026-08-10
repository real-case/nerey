import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL's auto-cleanup only registers itself when a global `afterEach` exists at import time,
// which is not guaranteed under `globals: true` with projects. Registering it explicitly is
// cheap insurance against one test's DOM leaking into the next.
afterEach(() => {
  cleanup();
});
