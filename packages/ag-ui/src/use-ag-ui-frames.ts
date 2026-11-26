import { useEffect, useSyncExternalStore } from 'react';

import type { AgUiFrame, AgUiTranscript } from './transcript';

/**
 * Subscribes a component to a transcript's frames (ADR 0054).
 *
 * It also owns the one timer the adapter needs: when an unanswered interrupt carries an
 * `expiresAt` still in the future, the transcript is re-judged at that instant, so the widget's
 * envelope gains its expiry marker and core renders it read-only (ADR 0046). The lifecycle runtime
 * cannot schedule this itself, because the deadline comes from the protocol, not from the entry.
 */
export function useAgUiFrames(transcript: AgUiTranscript): readonly AgUiFrame[] {
  const frames = useSyncExternalStore(transcript.subscribe, transcript.getFrames, transcript.getFrames);
  const wait = transcript.msUntilNextDeadline();

  useEffect(() => {
    if (wait === undefined) return;
    const timer = setTimeout(() => {
      transcript.refresh();
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [wait, transcript]);

  return frames;
}
