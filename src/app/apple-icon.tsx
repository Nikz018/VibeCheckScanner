import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "180px",
          height: "180px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#dff25b",
          color: "#14201b",
          fontSize: 78,
          fontWeight: 700,
          borderRadius: 36,
        }}
      >
        VC
      </div>
    ),
    { ...size },
  );
}
