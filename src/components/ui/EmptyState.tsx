export function EmptyState({ message }: { message: string }) {
  return (
    <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-[#D7DEE8] bg-lightgray/55 p-6 text-center text-sm font-bold text-slate">
      {message}
    </div>
  );
}
