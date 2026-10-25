import type { MetadataRoute } from "next";
import { HOME_DESCRIPTION } from "../lib/seo/content";
import { getSiteUrl } from "../lib/seo/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VibeCheck",
    short_name: "VibeCheck",
    description: HOME_DESCRIPTION,
    id: `${getSiteUrl()}/`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#101410",
    theme_color: "#101410",
    lang: "en",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
