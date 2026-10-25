import { ImageResponse } from "next/og";
import { OG_HEIGHT, OG_IMAGE_ALT, OG_WIDTH } from "@/lib/seo/content";
import { scoreBand } from "@/lib/score-gauge";

export const alt = OG_IMAGE_ALT;
export const size = { width: OG_WIDTH, height: OG_HEIGHT };
export const contentType = "image/png";

const EXAMPLE_SCORE = 72;

function gaugePaths(score: number) {
  const radius = 74;
  const cx = 100;
  const cy = 96;
  const track = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 0 ${cx + radius} ${cy}`;
  const theta = Math.PI * (1 - score / 100);
  const x = cx + radius * Math.cos(theta);
  const y = cy - radius * Math.sin(theta);
  const progress = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 0 ${x.toFixed(1)} ${y.toFixed(1)}`;
  return { track, progress };
}

export default function OpenGraphImage() {
  const band = scoreBand(EXAMPLE_SCORE);
  const { track, progress } = gaugePaths(EXAMPLE_SCORE);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#101410",
          color: "#f4f0e6",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "64px",
            flex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: "#dff25b",
                color: "#14201b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              VC
            </div>
            <div style={{ display: "flex", marginLeft: 16, fontSize: 32 }}>VibeCheck</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 68, lineHeight: 0.95, letterSpacing: -1 }}>
            <div style={{ display: "flex" }}>Ship the vibe.</div>
            <div style={{ display: "flex" }}>Check the doors.</div>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#d9d3c5" }}>Security scanner for vibe-coded apps</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", paddingRight: 56 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              background: "#f4f0e6",
              color: "#14201b",
              borderRadius: 28,
              padding: "28px 32px 24px",
              width: 360,
            }}
          >
            <svg width="280" height="150" viewBox="0 0 200 120">
              <path d={track} fill="none" stroke="#e4dfd2" strokeWidth="14" strokeLinecap="round" />
              <path d={progress} fill="none" stroke={band.color} strokeWidth="14" strokeLinecap="round" />
            </svg>
            <div style={{ display: "flex", fontSize: 48, fontWeight: 700, marginTop: 8 }}>72/100</div>
            <div style={{ display: "flex", fontSize: 22, color: band.color, marginTop: 4 }}>{band.label}</div>
            <div style={{ display: "flex", fontSize: 16, color: "#536058", marginTop: 8 }}>Example gauge</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
