export function getLocalHour(now: Date, timeZone: string): number {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    hour12: false,
    timeZone,
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;

  if (!hourPart) {
    throw new Error(`Could not determine local hour for timezone ${timeZone}.`);
  }

  const hour = Number(hourPart);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid local hour "${hourPart}" for timezone ${timeZone}.`);
  }
  return hour;
}
