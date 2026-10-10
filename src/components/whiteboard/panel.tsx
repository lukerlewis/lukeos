"use client";

import { ArrowDown, ArrowRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULTS, FILLS, TEXT_STYLE_KEYS, TEXT_STYLES, type Align, type Color, type Item, type TextStyle } from "@/lib/whiteboard";
import { fillOf, textColorOf } from "./item-view";

/** The small Figma-style panel for what's selected. */
export function Panel({
  items,
  parent,
  onChange,
  onLayout,
  onAutoLayout,
  onDelete,
}: {
  items: Item[];
  parent: Item | null;
  onChange: (id: string, patch: Partial<Item>) => void;
  onLayout: (id: string, layout: "row" | "column" | null) => void;
  onAutoLayout: () => void;
  onDelete: () => void;
}) {
  const item = items.length === 1 ? items[0] : null;
  const set = (patch: Partial<Item>) => item && onChange(item.id, patch);

  return (
    <div
      data-wb-ui
      className="absolute inset-x-2 bottom-16 flex max-h-[45%] flex-col gap-4 overflow-y-auto rounded-xl border border-stroke bg-card p-3 md:inset-x-auto md:top-3 md:right-3 md:bottom-auto md:max-h-[calc(100%-5rem)] md:w-60"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!item ? (
        <>
          <Row label={`${items.length} selected`}>
            <button type="button" onClick={onAutoLayout} className="h-9 rounded-[8px] px-3 text-preview font-medium text-subtle-foreground hover:bg-muted" title="Shift+A">
              Add auto layout
            </button>
          </Row>
        </>
      ) : item.type === "frame" ? (
        <>
          <Section title="Frame">
            <input
              value={item.name ?? ""}
              onChange={(e) => set({ name: e.target.value || undefined })}
              placeholder="Name"
              className="h-9 w-full rounded-lg border border-stroke-strong bg-card px-2.5 text-base outline-none md:text-preview"
            />
            <Swatches value={item.color ?? DEFAULTS.frame.color} onChange={(color) => set({ color: color === DEFAULTS.frame.color ? undefined : color })} withNone />
          </Section>
          <Section title="Auto layout" aside={<span className="text-tag text-muted-foreground">Shift+A</span>}>
            <Choice
              value={item.layout ?? "none"}
              onChange={(v) => onLayout(item.id, v === "none" ? null : v)}
              options={[
                { value: "none", label: "Off" },
                { value: "column", label: <ArrowDown className="size-4" aria-label="Down" /> },
                { value: "row", label: <ArrowRight className="size-4" aria-label="Across" /> },
              ]}
            />
            {item.layout && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <NumberField label="Gap" value={item.gap ?? DEFAULTS.frame.gap} onChange={(gap) => set({ gap })} />
                  <NumberField label="↔" title="Padding left and right" value={item.padX ?? DEFAULTS.frame.padX} onChange={(padX) => set({ padX })} />
                  <NumberField label="↕" title="Padding top and bottom" value={item.padY ?? DEFAULTS.frame.padY} onChange={(padY) => set({ padY })} />
                </div>
                <Choice<Align>
                  value={item.align ?? "start"}
                  onChange={(align) => set({ align: align === "start" ? undefined : align })}
                  options={
                    item.layout === "column"
                      ? [
                          { value: "start", label: "Left" },
                          { value: "center", label: "Centre" },
                          { value: "end", label: "Right" },
                        ]
                      : [
                          { value: "start", label: "Top" },
                          { value: "center", label: "Middle" },
                          { value: "end", label: "Bottom" },
                        ]
                  }
                />
              </>
            )}
          </Section>
          <Size item={item} set={set} hug={!!item.layout} />
        </>
      ) : item.type === "text" ? (
        <>
          <Section title="Text">
            <select
              value={item.style ?? DEFAULTS.text.style}
              onChange={(e) => set({ style: e.target.value === DEFAULTS.text.style ? undefined : (e.target.value as TextStyle) })}
              className="h-9 w-full rounded-lg border border-stroke-strong bg-card px-2 text-base outline-none md:text-preview"
              aria-label="Text style"
            >
              {TEXT_STYLE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {TEXT_STYLES[k].label} · {Math.round(TEXT_STYLES[k].size)}
                </option>
              ))}
            </select>
            <Choice
              value={item.weight ?? "regular"}
              onChange={(w) => set({ weight: w === "medium" ? "medium" : undefined })}
              options={[
                { value: "regular", label: "Regular" },
                { value: "medium", label: "Medium" },
              ]}
            />
            <Choice<Align>
              value={item.align ?? "start"}
              onChange={(align) => set({ align: align === "start" ? undefined : align })}
              options={[
                { value: "start", label: "Left" },
                { value: "center", label: "Centre" },
                { value: "end", label: "Right" },
              ]}
            />
            <TextColors value={item.color ?? "default"} onChange={(color) => set({ color: color === "default" ? undefined : color })} />
          </Section>
          <Section title="Width">
            <Choice
              value={item.w ? "fixed" : "auto"}
              onChange={(v) => set({ w: v === "auto" ? undefined : 320 })}
              options={[
                { value: "auto", label: "Fit text" },
                { value: "fixed", label: "Fixed" },
              ]}
            />
            {item.w !== undefined && <NumberField label="W" value={item.w} onChange={(w) => set({ w: Math.max(1, w) })} />}
          </Section>
        </>
      ) : item.type === "sticky" ? (
        <Section title="Sticky">
          <Swatches value={item.color ?? DEFAULTS.sticky.color} onChange={(color) => set({ color: color === DEFAULTS.sticky.color ? undefined : color })} />
        </Section>
      ) : item.type === "shape" ? (
        <>
          <Section title="Shape">
            <Choice
              value={item.shape ?? "rect"}
              onChange={(shape) => set({ shape: shape === "rect" ? undefined : shape })}
              options={[
                { value: "rect", label: "Box" },
                { value: "ellipse", label: "Circle" },
                { value: "diamond", label: "Diamond" },
              ]}
            />
            <Swatches value={item.color ?? DEFAULTS.shape.color} onChange={(color) => set({ color: color === DEFAULTS.shape.color ? undefined : color })} />
          </Section>
          <Size item={item} set={set} />
        </>
      ) : (
        <Section title="Arrow">
          <Choice
            value={item.elbow ? "elbow" : "straight"}
            onChange={(v) => set(v === "elbow" ? { elbow: true } : { elbow: undefined, bends: undefined })}
            options={[
              { value: "straight", label: "Straight" },
              { value: "elbow", label: "Elbow" },
            ]}
          />
          {item.bends && (
            <button type="button" onClick={() => set({ bends: undefined })} className="h-9 self-start rounded-[8px] px-2 text-preview text-muted-foreground hover:bg-muted">
              Reset bends
            </button>
          )}
          <input
            value={item.text ?? ""}
            onChange={(e) => set({ text: e.target.value || undefined })}
            placeholder="Label"
            className="h-9 w-full rounded-lg border border-stroke-strong bg-card px-2.5 text-base outline-none md:text-preview"
          />
        </Section>
      )}
      {item && parent?.layout && item.type !== "arrow" && <p className="-mt-2 text-tag text-muted-foreground">In auto layout</p>}
      <button
        type="button"
        onClick={onDelete}
        className="flex h-9 items-center gap-2 self-start rounded-[8px] px-2 text-preview text-muted-foreground hover:bg-muted hover:text-danger"
      >
        <Trash2 className="size-4" aria-hidden />
        Delete
      </button>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-meta font-medium text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-meta font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Size({ item, set, hug }: { item: Item; set: (p: Partial<Item>) => void; hug?: boolean }) {
  const fallback = item.type === "frame" ? DEFAULTS.frame : DEFAULTS.shape;
  return (
    <Section title="Size">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="W" value={item.w ?? (hug ? undefined : fallback.w)} placeholder="Hug" onChange={(w) => set({ w: Math.max(1, w) })} onClear={hug ? () => set({ w: undefined }) : undefined} />
        <NumberField label="H" value={item.h ?? (hug ? undefined : fallback.h)} placeholder="Hug" onChange={(h) => set({ h: Math.max(1, h) })} onClear={hug ? () => set({ h: undefined }) : undefined} />
      </div>
    </Section>
  );
}

