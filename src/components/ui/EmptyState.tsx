export function EmptyState({ message }: { message: string }) {
  return (
    <div className="grid min-h-24 place-items-center rounded-lg border border-dashed border-[#D7DEE8] bg-[#FAFBFD] p-5 text-center text-sm font-normal text-slate">
      {message}
    </div>
  );
}
