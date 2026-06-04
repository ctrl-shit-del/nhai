import { useEffect, useMemo, useState } from 'react';
import { GUARDEngine } from '../config/GUARDEngine';
import type { GuardStorage } from '../storage/GuardStorage';
import { GUARDConfig } from '../types';

export function useGUARDEngine(config: GUARDConfig, storage?: GuardStorage) {
  const engine = useMemo(() => new GUARDEngine(config, storage), [config, storage]);
  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsInitializing(true);
    setIsReady(false);

    console.log('[useGUARDEngine] Starting engine.initialize()…');

    engine
      .initialize()
      .then(() => {
        if (mounted) {
          setIsReady(true);
          setIsInitializing(false);
          console.log('[useGUARDEngine] Engine ready');
        }
      })
      .catch((nextError: unknown) => {
        if (mounted) {
          setIsInitializing(false);
          setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
          console.warn('[useGUARDEngine] initialize() failed', nextError);
        }
      });

    return () => {
      mounted = false;
    };
  }, [engine]);

  return {
    engine,
    isReady,
    isInitializing,
    error,
    stats: engine.getStats(),
  };
}
