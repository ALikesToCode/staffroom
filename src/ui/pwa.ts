import { useEffect, useState } from 'react';

// The installable app: the browser's own install prompt, and the notice that a newer version is waiting.
// Nothing here runs while the page is rendered on a server or in a test: both hooks act in effects only.

/** The event Chrome raises when the page can be installed. It is not in the standard DOM types. */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Offers "Install" once the browser says the page can be installed. Undefined until then, and after it was used. */
export function useInstall(): (() => void) | undefined {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keep the browser's own banner back: the page offers its own small button.
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  if (!event) return undefined;
  return () => {
    void event.prompt();
    void event.userChoice.finally(() => setEvent(null));
  };
}

type Reload = () => void;
let waiting: Reload | null = null;
const listeners = new Set<(reload: Reload | null) => void>();

/** Called by the service worker registration when a newer version has been fetched and is waiting. */
export function announceUpdate(reload: Reload): void {
  waiting = reload;
  for (const l of listeners) l(waiting);
}

/** The action that loads the waiting version, once there is one. The page is never reloaded without a click. */
export function useUpdate(): { reload?: Reload; dismiss: () => void } {
  const [reload, setReload] = useState<Reload | null>(null);
  useEffect(() => {
    const on = (r: Reload | null) => setReload(() => r);
    listeners.add(on);
    on(waiting);
    return () => {
      listeners.delete(on);
    };
  }, []);
  return { reload: reload ?? undefined, dismiss: () => setReload(null) };
}
