/**
 * Luke's portfolio site (lukerlewis/portfolio) reads one file that LukeOS
 * writes when Luke presses Publish: the AI's instructions, what it knows
 * about Luke, and the work it shows. Shared by the screens and the server.
 */

/** Where Publish writes on GitHub. */
export const PORTFOLIO_FILE = "src/content/lukeos.json";

export type PortfolioWork = {
  /** Stable id the site's AI uses to point at a piece of work, made from its short name. */
  id: string;
  title: string;
  /** Short name for buttons. */
  short: string;
  summary: string;
  kind: string;
  year: string;
  /** What the AI may tell visitors about it. */
  facts: string;
};

/** The file the site reads. */
export type PortfolioContent = {
  instructions: string;
  about: string;
  work: PortfolioWork[];
};

export const portfolioTabs = ["prompts", "work", "instructions", "about", "setup"] as const;
export type PortfolioTab = (typeof portfolioTabs)[number];
export const portfolioTabLabel: Record<PortfolioTab, string> = {
  prompts: "Visitor prompts",
  work: "Work",
  instructions: "AI instructions",
  about: "About Luke",
  setup: "Setup",
};

/** "a, b and c" */
export const listOf = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** "Card Grader Pro" -> "card-grader-pro". */
export function slugOf(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "work"
  );
}

/**
 * The site's own text before anything was edited in LukeOS, so the first
 * publish changes nothing a visitor sees.
 */
export const DEFAULT_INSTRUCTIONS = `- Facts come only from <portfolio>. Never invent projects, numbers, employers, dates or skills, and never state something as fact that <portfolio> doesn't say.
- When the visitor asks for an opinion, a judgment or a read on Luke that <portfolio> doesn't answer outright (like his greatest strengths, what he'd be good at, or how he works), give a reasoned best guess instead of declining. Frame it as inference and name what it rests on, like "I'd say Luke's greatest strengths are probably X, based on Y". Ground the basis in <portfolio>, keep it favorable but honest, and keep it to a sentence or two. If <portfolio> gives nothing to reason from, say it isn't covered here and suggest /contact.
- Be warm, direct and brief.
- Always present Luke in the best honest light. Lead with his strengths and what carries over. Never overstate, invent or imply experience he doesn't have: favorable framing, never dishonesty.
- Never give definitive negative verdicts about Luke, like "he isn't the target audience", "he's overqualified", "he's not a fit" or "he lacks". Use soft, open wording instead: "he may be", "a consideration is", "this could be a new area for him", "worth discussing". Stay useful and specific, but never put Luke in a hole.`;

export const DEFAULT_ABOUT = `# Luke Lewis, product designer

## Now
- Product Designer II at Aya Healthcare, a healthcare staffing company. This is my second product design role.
- Moving to Aya's experimental AI team in November 2026.
- I'm the informal AI lead on my design team: an early adopter who makes tutorial videos and runs workshops.

## Point of view
- Real work over performance. Problem first, AI second. Simple beats clever. Doing beats credentials. Don't gatekeep the craft.
- I use AI where it actually solves a problem and skip it where it's theater.
- What I bring: I make the designers around me better. I figure out what actually works with AI, teach it to the team, and keep the craft bar high while we move faster.
- Strengths: I level up the whole team by sharing what I learn, I have high agency and don't wait for permission, and I care a lot about detail and polish.

## How I work
- Scope vs. scalability (Aya Healthcare): I regularly negotiate scope, UX and scalability with engineering, for example an internal tool meant for 1 user at first where an engineer wanted to build for 100.

## Contact
- X, YouTube and LinkedIn: lukerlewis. Email: lukerobertlewis@gmail.com. Use /contact for details.`;
