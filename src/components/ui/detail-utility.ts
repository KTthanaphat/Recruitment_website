/** Shared requisition drawer utility treatment for links and buttons. */
export function detailUtilityClassName(selected = false) {
  return `!h-11 !w-11 !min-h-0 !min-w-0 !shrink-0 !p-0 sm:!h-9 sm:!w-9 !rounded-lg inline-flex touch-manipulation items-center justify-center transition-colors duration-150 motion-safe:active:translate-y-px focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-[#0A3CDC]/35 focus-visible:!ring-offset-2 hover:!bg-[#E8F0FF] hover:!text-[#0A3CDC] active:!bg-[#DDEAFF] disabled:!bg-transparent disabled:!text-cool disabled:cursor-not-allowed ${selected ? "!bg-[#E8F0FF] !text-[#0A3CDC]" : "!bg-transparent !text-slate"}`;
}
