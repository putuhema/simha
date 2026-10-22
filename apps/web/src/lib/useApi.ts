import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api.ts";

/**
 * GETs `path` (null = skip) and keeps the result. `reload()` fetches again
 * without clearing the old data; `refreshMs` polls.
 */
export const useApi = <A>(path: string | null, options: { readonly refreshMs?: number } = {}) => {
  const [data, setData] = useState<A | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const latest = useRef(path);
  latest.current = path;

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      const value = await api.get<A>(path);
      if (latest.current === path) {
        setData(value);
        setError(null);
      }
    } catch (e) {
      if (latest.current === path) setError(errorMessage(e));
    } finally {
      if (latest.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setData(undefined);
    void reload();
    if (!options.refreshMs || path === null) return;
    const timer = setInterval(() => void reload(), options.refreshMs);
    return () => clearInterval(timer);
  }, [reload, options.refreshMs, path]);

  return { data, error, loading, reload, setData };
};
