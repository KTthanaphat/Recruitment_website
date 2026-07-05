export function EmptyState({ message }: { message: string }) {
  return (
    <div className="grid min-h-24 place-items-center rounded-lg border border-dashed border-[#C9D5E6] bg-[#F6F8FC] p-5 text-center text-sm font-medium text-slate">
      {message}
    </div>
  );
}
