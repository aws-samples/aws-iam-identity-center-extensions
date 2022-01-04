interface DurationValues {
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export type Duration = {
  negative?: boolean;
} & DurationValues;

const units: Array<{ unit: keyof DurationValues; symbol: string }> = [
  { unit: "years", symbol: "Y" },
  { unit: "months", symbol: "M" },
  { unit: "weeks", symbol: "W" },
  { unit: "days", symbol: "D" },
  { unit: "hours", symbol: "H" },
  { unit: "minutes", symbol: "M" },
  { unit: "seconds", symbol: "S" },
];

// Construction of the duration regex
const r = (name: string, unit: string): string =>
  `((?<${name}>-?\\d*[\\.,]?\\d+)${unit})?`;
// Eslint disable rule in place because while the regexp is dynamic it's not long lasting, nor is it DoS prone as the Duration value is set in the calling method and is always static to reflect { minutes : <no> }
/* eslint-disable  security/detect-non-literal-regexp */
const durationRegex = new RegExp(
  [
    "(?<negative>-)?P",
    r("years", "Y"),
    r("months", "M"),
    r("weeks", "W"),
    r("days", "D"),
    "(T",
    r("hours", "H"),
    r("minutes", "M"),
    r("seconds", "S"),
    ")?", // end optional time
  ].join("")
);

function parseNum(stringValue: string): number | undefined {
  if (stringValue === "" || stringValue === undefined || stringValue === null) {
    return undefined;
  }

  return parseFloat(stringValue.replace(",", "."));
}

export const InvalidDurationError = new Error("Invalid duration");

export function parseISODurationString(durationStr: string): Duration {
  const match = durationRegex.exec(durationStr);
  if (!match || !match.groups) {
    throw InvalidDurationError;
  }

  let empty = true;
  const values: DurationValues = {};
  for (const { unit } of units) {
    if (Object.prototype.hasOwnProperty.call(match.groups, unit)) {
      empty = false;
      Object.assign(values, {
        // Eslint disable rule in place because the user input has already been validated earlier and also in line 62 , validation that match.groups has the unit property is done
        /* eslint-disable  security/detect-object-injection */
        [unit]: parseNum(match.groups[unit]),
      });
    }
  }

  if (empty) {
    throw InvalidDurationError;
  }

  const duration: Duration = values;
  if (match.groups.negative) {
    duration.negative = true;
  }
  return duration;
}

const s = (
  number: number | undefined,
  component: string
): string | undefined => {
  if (!number) {
    return undefined;
  }

  let numberAsString = number.toString();
  const exponentIndex = numberAsString.indexOf("e");
  if (exponentIndex > -1) {
    const magnitude = parseInt(numberAsString.slice(exponentIndex + 2), 10);
    numberAsString = number.toFixed(magnitude + exponentIndex - 2);
  }

  return numberAsString + component;
};

export function serializeDurationToISOFormat(duration: Duration): string {
  if (
    !duration.years &&
    !duration.months &&
    !duration.weeks &&
    !duration.days &&
    !duration.hours &&
    !duration.minutes &&
    !duration.seconds
  ) {
    return "PT0S";
  }

  return [
    duration.negative && "-",
    "P",
    s(duration.years, "Y"),
    s(duration.months, "M"),
    s(duration.weeks, "W"),
    s(duration.days, "D"),
    (duration.hours || duration.minutes || duration.seconds) && "T",
    s(duration.hours, "H"),
    s(duration.minutes, "M"),
    s(duration.seconds, "S"),
  ]
    .filter(Boolean)
    .join("");
}

export function convertDurationToMinutes(duration: Duration): number {
  // Compute provided date
  const then = new Date(Date.now());
  if (duration.years) {
    then.setFullYear(then.getFullYear() + duration.years);
  }
  if (duration.months) {
    then.setMonth(then.getMonth() + duration.months);
  }
  if (duration.days) {
    then.setDate(then.getDate() + duration.days);
  }
  if (duration.hours) {
    then.setHours(then.getHours() + duration.hours);
  }
  if (duration.minutes) {
    then.setMinutes(then.getMinutes() + duration.minutes);
  }
  if (duration.seconds) {
    then.setMilliseconds(then.getMilliseconds() + duration.seconds * 1000);
  }
  // Special case weeks
  if (duration.weeks) {
    then.setDate(then.getDate() + duration.weeks * 7);
  }

  const now = new Date(Date.now());

  return Math.ceil((then.getTime() - now.getTime()) / 60000);
}

export function getMinutesFromISODurationString(durationStr: string): string {
  const durationValue = parseISODurationString(durationStr);
  const minutesValue = convertDurationToMinutes(durationValue);
  return minutesValue.toString();
}
