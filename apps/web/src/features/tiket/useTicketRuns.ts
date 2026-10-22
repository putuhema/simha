/**
 * A ticket's investigations: the stored runs (transcript) plus the one
 * streaming now. When a live run ends, the transcript is reloaded and
 * replaces it, so a reload shows exactly the same thing.
 */
import type { Fix, Transcript } from "@simrs/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { emptyRun, fromTranscript, streamRun, type RunView } from "../../lib/run.ts";
import { useApi } from "../../lib/useApi.ts";
import { bumpStats } from "../../stores/refresh.ts";

export const useTicketRuns = (ticketId: string | undefined, onFinished: () => void) => {
  const transcript = useApi<Transcript>(ticketId ? `/api/tickets/${ticketId}/transcript` : null);
  const fixes = useApi<ReadonlyArray<Fix>>(ticketId ? `/api/fixes?ticketId=${ticketId}` : null);
  const [live, setLive] = useState<RunView | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setLive(null);
    return () => abort.current?.abort();
  }, [ticketId]);

  const investigate = useCallback(
    async (question?: string) => {
      if (!ticketId) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const initial = emptyRun(question ?? "Investigasi tiket");
      setLive(initial);
      await streamRun(`/api/tickets/${ticketId}/investigate`, question ? { question } : undefined, initial, setLive, controller.signal);
      await Promise.all([transcript.reload(), fixes.reload()]);
      if (abort.current === controller) setLive(null);
      onFinished();
      bumpStats();
    },
    [ticketId, transcript, fixes, onFinished],
  );

  const runs: ReadonlyArray<RunView> = [
    ...(transcript.data?.runs.map(fromTranscript) ?? []),
    ...(live && !transcript.data?.runs.some((r) => r.id === live.runId) ? [live] : []),
  ];

  return {
    runs,
    loading: transcript.loading && !transcript.data,
    fixes: fixes.data ?? [],
    reloadFixes: fixes.reload,
    running: live?.status === "running",
    investigate,
    stop: () => abort.current?.abort(),
  };
};
