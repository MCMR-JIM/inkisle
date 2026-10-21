import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDesktopLifecycle, type DesktopWebView } from '../../src/desktop';

afterEach(() => vi.unstubAllGlobals());

function bridge(): DesktopWebView & { receive: (data: unknown) => Promise<void>; messages: unknown[] } {
  let listener: (event: { data: unknown }) => void | Promise<void> = () => {};
  const messages: unknown[] = [];
  return { messages, postMessage: message => { messages.push(message); }, addEventListener: (_name, handler) => { listener = handler; }, receive: async data => { await listener({ data }); } };
}

describe('native desktop save-before-close', () => {
  it('keeps the window open until asynchronous saves complete and coalesces repeated requests', async () => {
    const view = bridge(); let finish: (ok: boolean) => void = () => {};
    const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    bindDesktopLifecycle(save, view);
    const closing = view.receive('liubai:prepare-close');
    await view.receive('liubai:prepare-close');
    expect(save).toHaveBeenCalledTimes(1); expect(view.messages).toEqual(['liubai:ready']);
    finish(true); await closing;
    expect(view.messages).toEqual(['liubai:ready', 'liubai:close-ready']);
  });

  it('reports failed saves instead of acknowledging close and permits a later retry', async () => {
    const view = bridge(); let succeeds = false;
    bindDesktopLifecycle(async () => succeeds, view);
    await view.receive('unrelated'); await view.receive('liubai:prepare-close');
    expect(view.messages).toEqual(['liubai:ready', 'liubai:close-blocked']);
    succeeds = true; await view.receive('liubai:prepare-close');
    expect(view.messages.at(-1)).toBe('liubai:close-ready');
  });

  it('reports thrown flush errors without an unhandled rejection', async () => {
    const view = bridge(); bindDesktopLifecycle(async () => { throw new Error('disk full'); }, view);
    await view.receive('liubai:prepare-close'); expect(view.messages.at(-1)).toBe('liubai:close-blocked');
  });

  it('leaves ordinary browser startup functional without a native bridge', () => {
    vi.stubGlobal('window', {}); expect(() => bindDesktopLifecycle(async () => true)).not.toThrow();
  });
});
