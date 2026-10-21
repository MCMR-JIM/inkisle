import './ui/styles.css';
import { App } from './app';
import { bindDesktopLifecycle } from './desktop';

const app = new App(document.querySelector('#app')!);
bindDesktopLifecycle(() => app.prepareClose());
const diagnostics = Object.freeze({ diagnostics: () => app.diagnostics() });
Object.defineProperty(window, 'inkisle', { value: diagnostics, writable: false });
// Existing integrations can keep querying the former diagnostic alias.
Object.defineProperty(window, 'liubai', { value: diagnostics, writable: false });
