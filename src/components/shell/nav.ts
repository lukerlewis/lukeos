import { Bot, CheckSquare, FileText, Folder, LayoutDashboard, Search } from "lucide-react";

export const mainNav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "All tasks", icon: CheckSquare },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/agents", label: "Agents", icon: Bot },
] as const;

export const phoneTabs = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/search", label: "Search", icon: Search },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
