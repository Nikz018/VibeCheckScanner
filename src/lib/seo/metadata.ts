import type { Metadata } from "next";
import { HOME_DESCRIPTION, HOME_TITLE, OG_HEIGHT, OG_IMAGE_ALT, OG_IMAGE_PATH, OG_WIDTH, SITE_NAME, getPublicPage, type PublicPageId } from "./content";
import { absoluteUrl, getSiteUrl } from "./site";

export function ogImage() {
  return {
    url: absoluteUrl(OG_IMAGE_PATH),
    width: OG_WIDTH,
    height: OG_HEIGHT,
    alt: OG_IMAGE_ALT,
  };
}

export function rootMetadata(): Metadata {
  const image = ogImage();
  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: HOME_TITLE,
      template: `%s · ${SITE_NAME}`,
    },
    description: HOME_DESCRIPTION,
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    category: "security",
    alternates: { canonical: absoluteUrl("/") },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: absoluteUrl("/"),
      siteName: SITE_NAME,
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      images: [image.url],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    formatDetection: { email: false, address: false, telephone: false },
    manifest: "/manifest.webmanifest",
  };
}

export function pageMetadata(id: PublicPageId): Metadata {
  const page = getPublicPage(id);
  const canonical = absoluteUrl(page.path);
  const branded = page.absoluteTitle ?? `${page.title} · ${SITE_NAME}`;
  const image = ogImage();
  return {
    title: page.absoluteTitle ? { absolute: page.absoluteTitle } : page.title,
    description: page.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: canonical,
      siteName: SITE_NAME,
      title: branded,
      description: page.description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: branded,
      description: page.description,
      images: [image.url],
    },
    robots: { index: true, follow: true },
  };
}

/** Signed-in and auth screens. robots.txt also disallows these paths. */
export function privateMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false, nocache: true },
  };
}

/** Opt-in public score pages. Finding details are not on this URL. */
export function shareMetadata(token: string): Metadata {
  const canonical = absoluteUrl(`/share/${token}`);
  return {
    title: "Public security score",
    description: "A VibeCheck public score shows the score out of 100 and the scan date. It does not list findings.",
    alternates: { canonical },
    openGraph: {
      title: `Public security score · ${SITE_NAME}`,
      description: "Score out of 100 and the scan date. Finding details stay in the account.",
      url: canonical,
      siteName: SITE_NAME,
      images: [ogImage()],
    },
    twitter: {
      card: "summary_large_image",
      title: `Public security score · ${SITE_NAME}`,
      images: [ogImage().url],
    },
    robots: { index: true, follow: true },
  };
}
