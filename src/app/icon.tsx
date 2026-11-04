import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "192px",
          height: "192px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ff6a3d",
          color: "#1a100c",
          fontSize: 84,
          fontWeight: 700,
          borderRadius: 40,
        }}
      >
        VC
      </div>
    ),
    { ...size },
  );
}
