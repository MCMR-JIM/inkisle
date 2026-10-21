export interface DesktopWebView {
  postMessage(message: string): void;
  addEventListener(name: 'message', listener: (event: { data: unknown }) => void | Promise<void>): void;
}

/** Native close waits for the same durable save queue used by the browser app. */
export function bindDesktopLifecycle(prepareClose: () => Promise<boolean>, webview = typeof window === 'undefined' ? undefined : (window as Window & { chrome?: { webview?: DesktopWebView } }).chrome?.webview): void {
  if (!webview) return;
  let closing = false;
  webview.addEventListener('message', async event => {
    if (event.data !== 'liubai:prepare-close' || closing) return;
    closing = true;
    try { webview.postMessage(await prepareClose() ? 'liubai:close-ready' : 'liubai:close-blocked'); }
    catch { webview.postMessage('liubai:close-blocked'); }
    finally { closing = false; }
  });
  webview.postMessage('liubai:ready');
}
