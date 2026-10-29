import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI 翻唱工坊",
    short_name: "AI 翻唱",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4ff",
    theme_color: "#6d4aff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
