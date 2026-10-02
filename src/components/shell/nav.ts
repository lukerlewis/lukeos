import { Bot, CheckSquare, Ellipsis, FileText, LayoutDashboard, MessagesSquare, Search } from "lucide-react";

export const mainNav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/tasks", label: "All tasks", icon: CheckSquare },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/agents", label: "Agents", icon: Bot },
] as const;

/** On phones, Projects, All tasks, Agents and Trash live under More. */
export const phoneTabs = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, also: [] },
  { href: "/search", label: "Search", icon: Search, also: [] },
  { href: "/notes", label: "Notes", icon: FileText, also: [] },
  { href: "/messages", label: "Messages", icon: MessagesSquare, also: [] },
  { href: "/projects", label: "More", icon: Ellipsis, also: ["/tasks", "/agents", "/trash", "/artifacts", "/claude"] },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
