import type { AnyWidgetContract } from '../types';
import { confirmationContract } from './confirmation/contract';
import { textContract } from './text/contract';

/**
 * The contracts of `builtInWidgets`, in the same order (ADR 0056). A server describes these with
 * `describeRegistry(builtInWidgetContracts, …)`; `catalog.test.ts` holds the two lists together.
 */
export const builtInWidgetContracts: readonly AnyWidgetContract[] = [textContract, confirmationContract];
