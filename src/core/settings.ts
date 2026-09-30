import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { todayIn } from "@/lib/dates";
import { defineOperation, OperationError } from "./define";

const DEFAULT_TIME_ZONE = "UTC";

export async function getTimeZone() {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "timezone")).limit(1);
  return row?.value ?? DEFAULT_TIME_ZONE;
}

/** Luke's "today", in his own time zone. */
export async function today() {
  return todayIn(await getTimeZone());
}

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const settingsOperations = {
  set_time_zone: defineOperation({
    name: "set_time_zone",
    description:
      "Set Luke's time zone (an IANA name such as Europe/London), which decides what counts as today. The app sets this automatically from his device.",
    input: z.object({ timeZone: z.string().min(1) }),
    run: async ({ timeZone }) => {
      if (!isTimeZone(timeZone)) throw new OperationError(`"${timeZone}" isn't a time zone name.`);
      await db
        .insert(schema.appSettings)
        .values({ key: "timezone", value: timeZone })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: timeZone } });
      return { timeZone, today: todayIn(timeZone) };
    },
  }),
};
