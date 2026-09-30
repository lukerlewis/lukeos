import { CheckSquare, FileText, Folder, Search, Sun } from "lucide-react";

export const mainNav = [
  { href: "/", label: "Today", icon: Sun },
  { href: "/tasks", label: "All tasks", icon: CheckSquare },
  { href: "/notes", label: "Notes", icon: FileText },
] as const;

export const phoneTabs = [
  { href: "/", label: "Today", icon: Sun },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/search", label: "Search", icon: Search },
] as const;

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