/** A number box that saves on Enter or when you leave it. Up and down arrows nudge it (Shift for 10). Empty means "hug" where allowed. */
function NumberField({
  label,
  value,
  onChange,
  onClear,
  placeholder,
  title,
}: {
  label: string;
  title?: string;
  value: number | undefined;
  onChange: (v: number) => void;
  onClear?: () => void;
  placeholder?: string;
}) {
  const shown = value === undefined ? "" : String(Math.round(value));
  // What's being typed; null when the box isn't being edited, so it always shows the latest value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? shown;
  const done = () => {
    const t = (draft ?? "").trim();
    setDraft(null);
    if (draft === null) return;
    if (!t) return onClear?.();
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0 && n !== value) onChange(Math.round(n));
  };
  return (
    <label title={title} className="flex h-9 items-center gap-1.5 rounded-lg border border-stroke-strong bg-card px-2 focus-within:border-ring">
      <span className="shrink-0 text-tag text-muted-foreground">{label}</span>
      <input
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = (Number(text) || value || 0) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
            setDraft(null);
            onChange(Math.max(0, n));
          }
        }}
        className="w-full min-w-0 bg-transparent text-base tabular-nums outline-none placeholder:text-muted-foreground md:text-preview"
      />
    </label>
  );
}

function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[] }) {
  return (
    <div role="radiogroup" className="seg-track flex gap-0.5 rounded-lg p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-8 grow basis-0 items-center justify-center rounded-[8px] px-1.5 text-meta font-medium text-muted-foreground",
            value === o.value && "seg-on text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Swatches({ value, onChange, withNone }: { value: Color; onChange: (c: Color) => void; withNone?: boolean }) {
  const list: Color[] = withNone ? ["none", ...FILLS] : FILLS;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((c) => (
        <button
          key={c}
          type="button"
          title={c === "none" ? "No fill" : c[0].toUpperCase() + c.slice(1)}
          aria-label={c === "none" ? "No fill" : c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            "relative size-7 overflow-hidden rounded-full border border-stroke",
            value === c && "outline-[1.5px] outline-offset-2 outline-[var(--wb-select)] outline-solid",
          )}
          style={{ background: fillOf(c) }}
        >
          {c === "none" && <span className="absolute top-1/2 left-1/2 h-px w-8 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-stroke-strong" />}
        </button>
      ))}
    </div>
  );
}

function TextColors({ value, onChange }: { value: Color; onChange: (c: Color) => void }) {
  const list: Color[] = ["default", "muted", "yellow", "orange", "red", "pink", "purple", "blue", "green"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((c) => (
        <button
          key={c}
          type="button"
          title={c === "default" ? "Default" : c[0].toUpperCase() + c.slice(1)}
          aria-label={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            "flex size-7 items-center justify-center rounded-full border border-stroke text-preview font-medium",
            value === c && "outline-[1.5px] outline-offset-2 outline-[var(--wb-select)] outline-solid",
          )}
          style={{ color: textColorOf(c) }}
        >
          A
        </button>
      ))}
    </div>
  );
}
