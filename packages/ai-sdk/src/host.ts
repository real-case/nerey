import type { WidgetHostValue, WidgetResponse } from '@nerey/core';

import { readToolPart } from './messages';
import type { AiSdkMessageLike } from './messages';

/**
 * The widget → AI SDK half of the adapter (ADR 0048 / 0055).
 *
 * `respond` is the only way a widget's answer reaches the model as a tool result. The host never
 * guesses which tool a call belongs to: it finds the part by `toolCallId` in the chat's current
 * messages and reads the name from it.
 */

/**
 * The members of an AI SDK `Chat` (or of `useChat()`'s result) the host calls. Structural, so the
 * `Chat` class from `ai` and the helpers from `@ai-sdk/react` both fit without a cast.
 */
export type AiSdkChatLike = {
  /** Read at call time, so pass an object whose `messages` is current (the `Chat` class is). */
  readonly messages: readonly AiSdkMessageLike[];
  sendMessage: (message: { text: string }) => unknown;
  addToolOutput: (args: { tool: string; toolCallId: string; output: unknown }) => unknown;
  addToolApprovalResponse?: (args: { id: string; approved: boolean }) => unknown;
};

/** The output a widget's answer becomes: what the model reads as the tool's result. */
export type AiSdkToolOutput = { action: string; text: string; result?: unknown };

export type AiSdkHostOptions = {
  chat: AiSdkChatLike;
  /**
   * Decides an approval request from a widget's answer. Defaults to `result.approved` when that is
   * a boolean, and otherwise to `action === 'confirm'` — the built-in confirmation's action name.
   */
  approvalOf?: (response: WidgetResponse) => boolean;
};

export type AiSdkHost = Pick<WidgetHostValue, 'sendUserMessage'> & Required<Pick<WidgetHostValue, 'respond'>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function defaultApprovalOf(response: WidgetResponse): boolean {
  if (isRecord(response.result) && typeof response.result.approved === 'boolean')
    return response.result.approved;
  return response.action === 'confirm';
}

function findToolPart(
  messages: readonly AiSdkMessageLike[],
  toolCallId: string,
): ReturnType<typeof readToolPart> {
  // Newest first: a tool call lives in the latest assistant turn far more often than in history.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    for (const raw of message.parts) {
      const part = readToolPart(raw);
      if (part?.toolCallId === toolCallId) return part;
    }
  }
  return undefined;
}

/**
 * Builds the host members an AI SDK chat implements: spread the result into `WidgetHostProvider`'s
 * value. `sendUserMessage` sends a user turn; `respond` answers the tool call.
 *
 * An answer to a call the chat no longer has (the transcript was replaced under the widget) is sent
 * as a user message instead, so the person's words are not lost.
 */
export function createAiSdkHost(options: AiSdkHostOptions): AiSdkHost {
  const { chat } = options;
  const approvalOf = options.approvalOf ?? defaultApprovalOf;

  const sendUserMessage: AiSdkHost['sendUserMessage'] = (text) => {
    void chat.sendMessage({ text });
  };

  const respond: AiSdkHost['respond'] = (correlationId, response) => {
    const part = findToolPart(chat.messages, correlationId);
    if (!part) {
      sendUserMessage(response.text);
      return;
    }

    if (
      part.state === 'approval-requested' &&
      part.approvalId !== undefined &&
      chat.addToolApprovalResponse
    ) {
      void chat.addToolApprovalResponse({ id: part.approvalId, approved: approvalOf(response) });
      return;
    }

    const output: AiSdkToolOutput = {
      action: response.action,
      text: response.text,
      ...(response.result !== undefined ? { result: response.result } : {}),
    };
    void chat.addToolOutput({ tool: part.toolName, toolCallId: correlationId, output });
  };

  return { sendUserMessage, respond };
}
