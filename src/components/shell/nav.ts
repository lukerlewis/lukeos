import { Archive, Bot, Globe, FileText, Lightbulb, CheckSquare, Ellipsis, LayoutDashboard, MessagesSquare, Music, NotebookPen, Shapes, Timer } from "lucide-react";

export const mainNav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/focus", label: "Focus", icon: Timer },
  { href: "/listen", label: "Music", icon: Music },
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/whiteboard", label: "Whiteboard", icon: Shapes },
] as const;

/** On computers, these sit under More in the sidebar. */
export const moreNav = [
  { href: "/inspiration", label: "Inspiration", icon: Lightbulb },
  { href: "/archive", label: "Work archive", icon: Archive },
  { href: "/portfolio", label: "Portfolio", icon: Globe },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/tasks", label: "All tasks", icon: CheckSquare },
] as const;

/** On phones, Messages, Search, Projects, All tasks, Documents, Whiteboard, Inspiration, Work archive, Portfolio, Agents and Trash live under More. */
export const phoneTabs = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, also: [] },
  { href: "/notes", label: "Notes", icon: NotebookPen, also: [] },
  { href: "/focus", label: "Focus", icon: Timer, also: [] },
  { href: "/listen", label: "Music", icon: Music, also: [] },
  { href: "/projects", label: "More", icon: Ellipsis, also: ["/messages", "/search", "/tasks", "/documents", "/whiteboard", "/inspiration", "/archive", "/portfolio", "/agents", "/trash", "/artifacts", "/claude"] },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Remembers whether the computer sidebar is collapsed. A cookie, so the first draw is already right. */
export const SIDEBAR_COOKIE = "lukeos_sidebar";
