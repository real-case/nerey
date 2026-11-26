import { act, renderHook } from '@testing-library/react';

import { assistant, createRecordingChat } from './__fixtures__/chat';
import { useAiSdkHost, useAiSdkWidgetFrames } from './hooks';
import { createAiSdkHost, defaultApprovalOf } from './host';

function chatWith(part: Record<string, unknown>) {
  return createRecordingChat([assistant('turn', [part])]);
}

const answer = { action: 'submit', text: 'a — A', result: { selected: 'a' } };

describe('createAiSdkHost', () => {
  it('answers a static tool call through addToolOutput, naming the tool from the part', () => {
    const chat = chatWith({
      type: 'tool-render_widget',
      toolCallId: 'c1',
      state: 'input-available',
      input: {},
    });
    createAiSdkHost({ chat }).respond('c1', answer);
    expect(chat.outputs).toEqual([
      {
        tool: 'render_widget',
        toolCallId: 'c1',
        output: { action: 'submit', text: 'a — A', result: { selected: 'a' } },
      },
    ]);
    expect(chat.sent).toEqual([]);
  });

  it('names a dynamic tool from its toolName', () => {
    const chat = chatWith({
      type: 'dynamic-tool',
      toolName: 'ask',
      toolCallId: 'c1',
      state: 'input-available',
    });
    createAiSdkHost({ chat }).respond('c1', { action: 'submit', text: 'ok' });
    expect(chat.outputs[0]).toEqual({
      tool: 'ask',
      toolCallId: 'c1',
      output: { action: 'submit', text: 'ok' },
    });
  });

  it('answers an approval request through addToolApprovalResponse', () => {
    const chat = chatWith({
      type: 'tool-delete_file',
      toolCallId: 'c1',
      state: 'approval-requested',
      input: {},
      approval: { id: 'ap-1' },
    });
    createAiSdkHost({ chat }).respond('c1', { action: 'confirm', text: 'Delete' });
    expect(chat.approvals).toEqual([{ id: 'ap-1', approved: true }]);
    expect(chat.outputs).toEqual([]);
  });

  it('uses approvalOf when given', () => {
    const chat = chatWith({
      type: 'tool-x',
      toolCallId: 'c1',
      state: 'approval-requested',
      approval: { id: 'ap-1' },
    });
    createAiSdkHost({ chat, approvalOf: (response) => response.action === 'yes' }).respond('c1', {
      action: 'yes',
      text: 'Yes',
    });
    expect(chat.approvals).toEqual([{ id: 'ap-1', approved: true }]);
  });

  it('falls back to addToolOutput when the chat cannot answer approvals', () => {
    const chat = chatWith({
      type: 'tool-x',
      toolCallId: 'c1',
      state: 'approval-requested',
      approval: { id: 'a' },
    });
    delete chat.addToolApprovalResponse;
    createAiSdkHost({ chat }).respond('c1', { action: 'confirm', text: 'OK' });
    expect(chat.outputs).toHaveLength(1);
  });

  it('sends the words as a user message when the call is gone, so they are not lost', () => {
    const chat = createRecordingChat([]);
    createAiSdkHost({ chat }).respond('missing', answer);
    expect(chat.sent).toEqual([{ text: 'a — A' }]);
  });

  it('finds the newest occurrence of a call id', () => {
    const chat = createRecordingChat([
      assistant('old', [{ type: 'tool-old', toolCallId: 'c1', state: 'output-available' }]),
      assistant('new', [{ type: 'tool-new', toolCallId: 'c1', state: 'input-available' }]),
    ]);
    createAiSdkHost({ chat }).respond('c1', answer);
    expect(chat.outputs[0]?.tool).toBe('new');
  });

  it('sends a user message through sendMessage', () => {
    const chat = createRecordingChat();
    createAiSdkHost({ chat }).sendUserMessage('hello');
    expect(chat.sent).toEqual([{ text: 'hello' }]);
  });
});

describe('defaultApprovalOf', () => {
  it.each([
    [{ action: 'confirm', text: '' }, true],
    [{ action: 'cancel', text: '' }, false],
    [{ action: 'cancel', text: '', result: { approved: true } }, true],
    [{ action: 'confirm', text: '', result: { approved: false } }, false],
    [{ action: 'confirm', text: '', result: { approved: 'yes' } }, true],
  ])('%j → %s', (response, approved) => {
    expect(defaultApprovalOf(response)).toBe(approved);
  });
});

describe('useAiSdkHost', () => {
  it('is stable across renders and answers against the latest chat', () => {
    const first = chatWith({ type: 'tool-a', toolCallId: 'c1', state: 'input-available' });
    const second = chatWith({ type: 'tool-b', toolCallId: 'c1', state: 'input-available' });
    const { result, rerender } = renderHook(({ chat }) => useAiSdkHost(chat), {
      initialProps: { chat: first },
    });
    const host = result.current;
    rerender({ chat: second });
    expect(result.current).toBe(host);
    act(() => {
      result.current.respond('c1', answer);
      result.current.sendUserMessage('hi');
    });
    expect(first.outputs).toEqual([]);
    expect(second.outputs[0]?.tool).toBe('b');
    expect(second.sent).toEqual([{ text: 'hi' }]);
  });

  it('reads the latest approvalOf', () => {
    const chat = chatWith({
      type: 'tool-x',
      toolCallId: 'c1',
      state: 'approval-requested',
      approval: { id: 'a' },
    });
    const { result, rerender } = renderHook(
      ({ approve }) => useAiSdkHost(chat, { approvalOf: () => approve }),
      {
        initialProps: { approve: true },
      },
    );
    rerender({ approve: false });
    result.current.respond('c1', { action: 'confirm', text: '' });
    expect(chat.approvals).toEqual([{ id: 'a', approved: false }]);
  });
});

describe('useAiSdkWidgetFrames', () => {
  it('maps messages and keeps an unchanged frame across renders', () => {
    const part = {
      type: 'tool-render_widget',
      toolCallId: 'c1',
      state: 'input-available',
      input: { type: 'x', version: '1' },
    };
    const { result, rerender } = renderHook(
      ({ messages }) => useAiSdkWidgetFrames(messages, { binding: { mode: 'render-widget' } }),
      { initialProps: { messages: [assistant('t', [part])] } },
    );
    const before = result.current[0];
    rerender({ messages: [assistant('t', [{ ...part }])] });
    expect(result.current[0]).toBe(before);
  });
});
