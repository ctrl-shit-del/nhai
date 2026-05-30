import { useEffect, useMemo, useState } from 'react';
import { GUARDEngine } from '../config/GUARDEngine';
import type { GuardStorage } from '../storage/GuardStorage';
import { GUARDConfig } from '../types';

export function useGUARDEngine(config: GUARDConfig, storage?: GuardStorage) {
  const engine = useMemo(() => new GUARDEngine(config, storage), [config, storage]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    engine
      .initialize()
      .then(() => {
        if (mounted) setIsReady(true);
      })
      .catch((nextError: unknown) => {
        if (mounted) {
          setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
        }
      });

    return () => {
      mounted = false;
    };
  }, [engine]);

  return {
    engine,
    isReady,
    error,
    stats: engine.getStats()
  };
}
