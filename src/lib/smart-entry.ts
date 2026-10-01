/**
 * Reads a due date and a repeat out of a task name as it's typed, so
 * "put away laundry tomorrow" becomes "put away laundry", due tomorrow.
 * Plain rules, no AI: each rule is a pattern and how to turn it into a day.
 */

import { addDays, addMonths, endOfMonth, endOfWeek } from "@/lib/dates";
import type { Repeat } from "@/lib/task-fields";

export type SmartMatch = {
  kind: "date" | "repeat";
  /** Where the words are in the text, so they can be highlighted or left in. */
  start: number;
  end: number;
  text: string;
};

export type SmartEntry = {
  /** The name with the date and repeat words taken out. */
  title: string;
  /** The day the words name. null for no date, or a repeat with no day of its own ("every week"). */
  dueDate: string | null;
  repeat: Repeat | null;
  matches: SmartMatch[];
};

type Found = { dueDate?: string; repeat?: Repeat };
type Rule = { kind: SmartMatch["kind"]; re: RegExp; read: (m: RegExpExecArray, today: string) => Found | null };

const dayNames: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
const monthNames: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const numberWords: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// "sat" and "sun" are ordinary words too, so on their own they only count with "on", "next" and so on.
const DAY_FULL = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const DAY_ANY = `${DAY_FULL}|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun`;
const DAY_SAFE = `${DAY_FULL}|mon|tues|tue|weds|wed|thurs|thur|thu|fri`;
const MONTH = Object.keys(monthNames).sort((a, b) => b.length - a.length).join("|");
const ORD = "(?:st|nd|rd|th)";
const COUNT = `\\d+|${Object.keys(numberWords).join("|")}`;
/** Little words before a date that go with it: "due on friday", "by tomorrow". */
const LEAD = "(?:(?:due(?:\\s+(?:on|by))?|on|by|for|before|until|from|starting(?:\\s+(?:on|from))?)\\s+)?";

/**
 * "weekly" on its own only counts at the end or before a date ("gym daily",
 * "pay rent monthly from the 1st"), not as a describing word ("weekly report").
 */
const ADJ_END = "(?=\\s*(?:$|[,.;!?]|(?:on|by|from|starting|until|due|today|tonight|tomorrow|this|next|every|in)(?![\\w'])))";

const rx = (body: string) => new RegExp(`(?<![\\w'])(?:${body})(?![\\w'])`, "gi");

function weekday(today: string) {
  return new Date(`${today}T00:00:00Z`).getUTCDay();
}

/** The next `day` (0 = Sunday) from today, today included. */
function upcoming(today: string, day: number) {
  return addDays(today, (day - weekday(today) + 7) % 7);
}

/** `day` in the week (Monday to Sunday) after this one. */
function inNextWeek(today: string, day: number) {
  return addDays(endOfWeek(today), day === 0 ? 7 : day);
}

/** The next time it's the given day of the month (today included), skipping months that are too short. */
function nextDayOfMonth(today: string, dom: number) {
  if (dom < 1 || dom > 31) return null;
  const [y, m] = today.split("-").map(Number);
  for (let i = 0; i < 13; i++) {
    const first = addMonths(`${y}-${String(m).padStart(2, "0")}-01`, i);
    const day = `${first.slice(0, 8)}${String(dom).padStart(2, "0")}`;
    if (day >= today && endOfMonth(first) >= day) return day;
  }
  return null;
}

/** A month and day, this year or, once it's gone by, next year. */
function monthDay(today: string, month: number, dom: number, year?: number) {
  if (month < 1 || month > 12 || dom < 1) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const build = (y: number) => {
    const day = `${y}-${pad(month)}-${pad(dom)}`;
    return endOfMonth(`${y}-${pad(month)}-01`) >= day ? day : null;
  };
  if (year) return build(year < 100 ? 2000 + year : year);
  const thisYear = Number(today.slice(0, 4));
  const day = build(thisYear);
  if (day && day >= today) return day;
  return build(thisYear + 1);
}

const count = (word: string) => numberWords[word.toLowerCase()] ?? Number(word);

