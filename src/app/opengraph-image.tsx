import { ImageResponse } from "next/og";
import { OG_HEIGHT, OG_IMAGE_ALT, OG_WIDTH } from "@/lib/seo/content";
import { scoreBand } from "@/lib/score-gauge";

export const alt = OG_IMAGE_ALT;
export const size = { width: OG_WIDTH, height: OG_HEIGHT };
export const contentType = "image/png";

const EXAMPLE_SCORE = 72;

export default function OpenGraphImage() {
  const band = scoreBand(EXAMPLE_SCORE);
  const ring = 2 * Math.PI * 78;
  const dash = (EXAMPLE_SCORE / 100) * ring;
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
            <svg width="240" height="240" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="78" fill="none" stroke="#e4dfd2" strokeWidth="12" />
              <circle
                cx="100"
                cy="100"
                r="78"
                fill="none"
                stroke={band.color}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${ring}`}
                transform="rotate(-90 100 100)"
              />
              <text x="100" y="96" textAnchor="middle" fill="#14201b" fontSize="28" fontWeight={700}>
                72/100
              </text>
              <text x="100" y="122" textAnchor="middle" fill={band.color} fontSize="14">
                {band.label}
              </text>
            </svg>
            <div style={{ display: "flex", fontSize: 16, color: "#536058", marginTop: 8 }}>Example gauge</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
