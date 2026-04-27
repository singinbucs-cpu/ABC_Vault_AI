const REFRESH_WINDOW_TIMEZONE = "America/New_York";
const REFRESH_WINDOW_START_HOUR = 8;
const REFRESH_WINDOW_END_HOUR = 17;
const WEEKDAY_TO_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getEasternTimeParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: REFRESH_WINDOW_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekdayIndex = WEEKDAY_TO_INDEX[values.weekday] ?? -1;

  return {
    weekday: values.weekday || "",
    weekdayIndex,
    hour: Number(values.hour || 0),
    minute: Number(values.minute || 0),
  };
}

function getNextAllowedRefreshLabel(parts) {
  if (parts.weekdayIndex >= 1 && parts.weekdayIndex <= 5 && parts.hour < REFRESH_WINDOW_START_HOUR) {
    return "Today at 8:00 AM ET";
  }

  if (parts.weekdayIndex >= 1 && parts.weekdayIndex <= 4) {
    return "Tomorrow at 8:00 AM ET";
  }

  return "Monday at 8:00 AM ET";
}

function getRefreshWindowStatus(now = new Date()) {
  const parts = getEasternTimeParts(now);
  const isWeekday = parts.weekdayIndex >= 1 && parts.weekdayIndex <= 5;
  const isWithinHours = parts.hour >= REFRESH_WINDOW_START_HOUR && parts.hour < REFRESH_WINDOW_END_HOUR;
  const allowed = isWeekday && isWithinHours;

  if (allowed) {
    return {
      allowed: true,
      scheduleLabel: "Monday-Friday, 8:00 AM-5:00 PM ET",
      statusLabel: "Refreshes are allowed right now.",
      blockedReason: "",
      nextAllowedLabel: null,
    };
  }

  const blockedReason = !isWeekday
    ? "Refreshes are blocked on weekends."
    : parts.hour < REFRESH_WINDOW_START_HOUR
    ? "Refreshes are blocked before 8:00 AM ET."
    : "Refreshes are blocked after 5:00 PM ET.";

  return {
    allowed: false,
    scheduleLabel: "Monday-Friday, 8:00 AM-5:00 PM ET",
    statusLabel: blockedReason,
    blockedReason,
    nextAllowedLabel: getNextAllowedRefreshLabel(parts),
  };
}

module.exports = {
  REFRESH_WINDOW_END_HOUR,
  REFRESH_WINDOW_START_HOUR,
  REFRESH_WINDOW_TIMEZONE,
  getRefreshWindowStatus,
};
