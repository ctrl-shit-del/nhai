import { useEffect, useMemo, useState } from 'react';
import { GUARDEngine } from '../config/GUARDEngine';
import { GUARDConfig } from '../types';

export function useGUARDEngine(config: GUARDConfig) {
  const engine = useMemo(() => new GUARDEngine(config), [config]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    engine
      .initialize()
      .then(() => {
        if (mounted) setIsReady(true);
      })
      .catch((nextError) => {
        if (mounted) setError(nextError);
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
