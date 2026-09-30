/** The colours a project can have. Stored by name so they can be restyled later. */
export const projectColors = {
  orange: "#ea580c",
  blue: "#2563eb",
  violet: "#7c3aed",
  teal: "#0d9488",
  pink: "#db2777",
  green: "#16a34a",
  amber: "#d97706",
  slate: "#64748b",
} as const;

export type ProjectColor = keyof typeof projectColors;
export const projectColorNames = Object.keys(projectColors) as [ProjectColor, ...ProjectColor[]];

export function colorHex(name: string) {
  return projectColors[name as ProjectColor] ?? projectColors.slate;
}
