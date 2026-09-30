import { ImageResponse } from "next/og";

/** The LukeOS app icon: a white "L" on a near-black square, as in the sidebar. */
export function appIcon(size: number, { rounded = false } = {}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          color: "#fafafa",
          fontSize: size * 0.56,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          borderRadius: rounded ? size * 0.22 : 0,
        }}
      >
        L
      </div>
    ),
    { width: size, height: size },
  );
}
