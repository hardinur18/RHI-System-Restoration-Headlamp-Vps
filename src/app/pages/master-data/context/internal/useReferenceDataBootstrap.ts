import { useEffect, useRef } from 'react';
import { MASTER_BOOTSTRAP_CONCURRENCY, runSettledWithConcurrency } from './masterDataCache';

type ReferenceBootstrapOptions = {
  enabled: boolean;
  scope: string;
  refreshVersion: number;
  createTasks: (signal: AbortSignal) => Array<() => Promise<unknown>>;
  onLoadingChange: (loading: boolean) => void;
};

// Navigation and changing callback identities must not restart reference data.
// A session/role change or explicit Refresh does; disposal stops queued work.
export function useReferenceDataBootstrap({ enabled, scope, refreshVersion, ...callbacks }: ReferenceBootstrapOptions) {
  const latest = useRef(callbacks);
  latest.current = callbacks;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { createTasks, onLoadingChange } = latest.current;
    onLoadingChange(true);
    // Defer one microtask so StrictMode's discarded mount never starts requests.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      await runSettledWithConcurrency(createTasks(controller.signal), MASTER_BOOTSTRAP_CONCURRENCY, controller.signal);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) console.error('[MasterData] reference bootstrap failed', error);
    }).finally(() => {
      if (!controller.signal.aborted) onLoadingChange(false);
    });
    return () => controller.abort();
  }, [enabled, scope, refreshVersion]);
}
