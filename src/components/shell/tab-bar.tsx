"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUnreadMessages } from "@/components/messages/unread";
import { cn } from "@/lib/utils";
import { isActive, phoneTabs } from "./nav";

export function TabBar({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const pathname = usePathname();
  const unread = useUnreadMessages(unreadMessages);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {phoneTabs.map(({ href, label, icon: Icon, also }) => {
        const active = isActive(pathname, href) || also.some((a: string) => isActive(pathname, a));
        const count = href === "/messages" ? unread : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press flex min-h-14 grow basis-0 flex-col items-center gap-1 pt-2.5 pb-2 text-xs font-medium text-muted-foreground",
              active && "text-ink",
            )}
          >
            <span className="relative">
              <Icon className={cn("size-[22px]", active ? "text-foreground" : "text-icon")} aria-hidden />
              {count > 0 && (
                <span className="absolute -top-1.5 left-3.5 min-w-[18px] rounded-full bg-notification px-1 text-center text-xs leading-[18px] font-medium text-on-notification">
                  {count}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
