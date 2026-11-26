import type { AiSdkChatLike } from '../host';
import type { AiSdkMessageLike } from '../messages';

/**
 * A recording stand-in for an AI SDK `Chat`: the same members the host calls, applying an answer to
 * the transcript the way the SDK does (the part moves to `output-available` or
 * `approval-responded`), with no network and no model.
 */

export type ToolPartFixture = {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  toolName?: string;
  approval?: { id: string; approved?: boolean };
};

export const CREATED_AT = 1_767_225_600_000; // 2026-01-01T00:00:00Z

export function assistant(
  id: string,
  parts: readonly unknown[],
  metadata: unknown = { createdAt: CREATED_AT },
): AiSdkMessageLike {
  return { id, role: 'assistant', metadata, parts };
}

export function toolPart(fixture: ToolPartFixture): ToolPartFixture {
  return fixture;
}

export type RecordingChat = AiSdkChatLike & {
  messages: AiSdkMessageLike[];
  sent: { text: string }[];
  outputs: { tool: string; toolCallId: string; output: unknown }[];
  approvals: { id: string; approved: boolean }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapPart(
  messages: AiSdkMessageLike[],
  toolCallId: string,
  update: (part: Record<string, unknown>) => Record<string, unknown>,
): AiSdkMessageLike[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      isRecord(part) && part.toolCallId === toolCallId ? update(part) : part,
    ),
  }));
}

export function createRecordingChat(initial: AiSdkMessageLike[] = []): RecordingChat {
  const chat: RecordingChat = {
    messages: initial,
    sent: [],
    outputs: [],
    approvals: [],
    sendMessage: (message) => {
      chat.sent.push(message);
    },
    addToolOutput: (args) => {
      chat.outputs.push(args);
      chat.messages = mapPart(chat.messages, args.toolCallId, (part) => ({
        ...part,
        state: 'output-available',
        output: args.output,
      }));
    },
    addToolApprovalResponse: (args) => {
      chat.approvals.push(args);
      chat.messages = chat.messages.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          isRecord(part) && isRecord(part.approval) && part.approval.id === args.id
            ? {
                ...part,
                state: 'approval-responded',
                approval: { ...part.approval, approved: args.approved },
              }
            : part,
        ),
      }));
    },
  };
  return chat;
}
