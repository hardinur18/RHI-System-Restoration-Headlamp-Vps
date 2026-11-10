export type PwaUpdateState = { available: boolean; applying: boolean; error: string };

// Each tab owns its consent. Another tab activating a worker must not reload
// this tab's unsaved form. The controller is independent of React and Workbox.
export function createPwaUpdateController(reload: () => void, isOnline: () => boolean, timeoutMs = 15000) {
  let state: PwaUpdateState = { available: false, applying: false, error: '' };
  let activate: (() => Promise<void>) | undefined;
  let activated = false;
  let consent = false;
  let reloaded = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PwaUpdateState) => { state = next; listeners.forEach(listener => listener()); };
  const reloadOnce = () => { if (!reloaded) { reloaded = true; reload(); } };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActivator: (callback: () => Promise<void>) => { activate = callback; },
    available: () => publish({ ...state, available: true }),
    activated: () => {
      clearTimeout(timeout);
      activated = true;
      if (consent) reloadOnce();
      else publish({ available: true, applying: false, error: '' });
    },
    requestReload: () => {
      // A stale chunk needs a reload, but must not interrupt an unsaved form.
      if (!state.available) activated = true;
      publish({ ...state, available: true });
    },
    apply: async () => {
      if (!state.available || state.applying) return;
      if (!isOnline()) {
        publish({ ...state, error: 'Sambungkan internet sebelum memperbarui aplikasi.' });
        return;
      }
      consent = true;
      publish({ available: true, applying: true, error: '' });
      if (activated) { reloadOnce(); return; }
      timeout = setTimeout(() => {
        consent = false;
        publish({ available: true, applying: false, error: 'Pembaruan belum siap. Coba lagi setelah koneksi stabil.' });
      }, timeoutMs);
      try {
        if (!activate) throw new Error('Service worker belum siap');
        await activate();
      } catch {
        clearTimeout(timeout);
        consent = false;
        publish({ available: true, applying: false, error: 'Pembaruan belum berhasil. Coba lagi setelah koneksi stabil.' });
      }
    },
  };
}