const rules: Rule[] = [
  // Repeats
  { kind: "repeat", re: rx("every\\s+(?:week\\s*day|work\\s*day)s?|on\\s+weekdays|weekdays"), read: () => ({ repeat: "weekdays" }) },
  {
    kind: "repeat",
    re: rx(`(?:every|each)\\s+(${DAY_ANY})s?|(?:on\\s+)?(${DAY_FULL})s`),
    read: (m, today) => ({ repeat: "weekly", dueDate: upcoming(today, dayNames[(m[1] ?? m[2]).toLowerCase()]) }),
  },
  {
    kind: "repeat",
    re: rx(
      `(?:every|each)\\s+(?:month\\s+on\\s+)?(?:the\\s+)?(\\d{1,2})${ORD}(?:\\s+of\\s+(?:the|every)\\s+month)?|(?:on\\s+)?the\\s+(\\d{1,2})${ORD}\\s+of\\s+(?:every|each)\\s+month`,
    ),
    read: (m, today) => {
      const dueDate = nextDayOfMonth(today, Number(m[1] ?? m[2]));
      return dueDate ? { repeat: "monthly", dueDate } : null;
    },
  },
  {
    kind: "repeat",
    re: rx(`(?:every|each)\\s+(${MONTH})\\.?\\s+(\\d{1,2})${ORD}?|(?:every|each)\\s+(\\d{1,2})${ORD}?\\s+(?:of\\s+)?(${MONTH})`),
    read: (m, today) => {
      const dueDate = m[1] ? monthDay(today, monthNames[m[1].toLowerCase()], Number(m[2])) : monthDay(today, monthNames[m[4].toLowerCase()], Number(m[3]));
      return dueDate ? { repeat: "yearly", dueDate } : null;
    },
  },
  { kind: "repeat", re: rx(`(?:every|each)\\s+(?:day|morning|evening|night)|every\\s*day|(?:daily|nightly)${ADJ_END}`), read: () => ({ repeat: "daily" }) },
  { kind: "repeat", re: rx(`(?:every|each)\\s+week|weekly${ADJ_END}`), read: () => ({ repeat: "weekly" }) },
  { kind: "repeat", re: rx(`(?:every|each)\\s+month|monthly${ADJ_END}`), read: () => ({ repeat: "monthly" }) },
  { kind: "repeat", re: rx(`(?:every|each)\\s+year|(?:yearly|annually)${ADJ_END}`), read: () => ({ repeat: "yearly" }) },

  // Dates
  { kind: "date", re: rx(`${LEAD}(?:the\\s+)?day\\s+after\\s+tomorrow`), read: (_, t) => ({ dueDate: addDays(t, 2) }) },
  { kind: "date", re: rx(`${LEAD}(?:today|tonight|this\\s+(?:morning|afternoon|evening))`), read: (_, t) => ({ dueDate: t }) },
  { kind: "date", re: rx(`${LEAD}(?:tomorrow|tmrw|tmr)(?:\\s+(?:morning|afternoon|evening|night))?`), read: (_, t) => ({ dueDate: addDays(t, 1) }) },
  {
    kind: "date",
    re: rx(`${LEAD}(?:(this|next)\\s+(${DAY_ANY})|(${DAY_SAFE}))`),
    read: (m, t) => {
      const day = dayNames[(m[2] ?? m[3]).toLowerCase()];
      return { dueDate: m[1]?.toLowerCase() === "next" ? inNextWeek(t, day) : upcoming(t, day) };
    },
  },
  {
    // "on sat", "by sun": the short names that are also words need a little word in front.
    kind: "date",
    re: rx("(?:due(?:\\s+(?:on|by))?|on|by|before|until)\\s+(sat|sun)"),
    read: (m, t) => ({ dueDate: upcoming(t, dayNames[m[1].toLowerCase()]) }),
  },
  {
    kind: "date",
    re: rx(`${LEAD}(?:this\\s+|the\\s+)?weekend`),
    read: (_, t) => ({ dueDate: endOfWeek(t) === t ? t : addDays(endOfWeek(t), -1) }),
  },
  { kind: "date", re: rx(`${LEAD}next\\s+week`), read: (_, t) => ({ dueDate: addDays(endOfWeek(t), 1) }) },
  { kind: "date", re: rx(`${LEAD}next\\s+month`), read: (_, t) => ({ dueDate: addDays(endOfMonth(t), 1) }) },
  { kind: "date", re: rx(`${LEAD}(?:(?:the\\s+)?end\\s+of\\s+(?:the\\s+|this\\s+)?week|eow)`), read: (_, t) => ({ dueDate: endOfWeek(t) }) },
  { kind: "date", re: rx(`${LEAD}(?:(?:the\\s+)?end\\s+of\\s+(?:the\\s+|this\\s+)?month|eom)`), read: (_, t) => ({ dueDate: endOfMonth(t) }) },
  {
    kind: "date",
    re: rx(`${LEAD}(?:in\\s+(${COUNT})\\s+(day|week|month|year)s?|(${COUNT})\\s+(day|week|month|year)s?\\s+from\\s+(?:now|today))`),
    read: (m, t) => {
      const n = count(m[1] ?? m[3]);
      const unit = (m[2] ?? m[4]).toLowerCase();
      if (!n || n > 1000) return null;
      if (unit === "day") return { dueDate: addDays(t, n) };
      if (unit === "week") return { dueDate: addDays(t, 7 * n) };
      return { dueDate: addMonths(t, unit === "month" ? n : 12 * n) };
    },
  },
  {
    // "oct 5", "October 5th, 2027", "5 oct", "5th of October"
    kind: "date",
    re: rx(`${LEAD}(?:(${MONTH})\\.?\\s+(\\d{1,2})${ORD}?(?:,?\\s+(\\d{4}))?|(?:the\\s+)?(\\d{1,2})${ORD}?\\s+(?:of\\s+)?(${MONTH})(?:,?\\s+(\\d{4}))?)`),
    read: (m, t) => {
      const day = m[1]
        ? monthDay(t, monthNames[m[1].toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : undefined)
        : monthDay(t, monthNames[m[5].toLowerCase()], Number(m[4]), m[6] ? Number(m[6]) : undefined);
      return day ? { dueDate: day } : null;
    },
  },
  {
    // "10/5" or "10/5/27", month first as in the US.
    kind: "date",
    re: rx(`${LEAD}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?`),
    read: (m, t) => {
      const day = monthDay(t, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
      return day ? { dueDate: day } : null;
    },
  },
  {
    // "on the 15th"
    kind: "date",
    re: rx(`${LEAD}the\\s+(\\d{1,2})${ORD}`),
    read: (m, t) => {
      const day = nextDayOfMonth(t, Number(m[1]));
      return day ? { dueDate: day } : null;
    },
  },
];

/**
 * Finds the first date and the first repeat in `text`. Words listed in
 * `ignore` (lower case) were turned back into plain words by the user and
 * are left alone.
 */
export function parseTaskText(text: string, today: string, ignore: ReadonlySet<string> = new Set()): SmartEntry {
  const found: (SmartMatch & Found)[] = [];
  const free = (start: number, end: number) => found.every((f) => end <= f.start || start >= f.end);

  for (const rule of rules) {
    if (found.some((f) => f.kind === rule.kind)) continue;
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      if (ignore.has(m[0].toLowerCase()) || !free(start, end)) continue;
      const result = rule.read(m, today);
      if (!result) continue;
      found.push({ kind: rule.kind, start, end, text: m[0], ...result });
      break;
    }
  }

  const repeat = found.find((f) => f.kind === "repeat");
  const date = found.find((f) => f.kind === "date");
  // A repeat with no day of its own ("every week") leaves dueDate empty; the caller picks today or the screen's day.
  const dueDate = date?.dueDate ?? repeat?.dueDate ?? null;

  const matches = found.map(({ kind, start, end, text }) => ({ kind, start, end, text })).sort((a, b) => a.start - b.start);
  let title = text;
  for (const m of [...matches].reverse()) title = title.slice(0, m.start) + " " + title.slice(m.end);
  title = title
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();

  return { title: matches.length ? title : text.trim(), dueDate, repeat: repeat?.repeat ?? null, matches };
}
