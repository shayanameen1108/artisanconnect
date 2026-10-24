import { useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { copy } from "@/web/copy";

export type Outcome = { ok: true; value?: unknown } | { ok: false; refusal: { message: string } };

// Custom: TanStack Query's useMutation would add the cache ADR 0017 rejects.
/**
 * Runs one action at a time, keeping its refusal to show where the person
 * acted. Once it is done, what follows runs and the page loads again. A thrown
 * transport error shows the shared retry copy instead of sticking the control.
 */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  async function run<R extends Outcome>(
    action: () => Promise<R>,
    then?: (value: Extract<R, { ok: true }>["value"]) => unknown,
    onRefusal?: (message: string) => unknown,
    invalidate = true,
  ) {
    setBusy(true);
    setRefusal(null);
    try {
      const result = await action();
      if (!result.ok) {
        setRefusal(result.refusal.message);
        await onRefusal?.(result.refusal.message);
        return false;
      }
      await then?.(result.value);
      if (invalidate) await router.invalidate();
      return true;
    } catch {
      setRefusal(copy.error.lead);
      await onRefusal?.(copy.error.lead);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, refusal, setRefusal, run };
}
