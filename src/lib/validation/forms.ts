export function requireFields(payload: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter((field) => {
    const value = payload[field];
    return value === null || value === undefined || String(value).trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
}

export function asNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
