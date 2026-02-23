type HourFormatter = Pick<Intl.DateTimeFormat, "formatToParts">;

type HourFormatterFactory = (timeZone: string) => HourFormatter;

function createHourFormatter(timeZone: string): HourFormatter {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    hour12: false,
    timeZone,
  });
}

export function getLocalHour(
  now: Date,
  timeZone: string,
  formatterFactory: HourFormatterFactory = createHourFormatter
): number {
  const formatter = formatterFactory(timeZone);
  const hourPart = formatter
    .formatToParts(now)
    .find((part) => part.type === "hour")
    ?.value;

  if (!hourPart) {
    throw new Error(`Could not determine local hour for timezone ${timeZone}.`);
  }

  const hour = Number(hourPart);
  if (hour === 24) {
    return 0;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid local hour "${hourPart}" for timezone ${timeZone}.`);
  }

  return hour;
}

export function shouldRunAtLocalHour(now: Date, timeZone: string, targetHour: number): boolean {
  if (!Number.isInteger(targetHour) || targetHour < 0 || targetHour > 23) {
    throw new Error(`Target hour must be an integer between 0 and 23. Received: ${targetHour}`);
  }

  return getLocalHour(now, timeZone) === targetHour;
}
