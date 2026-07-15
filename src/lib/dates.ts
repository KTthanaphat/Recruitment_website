const APP_TIME_ZONE = "Asia/Bangkok";

export function formatLocalDateInput(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIME_ZONE,
    year: "numeric"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function currentLocalWeekStart(date: Date = new Date()) {
  const [year, month, day] = formatLocalDateInput(date).split("-").map(Number);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  const weekDay = localDate.getUTCDay();
  const diff = weekDay === 0 ? -6 : 1 - weekDay;
  localDate.setUTCDate(localDate.getUTCDate() + diff);
  return [
    localDate.getUTCFullYear(),
    String(localDate.getUTCMonth() + 1).padStart(2, "0"),
    String(localDate.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function currentLocalYearStart(date: Date = new Date()) {
  return `${formatLocalDateInput(date).slice(0, 4)}-01-01`;
}
