import type { Offer } from "@/types/recruitment";

/** Operational coverage only; historical acceptance reporting remains separate. */
export function countsTowardHeadcount(offer: Pick<Offer, "accepted_date" | "start_confirmation">) {
  return Boolean(offer.accepted_date) && offer.start_confirmation !== "did_not_start";
}

/** Coverage at the opening of a reporting date. */
export function countsTowardHeadcountAt(offer: Pick<Offer, "accepted_date" | "start_confirmation" | "start_confirmed_at">, date: string) {
  const acceptedDate = offer.accepted_date?.slice(0, 10);
  if (!acceptedDate || acceptedDate >= date) return false;
  if (offer.start_confirmation !== "did_not_start") return true;
  const noShowDate = offer.start_confirmed_at?.slice(0, 10);
  return !noShowDate || noShowDate >= date;
}
