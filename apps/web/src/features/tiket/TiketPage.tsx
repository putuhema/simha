/**
 * Tiket view: ticket list | investigation | patient. Columns stack on a
 * narrow window.
 */
import type { Ticket } from "@simha/shared";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { Empty } from "../../components/ui/Spinner.tsx";
import { rmFromSteps, rmFromText, splitAnswer } from "../../lib/answer.ts";
import { api } from "../../lib/api.ts";
import { useApi } from "../../lib/useApi.ts";
import { bumpStats } from "../../stores/refresh.ts";
import { PatientPanel } from "./PatientPanel.tsx";
import { StatRow } from "./StatRow.tsx";
import { TicketDetail } from "./TicketDetail.tsx";
import { TicketList } from "./TicketList.tsx";
import { useTicketRuns } from "./useTicketRuns.ts";

export const TiketPage = () => {
  const { id } = useSearch({ from: "/shell/tiket" });
  const navigate = useNavigate();
  const tickets = useApi<ReadonlyArray<Ticket>>("/api/tickets", { refreshMs: 30_000 });
  const reloadTickets = tickets.reload;
  const onFinished = useCallback(() => void reloadTickets(), [reloadTickets]);
  const ticketRuns = useTicketRuns(id, onFinished);
  const ticket = tickets.data?.find((t) => t.id === id);
  const autoStart = useRef<string | null>(null);

  // A new ticket is investigated right away.
  useEffect(() => {
    if (id && autoStart.current === id && ticket) {
      autoStart.current = null;
      void ticketRuns.investigate();
    }
  }, [id, ticket, ticketRuns]);

  const select = (ticketId: string) => void navigate({ to: "/tiket", search: { id: ticketId } });
  const steps = ticketRuns.runs.flatMap((r) => r.steps);
  const rm = rmFromSteps(steps) ?? (ticket ? rmFromText(ticket.complaint) : undefined);
  const lastDone = ticketRuns.runs.findLast((r) => r.status === "done");
  const summary = lastDone ? splitAnswer(lastDone.text).diagnosis : "";

  return (
    <div className="quiet-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] space-y-4 px-4 pt-4 pb-8 sm:px-6">
        <StatRow />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
          <TicketList
            tickets={tickets.data}
            selectedId={id}
            onSelect={select}
            onCreated={(t) => {
              autoStart.current = t.id;
              bumpStats();
              tickets.setData([t, ...(tickets.data ?? [])]);
              select(t.id);
            }}
          />
          {ticket ? (
            <>
              <TicketDetail
                ticket={ticket}
                runs={ticketRuns.runs}
                fixes={ticketRuns.fixes}
                running={ticketRuns.running}
                loading={ticketRuns.loading}
                onInvestigate={(q) => void ticketRuns.investigate(q)}
                onStop={ticketRuns.stop}
                onFixChanged={() => void ticketRuns.reloadFixes()}
                onStatus={(status) => void api.patch(`/api/tickets/${ticket.id}`, { status }).then(() => {
                  bumpStats();
                  return tickets.reload();
                })}
              />
              <aside className="lg:col-span-2 xl:col-span-1">
                <PatientPanel rm={rm} summary={summary} />
              </aside>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-card/60 lg:col-span-1 xl:col-span-2">
              <Empty title="Pilih tiket">Pilih tiket di kiri, atau buat tiket baru dari keluhan perawat.</Empty>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
