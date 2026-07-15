import { formatLocalDateInput } from "@/lib/dates";

type RequisitionLike = {
  pr_approved_date: string | null;
  level: string | null;
  status: string;
  open_headcount?: number;
};

export type RequisitionSlaState = {
  ageDays: number | null;
  endDate: string | null;
  inSla: boolean | null;
  isOverdue: boolean;
  label: string;
  slaDays: number | null;
  startDate: string | null;
};

export function getRequisitionStartDate(requisition: RequisitionLike) {
  return dateOnly(requisition.pr_approved_date);
}

export function getSlaDays(level: string | null | undefined) {
  if (!level) return null;
  const numericLevel = Number.parseInt(level.replace(/^L/i, ""), 10);
  if (Number.isNaN(numericLevel) || numericLevel < 0 || numericLevel > 14) return null;
  if (numericLevel <= 3) return 30;
  if (numericLevel <= 9) return 45;
  return 60;
}

export function getRequisitionAgeDays(startDate: string | null | undefined, endDate: string | null | undefined = todayDate()) {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  if (!start || !end) return null;
  const startTime = Date.parse(`${start}T00:00:00`);
  const endTime = Date.parse(`${end}T00:00:00`);
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return null;
  return Math.max(0, Math.floor((endTime - startTime) / 86_400_000));
}

export function getRequisitionSlaState(
  requisition: RequisitionLike,
  options: { endDate?: string | null; openOnly?: boolean } = {}
): RequisitionSlaState {
  const startDate = getRequisitionStartDate(requisition);
  const slaDays = getSlaDays(requisition.level);
  const endDate = dateOnly(options.endDate ?? todayDate());
  const ageDays = getRequisitionAgeDays(startDate, endDate);
  const hasKnownSla = ageDays !== null && slaDays !== null;
  const openHeadcount = requisition.open_headcount ?? 0;
  const isOpen = requisition.status !== "filled" && requisition.status !== "cancel" && openHeadcount > 0;
  const inSla = hasKnownSla ? ageDays <= slaDays : null;
  const isOverdue = Boolean(hasKnownSla && ageDays > slaDays && (!options.openOnly || isOpen));

  return {
    ageDays,
    endDate,
    inSla,
    isOverdue,
    label: hasKnownSla ? `${ageDays}d / ${slaDays}d` : "-",
    slaDays,
    startDate
  };
}

export function todayDate() {
  return formatLocalDateInput();
}

function dateOnly(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 10);
}
