import { Plus } from "lucide-react";

/** The round "+" floating above the tab bar on phones. */
export function Fab({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-10 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(0,0,0,0.18)] md:hidden"
    >
      <Plus className="size-6" strokeWidth={2} aria-hidden />
    </button>
  );
}
