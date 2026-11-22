import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · LukeOS" };

/**
 * Public, because Google asks for a privacy policy before an app that reads health data
 * can leave its 7-day test mode. LukeOS has one user: Luke.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-5 py-16 text-body text-foreground">
      <h1 className="text-title font-medium">Privacy</h1>
      <p>LukeOS is a personal app used by one person, Luke. It is not offered to anyone else.</p>
      <p>
        When Luke connects his Fitbit, LukeOS reads his own health data from the Google Health API (activity, sleep, heart rate and similar
        measurements) and stores it in LukeOS&apos;s private database so he can see it. The data is never sold, shared with anyone, or used for
        advertising, and it is only read, never changed.
      </p>
      <p>Disconnecting in LukeOS, or removing LukeOS from the Google account&apos;s connected apps, stops all access.</p>
    </main>
  );
}
