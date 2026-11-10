import { registerSW } from 'virtual:pwa-register';
import { createPwaUpdateController } from './pwaUpdateController';

export const pwaUpdates = createPwaUpdateController(
  () => window.location.reload(),
  () => navigator.onLine,
);
let registered = false;

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function shouldCheckForUpdate() {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return false;
  return document.visibilityState === 'visible' && navigator.onLine;
}

export function registerPwaUpdateService() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || registered) return;
  registered = true;

  const checkForUpdate = (registration?: ServiceWorkerRegistration) => {
    if (!registration || !shouldCheckForUpdate()) return;
    void registration.update().catch(() => undefined);
  };

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: pwaUpdates.available,
    onNeedReload: pwaUpdates.activated,
    onRegisteredSW(_swUrl, registration) {
      checkForUpdate(registration);

      window.setInterval(() => {
        checkForUpdate(registration);
      }, UPDATE_CHECK_INTERVAL_MS);

      window.addEventListener('online', () => {
        checkForUpdate(registration);
      });

      document.addEventListener('visibilitychange', () => {
        checkForUpdate(registration);
      });
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('rhi:pwa-offline-ready'));
    },
  });
  pwaUpdates.setActivator(async () => { await updateServiceWorker(true); });
}
