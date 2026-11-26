import { resetStore } from '../../../lib/store';

/** Puts the conversation back to its seed. The smoke test calls it first, so reruns start clean. */
export function POST(): Response {
  resetStore();
  return new Response(null, { status: 204 });
}
