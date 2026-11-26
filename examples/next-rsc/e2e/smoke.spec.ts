import { expect, test } from '@playwright/test';
import type { APIRequestContext, ConsoleMessage, Page } from '@playwright/test';

/**
 * The checks the production-ready plan names for job `examples` (step 5.4), against the built app
 * installed from tarballs:
 *
 *   1. the server describes the registry (`@nerey/core/server` works in an RSC);
 *   2. a widget renders, and the page hydrates with no mismatch and no error;
 *   3. a `timeout` widget whose deadline passed arrives from the server render already expired;
 *   4. a widget's answer goes back as the tool call's output (`respond` → `addToolOutput`);
 *   5. a reload keeps the answered widget read-only, from the first frame.
 *
 * Time is the app's scripted clock, never the test's.
 */

const pollRoot = '[data-nerey-widget="poll"]';
const offerRoot = '[data-nerey-widget="offer"]';

/** Fails the test on any console error or uncaught exception — a hydration mismatch is one. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** The server-rendered HTML, before any script runs. */
async function serverHtml(request: APIRequestContext): Promise<string> {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  return response.text();
}

/** The opening tag of a widget root in raw HTML, or undefined. */
function rootTag(html: string, type: string): string | undefined {
  return new RegExp(`<div[^>]*data-nerey-widget="${type}"[^>]*>`).exec(html)?.[0];
}

test.beforeEach(async ({ request }) => {
  const reset = await request.post('/api/reset');
  expect(reset.status()).toBe(204);
});

test('server describe, SSR expiry, hydration, reply through addToolOutput, reload', async ({
  page,
  request,
}) => {
  // 1 + 3: straight from the server, no JavaScript.
  const first = await serverHtml(request);
  expect(first).toContain('poll@1.0.0');
  expect(first).toContain('offer@1.0.0');
  const offerTag = rootTag(first, 'offer');
  expect(offerTag, 'the seeded offer renders on the server').toBeDefined();
  expect(offerTag).toContain('data-readonly');

  // 2: hydrate and stay quiet.
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator(offerRoot)).toHaveAttribute('data-readonly', '');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();

  // The scripted model answers with a poll, streamed.
  await page.getByRole('button', { name: 'Send' }).click();
  const poll = page.locator(pollRoot);
  await expect(poll).toHaveAttribute('data-nerey-status', 'ready');
  await expect(poll).not.toHaveAttribute('data-readonly', '');

  // 4: the answer leaves as the tool call's output, and the model's reply comes back.
  const answered = page.waitForRequest(
    (req) => req.url().endsWith('/api/chat') && (req.postData() ?? '').includes('"output-available"'),
  );
  await poll.getByRole('radio', { name: 'Beta' }).check();
  await poll.getByRole('button', { name: 'Submit' }).click();
  const sent = await answered;
  const body = JSON.parse(sent.postData() ?? '{}') as { messages: { parts: Record<string, unknown>[] }[] };
  const toolPart = body.messages.flatMap((m) => m.parts).find((p) => p.type === 'tool-ask_poll');
  expect(toolPart?.state).toBe('output-available');
  expect(JSON.stringify(toolPart?.output)).toContain('Beta');

  await expect(page.getByText('Noted — shipping per your answer:')).toBeVisible();
  await expect(poll).toHaveAttribute('data-readonly', '');
  // The stream has finished, so the server has stored the turn the reload is about to read.
  await expect(page.locator('[data-chat-status]')).toHaveAttribute('data-chat-status', 'ready');

  // 5: reload. Read-only in the server HTML, and still read-only once hydrated.
  const reloadedHtml = await serverHtml(request);
  expect(rootTag(reloadedHtml, 'poll')).toContain('data-readonly');
  await page.reload();
  await expect(page.locator(pollRoot)).toHaveAttribute('data-readonly', '');
  await expect(page.getByText('Noted — shipping per your answer:')).toBeVisible();

  expect(errors, 'console errors (a hydration mismatch is reported here)').toEqual([]);
});
