'use client';

import { builtInWidgets, composeRegistries } from '@nerey/core';
import { themeWidgets } from '@nerey/theme';

import { offerWidget } from './widgets/offer/entry';

/**
 * The client registry: core's built-ins, the theme's catalog over them, then the application's own
 * widget (ADR 0010). `contracts.ts` is its server-side mirror.
 */
export const registry = composeRegistries({ override: true }, builtInWidgets, themeWidgets, [offerWidget]);
