import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * useState persisted to a URL search param.
 *
 * The initial value is seeded from the URL on mount, allowing deep-links and
 * copied links to restore the filter. Later URL changes are not read back.
 * Edits replace the current history entry so typing does not spam history.
 * An empty value removes the param to keep links clean.
 */
export function useUrlParam(key: string, initial = ""): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState(() => params.get(key) ?? initial);

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if ((next.get(key) ?? "") === value) return prev;
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }, [key, value, setParams]);

  return [value, setValue];
}
