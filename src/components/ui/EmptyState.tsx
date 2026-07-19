export function EmptyState({ message, variant = "default" }: { message: string; variant?: "default" | "quiet" | "board" }) {
  const classes = {
    default: "min-h-24 border-dashed border-[#C4D8FF] bg-[#F4F7FF] p-5",
    quiet: "min-h-16 border-[#E4E9F2] bg-white p-4",
    board: "min-h-32 border-dashed border-[#C4D8FF] bg-white/80 p-4"
  }[variant];
  return (
    <div className={`grid place-items-center rounded-2xl border text-center text-sm font-medium text-slate ${classes}`}>
      <div className="grid justify-items-center gap-2">
        <span className="h-1.5 w-10 rounded-full bg-primary/35" aria-hidden="true" />
        <span>{message}</span>
      </div>
    </div>
  );
}
