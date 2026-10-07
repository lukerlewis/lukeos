import { Archive, Bot, FileText, Lightbulb, CheckSquare, Ellipsis, LayoutDashboard, MessagesSquare, NotebookPen, Timer } from "lucide-react";

export const mainNav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/focus", label: "Focus", icon: Timer },
  { href: "/tasks", label: "All tasks", icon: CheckSquare },
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/inspiration", label: "Inspiration", icon: Lightbulb },
  { href: "/archive", label: "Work archive", icon: Archive },
  { href: "/agents", label: "Agents", icon: Bot },
] as const;

/** On phones, Search, Projects, All tasks, Documents, Inspiration, Work archive, Agents and Trash live under More. */
export const phoneTabs = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, also: [] },
  { href: "/focus", label: "Focus", icon: Timer, also: [] },
  { href: "/notes", label: "Notes", icon: NotebookPen, also: [] },
  { href: "/messages", label: "Messages", icon: MessagesSquare, also: [] },
  { href: "/projects", label: "More", icon: Ellipsis, also: ["/search", "/tasks", "/documents", "/inspiration", "/archive", "/agents", "/trash", "/artifacts", "/claude"] },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
