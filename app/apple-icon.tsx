import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#6d4aff",
        }}
      >
        <div style={{ width: 44, height: 76, borderRadius: 22, background: "#fff" }} />
      </div>
    ),
    size,
  );
}
