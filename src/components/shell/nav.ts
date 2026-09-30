import { CheckSquare, FileText, Folder, Search, Sparkles, SquareKanban, Sun } from "lucide-react";

export const mainNav = [
  { href: "/", label: "Today", icon: Sun },
  { href: "/tasks", label: "All tasks", icon: CheckSquare },
  { href: "/board", label: "Board", icon: SquareKanban },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/from-claude", label: "From Claude", icon: Sparkles },
] as const;

export const phoneTabs = [
  { href: "/", label: "Today", icon: Sun },
  { href: "/board", label: "Board", icon: SquareKanban },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/search", label: "Search", icon: Search },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
