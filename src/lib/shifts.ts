/**************************************************************************
 * TS SHIFTS (Vietnam time, GMT+7) — 8 shifts of 3 hours covering 24h.
 *
 *   02-05 · 05-08 · 08-11 · 11-14 · 14-17 · 17-20 · 20-23 · 23-02
 *
 * Used to tell whether a customer's follow-up falls in the SAME shift as the
 * last time the issue was handled (same TS on duty) or a DIFFERENT shift.
 ***************************************************************************/

const GMT7_OFFSET_HOURS = 7;

type ShiftLabel =
  | "02-05"
  | "05-08"
  | "08-11"
  | "11-14"
  | "14-17"
  | "17-20"
  | "20-23"
  | "23-02";

// GMT+7 hour-of-day (0..24, fractional) for a UTC epoch-ms timestamp.
function gmt7HourOfDay(tsMs: number): number {
  const localHours = (tsMs + GMT7_OFFSET_HOURS * 3600000) / 3600000;
  return ((localHours % 24) + 24) % 24;
}

// The shift containing a Crisp message timestamp (epoch ms, UTC).
function shiftOf(tsMs: number): ShiftLabel {
  const h = gmt7HourOfDay(tsMs);
  if (h >= 23 || h < 2) return "23-02";
  if (h < 5) return "02-05";
  if (h < 8) return "05-08";
  if (h < 11) return "08-11";
  if (h < 14) return "11-14";
  if (h < 17) return "14-17";
  if (h < 20) return "17-20";
  return "20-23"; // 20 <= h < 23
}

// True when both timestamps fall in the same TS shift.
function sameShift(aMs: number, bMs: number): boolean {
  return shiftOf(aMs) === shiftOf(bMs);
}

export { shiftOf, sameShift, gmt7HourOfDay, type ShiftLabel };

