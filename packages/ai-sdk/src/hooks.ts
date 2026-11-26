import { useLayoutEffect, useMemo, useState } from 'react';

import { createAiSdkHost, defaultApprovalOf } from './host';
import type { AiSdkChatLike, AiSdkHost, AiSdkHostOptions } from './host';
import { createWidgetFrameMapper } from './messages';
import type { AiSdkMessageLike, AiSdkWidgetFrame, WidgetFrameMapperOptions } from './messages';

/**
 * The widget frames of a live chat, for `WidgetRenderer`. The mapper is created once per component,
 * so declare `binding` at module level: a binding that changes between renders is not picked up.
 * `known` is read on every render; keep its identity stable (memoise it) so frames are reused.
 */
export function useAiSdkWidgetFrames(
  messages: readonly AiSdkMessageLike[],
  options: WidgetFrameMapperOptions,
): AiSdkWidgetFrame[] {
  const [mapper] = useState(() => createWidgetFrameMapper(options));
  const { known } = options;
  return useMemo(() => mapper.frames(messages, known), [mapper, messages, known]);
}

type HostOptions = Omit<AiSdkHostOptions, 'chat'>;

/**
 * A host whose chat and options can be swapped after creation. A closure rather than a ref, so the
 * component never reads mutable state during render: it only calls `update` from an effect.
 */
function createSwappableHost(
  chat: AiSdkChatLike,
  options: HostOptions,
): { host: AiSdkHost; update: (chat: AiSdkChatLike, options: HostOptions) => void } {
  let latest = { chat, options };
  // Getters, not copies: every member is read from the latest render's chat when it is called.
  const current: AiSdkChatLike = {
    get messages() {
      return latest.chat.messages;
    },
    get sendMessage() {
      return latest.chat.sendMessage;
    },
    get addToolOutput() {
      return latest.chat.addToolOutput;
    },
    get addToolApprovalResponse() {
      return latest.chat.addToolApprovalResponse;
    },
  };
  const host = createAiSdkHost({
    chat: current,
    approvalOf: (response) => (latest.options.approvalOf ?? defaultApprovalOf)(response),
  });
  return {
    host,
    update: (nextChat, nextOptions) => {
      latest = { chat: nextChat, options: nextOptions };
    },
  };
}

/**
 * The AI SDK host members for `WidgetHostProvider`, stable across renders. `useChat()` returns a new
 * object with new `messages` every render; the host reads the latest one when a widget answers.
 */
export function useAiSdkHost(chat: AiSdkChatLike, options: HostOptions = {}): AiSdkHost {
  const [swappable] = useState(() => createSwappableHost(chat, options));
  useLayoutEffect(() => {
    swappable.update(chat, options);
  });
  return swappable.host;
}
