const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : "–");
export const formatNumber = (value: unknown) =>
  typeof value === "number" ? number.format(value) : value === null || value === undefined ? "–" : String(value);

/** "3 menit lalu", or the date for anything older than a day. */
export const formatRelative = (iso: string, now = Date.now()) => {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "baru saja";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} menit lalu`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} jam lalu`;
  return formatDateTime(iso);
};

export const formatDuration = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} dtk`;
