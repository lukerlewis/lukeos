import { Plus } from "lucide-react";

/** The round "+" floating above the tab bar on phones. */
export function Fab({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-10 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground md:hidden"
    >
      <Plus className="size-6" aria-hidden />
    </button>
  );
}
