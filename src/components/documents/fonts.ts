import localFont from "next/font/local";

/** Inter, the typeface on every document page and in its PDF, so the page prints as it looks. */
export const documentFont = localFont({
  src: [
    { path: "../../assets/fonts/Inter-Latin.woff2", weight: "400 700", style: "normal" },
    { path: "../../assets/fonts/Inter-Latin-Italic.woff2", weight: "400 700", style: "italic" },
  ],
  variable: "--font-document",
  display: "swap",
});
