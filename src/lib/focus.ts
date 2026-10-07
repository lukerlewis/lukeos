/** Pomodoro lengths, in minutes. Shared by the Focus screen and the server. */
export type FocusSettings = {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Focus rounds before a long break instead of a short one. */
  roundsBeforeLongBreak: number;
};

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
};

export const FOCUS_LIMITS = {
  focusMinutes: [1, 180],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 90],
  roundsBeforeLongBreak: [1, 12],
} as const satisfies Record<keyof FocusSettings, readonly [number, number]>;

export function parseFocusSettings(raw: unknown): FocusSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_FOCUS_SETTINGS };
  for (const key of Object.keys(FOCUS_LIMITS) as (keyof FocusSettings)[]) {
    const n = Number(value[key]);
    const [min, max] = FOCUS_LIMITS[key];
    if (Number.isFinite(n)) out[key] = Math.min(max, Math.max(min, Math.round(n)));
  }
  return out;
}

/** 0:42, 24:59, 1:02:03: a timer's face. */
export function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
