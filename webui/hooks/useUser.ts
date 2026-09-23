import { useEffect, useState } from "react";
import { fetchMe, type AuthUser } from "@/lib/api";

/**
 * Returns the logged-in user (or `null` while anonymous) plus a `loading`
 * flag that flips to `false` after the first auth check resolves.
 */
export function useUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
      })
      .catch(() => {
        // Network/server error — treat as anonymous but don't crash callers.
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}
