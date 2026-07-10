import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "JR's List — NYC housing listings, mostly under $3,000";

/** Social-share (Open Graph) card: logo, site name, and tagline. */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 48,
          background: "#18181b",
          color: "#fafafa",
        }}
      >
        {/* List logo, matching src/app/icon.svg */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: "flex", gap: 26, alignItems: "center" }}>
              <div style={{ width: 36, height: 36, background: "#f59e0b" }} />
              <div
                style={{
                  width: 118,
                  height: 36,
                  background: "#fafafa",
                  borderRadius: 9,
                }}
              />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", fontSize: 88, fontWeight: 700 }}>
          JR&apos;s List
        </div>
        <div style={{ display: "flex", fontSize: 36, color: "#a1a1aa" }}>
          NYC housing listings, mostly{" "}
          <span style={{ color: "#f87171", marginLeft: 12 }}>under $3,000</span>
        </div>
      </div>
    ),
    size,
  );
}
