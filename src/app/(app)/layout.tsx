import { Sidebar } from "@/components/shell/sidebar";
import { TabBar } from "@/components/shell/tab-bar";
import { requireSession } from "@/lib/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireSession();

  return (
    <div className="flex min-h-dvh md:h-dvh">
      <Sidebar />
      <main className="flex min-w-0 grow md:overflow-y-auto">{children}</main>
      <TabBar />
    </div>
  );
}
