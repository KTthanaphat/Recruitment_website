import { AlertTriangle, Loader2 } from "lucide-react";

type StatusBannerTone = "loading" | "error" | "info";

export function StatusBanner({
  busy = false,
  message,
  tone = "info"
}: {
  busy?: boolean;
  message: string;
  tone?: StatusBannerTone;
}) {
  const isError = tone === "error";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={busy}
      className={`mb-4 flex min-h-11 items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-[0_2px_8px_rgba(11,19,43,0.04)] ${
        isError
          ? "border-[#F4B4AE] bg-[#FFF8F7] text-scarlet"
          : "border-[#C4D8FF] bg-[#F4F7FF] text-slate"
      }`}
    >
      {busy ? (
        <Loader2 className="mt-0.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" size={16} aria-hidden="true" />
      ) : isError ? (
        <AlertTriangle className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
      ) : null}
      <span className="min-w-0">{message}</span>
    </div>
  );
}
