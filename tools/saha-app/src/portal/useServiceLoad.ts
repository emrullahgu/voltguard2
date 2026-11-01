import { useCallback, useRef, useState } from 'react';

type Work = () => Promise<unknown>;

// A service screen must distinguish a failed read from an empty successful
// result. Retry checks the last read only; failed business actions are never
// retained, replayed, or converted to a successful empty dataset.
export function useServiceLoad() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastRead = useRef<Work | null>(null);
  const run = useCallback(async (work: Work) => {
    setLoading(true); setError(null);
    try { await work(); }
    catch (cause: any) { setError(cause?.message || 'Servis işlemi tamamlanamadı. Yeniden kontrol edin.'); }
    finally { setLoading(false); }
  }, []);
  const read = useCallback((work: Work) => { lastRead.current = work; return run(work); }, [run]);
  const action = useCallback((work: Work) => run(work), [run]);
  const retry = useCallback(() => lastRead.current ? read(lastRead.current) : Promise.resolve(), [read]);
  return { loading, error, read, action, retry };
}
