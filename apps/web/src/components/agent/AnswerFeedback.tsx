/**
 * 👍/👎 for a whole text answer (no table/chart to rate). A 👍 saves the
 * question + answer as a verified note; a 👎 with a correction saves the
 * correction for the next similar question.
 */
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { Textarea } from "../ui/Field.tsx";

export const AnswerFeedback = ({ runId }: { readonly runId: string }) => {
  const [sent, setSent] = useState<"up" | "down" | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async (rating: "up" | "down") => {
    setSending(true);
    setError(null);
    try {
      const trimmed = comment.trim();
      await api.post("/api/knowledge/feedback", {
        runId,
        rating,
        ...(rating === "down" && trimmed !== "" ? { comment: trimmed } : {}),
      });
      setSent(rating);
      setCorrecting(false);
      setComment("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Jawaban ini benar"
          title="Jawaban ini benar (catat untuk pertanyaan serupa)"
          onClick={() => void send("up")}
          disabled={sending || sent === "up"}
          className={sent === "up" ? "text-ok" : ""}
        >
          <ThumbsUp className={sent === "up" ? "fill-ok" : ""} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Ada yang salah"
          title="Ada yang salah (beri koreksi)"
          onClick={() => setCorrecting(!correcting)}
          disabled={sending || sent === "down"}
          className={sent === "down" ? "text-red" : ""}
        >
          <ThumbsDown className={sent === "down" ? "fill-red" : ""} />
        </Button>
        {sent !== null ? (
          <span className={sent === "up" ? "text-[12px] text-ok" : "text-[12px] text-ink-3"}>
            {sent === "up" ? "Tersimpan" : "Koreksi tersimpan"}
          </span>
        ) : null}
      </div>

      {correcting ? (
        <div className="w-80 max-w-full rounded-lg border border-line-2 bg-paper/60 p-2">
          <p className="text-[12px] text-ink-2">Apa yang salah? Tulis aturan umumnya, tanpa nomor pasien.</p>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={1_000}
            placeholder="Koreksi untuk AI…"
            aria-label="Koreksi"
            className="mt-1.5 text-[13px]"
          />
          <div className="mt-1.5 flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCorrecting(false);
                setComment("");
              }}
            >
              Batal
            </Button>
            <Button size="sm" variant="primary" onClick={() => void send("down")} disabled={sending}>
              Kirim koreksi
            </Button>
          </div>
        </div>
      ) : null}

      {error !== null ? <p className="text-[12px] text-red">{error}</p> : null}
    </div>
  );
};
