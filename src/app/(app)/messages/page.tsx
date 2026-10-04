import type { Metadata } from "next";
import { MessageThread } from "@/components/messages/message-thread";
import { PushPrompt } from "@/components/messages/push-toggle";
import { whenShort } from "@/components/routines/when";
import { Page } from "@/components/shell/page";
import { listMessages, unreadMessageCount } from "@/core/messages";
import { nextCheckIn } from "@/core/routines";
import { getTimeZone } from "@/core/settings";

export const metadata: Metadata = { title: "Messages · LukeOS" };

export default async function MessagesPage() {
  const [messages, unread, timeZone, next] = await Promise.all([
    listMessages({ limit: 200, withUnsent: true }),
    unreadMessageCount(),
    getTimeZone(),
    nextCheckIn(),
  ]);

  return (
    <Page title="Messages" newTask={false} fill>
      <PushPrompt />
      <MessageThread
        timeZone={timeZone}
        unread={unread}
        nextCheckIn={next ? whenShort(next, timeZone).replace(/^Today /, "") : null}
        messages={messages.map((m) => ({
          id: m.id,
          text: m.text,
          attachments: m.attachments,
          from: m.from,
          routine: m.madeBy.routine,
          link: m.link,
          createdAt: m.createdAt.toISOString(),
          answered: m.answered,
          edited: m.editedAt !== null,
          unsent: m.unsent,
        }))}
      />
    </Page>
  );
}
