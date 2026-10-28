import { DEFAULT_STALE_DAYS } from "../badge";
import { limitationsParagraph } from "../limitations";
import { FREE_TIER, TAX_NOTE, TIERS } from "../pricing";
import { SEVERITY_WEIGHTS } from "../score";

export const SITE_NAME = "VibeCheck";

export const DEFINITION =
  "VibeCheck is a security scanner for vibe-coded apps that checks a Lovable, Bolt, Cursor, Replit, v0, Supabase, or Firebase app you own and reports leaked keys, open databases, missing authentication, and other launch issues.";

export const DISCLAIMER =
  "VibeCheck scans origins you prove you own. Reports are a point-in-time look at findings and fixes, not a certification.";

export const HOME_TITLE = "VibeCheck — security scanner for vibe-coded apps";

export const HOME_DESCRIPTION =
  "VibeCheck scans Lovable, Bolt, Cursor, Replit, v0, Supabase, and Firebase apps you own for leaked keys, open data, and missing auth.";

export const OG_IMAGE_ALT =
  "VibeCheck score gauge on a dark card with the line Ship the vibe. Check the doors. The gauge is an example, not a scan result.";

export const OG_IMAGE_PATH = "/opengraph-image";
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export const ISSUE_CHECKS_ANSWER =
  "VibeCheck checks a vibe-coded app for leaked API keys, open Supabase row level security and Firebase rules, missing authentication, user IDs in URLs, paywall bypass, exposed env and admin routes, weak security headers, and related launch issues.";

export interface IssueCheck {
  title: string;
  answer: string;
}

export const ISSUE_CHECKS: IssueCheck[] = [
  {
    title: "Leaked API keys",
    answer:
      "VibeCheck looks for private credentials in downloaded JavaScript and on public paths, including service-role keys and secrets placed in NEXT_PUBLIC_ or VITE_ variables.",
  },
  {
    title: "Supabase row level security",
    answer:
      "VibeCheck checks whether a table or realtime channel can be read or written with the public anon key that the app already ships to the browser.",
  },
  {
    title: "Firebase security rules",
    answer: "VibeCheck checks whether the Firebase project returns data to a request that has no signed-in user.",
  },
  {
    title: "Missing authentication",
    answer: "VibeCheck requests admin pages and APIs without a session to see whether they return privileged data.",
  },
  {
    title: "User IDs in URLs",
    answer: "VibeCheck checks whether substituting another sequential id on a read-only request returns someone else's record.",
  },
  {
    title: "Paywall bypass",
    answer:
      "VibeCheck checks whether a premium feature is enforced only in the browser, or a payment webhook accepts a body with no signature.",
  },
  {
    title: "Exposed env files",
    answer: "VibeCheck requests paths such as .env, .git metadata, and source maps that should never be on a public host.",
  },
  {
    title: "Security headers, CORS, and cookies",
    answer:
      "VibeCheck checks HTTPS, Content-Security-Policy, HSTS, cookie flags, and CORS that allows any origin with credentials.",
  },
  {
    title: "Open storage buckets",
    answer: "VibeCheck checks whether a storage bucket or upload folder can be listed without a signed-in user.",
  },
  {
    title: "Open AI routes",
    answer: "VibeCheck checks whether a model route answers without authentication, has no rate limit, or returns a system prompt.",
  },
];

export function monitoringPriceWords(): string {
  return `$${TIERS.monitor.amountUsd} per month`;
}

export function priceAnswer(): string {
  return `A VibeCheck scan costs ${FREE_TIER.priceLabel} for a teaser, ${TIERS.report.priceLabel} for a full report, ${TIERS.rescan.priceLabel} for that report plus one fix rescan, or ${monitoringPriceWords()} for monitoring, plus applicable taxes.`;
}

export function scoreAnswer(): string {
  return `The score starts at 100, and each finding subtracts ${SEVERITY_WEIGHTS.critical} for critical, ${SEVERITY_WEIGHTS.high} for high, ${SEVERITY_WEIGHTS.medium} for medium, or ${SEVERITY_WEIGHTS.low} for low. Reports label 0–39 as Critical risk, 40–69 as Needs work, 70–89 as Good, and 90–100 as Strong.`;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ: FaqItem[] = [
  {
    question: "What is VibeCheck?",
    answer: `${DEFINITION} ${DISCLAIMER}`,
  },
  {
    question: "What does VibeCheck check?",
    answer: ISSUE_CHECKS_ANSWER,
  },
  {
    question: "Which apps can VibeCheck scan?",
    answer:
      "VibeCheck scans a web origin you prove you own, including apps built with Lovable, Bolt, Cursor, Replit, v0, Supabase, or Firebase.",
  },
  {
    question: "How much does VibeCheck cost?",
    answer: priceAnswer(),
  },
  {
    question: "What is included in the free teaser?",
    answer:
      "The free teaser runs the scan and shows the score, the real severity counts, family coverage, and the lowest-severity finding in full. Every other finding stays off the page. Logged-in checks are available in the full report.",
  },
  {
    question: `What is the difference between the ${TIERS.report.priceLabel} report and the ${TIERS.rescan.priceLabel} plan?`,
    answer: `The ${TIERS.report.priceLabel} plan unlocks the full report for one finished scan, and the ${TIERS.rescan.priceLabel} plan unlocks that report plus one credit to rescan after you ship fixes. Both include signed-in checks when you provide throwaway test accounts.`,
  },
  {
    question: "What this scan does not cover?",
    answer: limitationsParagraph(),
  },
  {
    question: "What does monitoring include?",
    answer: `Monitoring costs ${monitoringPriceWords()} and includes full reports while the subscription is active, a scheduled rescan of a verified app, and an alert when a new high-severity issue appears, plus applicable taxes.`,
  },
  {
    question: "Do I have to prove I own the app?",
    answer:
      "Yes. VibeCheck does not start active probes until you serve a one-time token over DNS TXT or /.well-known/vibecheck-verify.txt and check the consent box.",
  },
  {
    question: "Is a VibeCheck report a security certification?",
    answer: `No. ${DISCLAIMER} It does not promise the app stays safe after the scan date.`,
  },
  {
    question: "Can I share my score publicly?",
    answer: `Yes. You can opt in to a public page and an SVG badge that show the score out of 100 and the scan date, and after ${DEFAULT_STALE_DAYS} days they read rescan needed. Finding details stay in your account.`,
  },
  {
    question: "How is the VibeCheck score calculated?",
    answer: scoreAnswer(),
  },
  {
    question: "Are taxes included in the price?",
    answer: `No. The listed prices are ${TAX_NOTE}.`,
  },
];

export interface CopyBlock {
  heading: string;
  paragraphs: string[];
  code?: string;
}

export const HOW_TO_STEPS: CopyBlock[] = [
  {
    heading: "How do I prove I own the origin?",
    paragraphs: [
      "Publish the one-time token as a DNS TXT record on the hostname, or on _vibecheck, or as the entire body of /.well-known/vibecheck-verify.txt on that origin.",
    ],
  },
  {
    heading: "What consent does VibeCheck require?",
    paragraphs: [
      "Check the consent box in the scan form. Active probes do not start until both the ownership proof and the consent box are present.",
    ],
  },
  {
    heading: "What does the scan actually request?",
    paragraphs: [
      "VibeCheck requests pages and public files, and it may send a few tiny unauthenticated POST requests to see whether a login, webhook, or AI route rejects bad input. It does not send PUT, PATCH, or DELETE. A paid full report can also sign in with up to two throwaway test accounts and then send only GET and HEAD, plus that login request.",
    ],
  },
  {
    heading: "What do I see when the scan finishes?",
    paragraphs: [
      "A finished scan shows a score out of 100, family-by-family coverage, the real severity counts, and, on the free teaser, the lowest-severity finding. Every other finding stays off that page.",
    ],
  },
  {
    heading: "How do I unlock the full report?",
    paragraphs: [
      `The ${TIERS.report.priceLabel} plan unlocks every finding on that scan, with location, redacted evidence, and a copy-paste fix. The ${TIERS.rescan.priceLabel} plan adds one credit to rescan after you ship fixes. ${monitoringPriceWords()} monitoring schedules rescans and alerts you when a new high-severity issue appears. Listed prices are ${TAX_NOTE}.`,
    ],
  },
];

export const HOW_TO_EXTRAS: CopyBlock[] = [
  {
    heading: "What will the worker refuse to do?",
    paragraphs: [
      "The worker does not send PUT, PATCH, or DELETE, and it refuses link-local and metadata addresses. It does not start probes until the ownership file or DNS TXT record is in place and the consent box is checked.",
    ],
  },
];

export const RLS_POLICY_EXAMPLE = `alter table public.users enable row level security;

create policy "read own row"
on public.users
for select
to authenticated
using (auth.uid() = id);`;

export const FIREBASE_DENY_EXAMPLE = `{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}`;

export const PRICING_SECTIONS: CopyBlock[] = [
  {
    heading: "What does the free teaser include?",
    paragraphs: [
      "The free teaser runs the full scan, stores it on your account, and shows the score, the real severity counts, which families ran, and the lowest-severity finding in full.",
      "Every other finding, including its location and fix, stays off the page until you buy a report.",
    ],
  },
  {
    heading: `What does the ${TIERS.report.priceLabel} full report include?`,
    paragraphs: [
      `The ${TIERS.report.priceLabel} one-time plan unlocks every finding on that scan: where it was found, redacted evidence, the request and a short response, and a fix you can paste.`,
      "You can download the unlocked report as a PDF or as a Markdown file. Signed-in checks are included when you add up to two throwaway test accounts. The free teaser does not run them. The price excludes applicable taxes. Paying does not run a new scan.",
    ],
  },
  {
    heading: `What does the ${TIERS.rescan.priceLabel} plan add?`,
    paragraphs: [
      `The ${TIERS.rescan.priceLabel} one-time plan unlocks the same full report and adds one credit to run another scan after you ship fixes.`,
      "The rescan still requires ownership proof and consent. The price excludes applicable taxes.",
    ],
  },
  {
    heading: `What does ${monitoringPriceWords()} monitoring include?`,
    paragraphs: [
      `Monitoring is ${monitoringPriceWords()}, plus applicable taxes, and it keeps full reports available while the subscription is active.`,
      "It schedules a rescan of a verified app and stores an alert when a new high-severity issue appears. Email goes out only when mail is configured; the dashboard alert is stored either way.",
    ],
  },
];

export interface GuideDoc {
  sections: CopyBlock[];
  related: PublicPageId[];
}

export type PublicPageId =
  | "home"
  | "pricing"
  | "faq"
  | "how-it-works"
  | "guides"
  | "guide-lovable"
  | "guide-rls"
  | "guide-keys"
  | "demo-report"
  | "terms"
  | "privacy"
  | "refund"
  | "contact"
  | "scanner-info";

export const GUIDES: Record<"guide-lovable" | "guide-rls" | "guide-keys", GuideDoc> = {
  "guide-lovable": {
    related: ["guide-rls", "guide-keys", "how-it-works", "pricing"],
    sections: [
      {
        heading: "What should I verify before launch?",
        paragraphs: [
          "Verify data access, secrets in the client, admin routes, and paywalls on the origin you own before you treat a Lovable preview as ready.",
          "VibeCheck can run that review after you publish a DNS TXT record or a well-known file and check the consent box.",
        ],
      },
      {
        heading: "Can the public Supabase key read my tables?",
        paragraphs: [
          "The anon key in the browser is public by design, so a table with row level security off, or a policy that allows the anon role, is readable by anyone who loads the app.",
          "Turn on row level security and add a policy that limits rows to the signed-in user before you ship.",
        ],
      },
      {
        heading: "What if the app uses Firebase?",
        paragraphs: [
          "Firebase client config is public, and the project returns data to strangers when the rules allow a read with no signed-in user.",
          "Start from deny-all rules, then open a path only to the signed-in user who owns that record.",
        ],
        code: FIREBASE_DENY_EXAMPLE,
      },
      {
        heading: "Are secrets sitting in the generated client?",
        paragraphs: [
          "A service-role key, secret API key, or private token in the JavaScript bundle is already exposed, because the browser downloads that file.",
          "Remove it, rotate it, and keep the replacement in a server-only variable that is not prefixed with NEXT_PUBLIC_ or VITE_.",
        ],
      },
      {
        heading: "Does hiding an admin link protect the route?",
        paragraphs: [
          "Hiding a link does not protect an admin page or API that still returns data when no session cookie is sent.",
          "The route has to check the session on the server and return 401 or 403 when the cookie is missing.",
        ],
      },
      {
        heading: "Can a visitor skip a paywall in the browser?",
        paragraphs: [
          "A premium flag that lives only in client state can be changed in the browser, and a payment webhook that does not check a signature can be called by anyone.",
          "Enforce the purchase on the server, and verify the webhook signature before granting access.",
        ],
      },
      {
        heading: "What will a VibeCheck report not promise?",
        paragraphs: [
          `A finished report is a point-in-time list of findings and fixes for the origin you scanned. ${DISCLAIMER}`,
        ],
      },
    ],
  },
  "guide-rls": {
    related: ["guide-lovable", "guide-keys", "how-it-works"],
    sections: [
      {
        heading: "Does the anon key count as a secret?",
        paragraphs: [
          "No. The anon key is meant to be in the client, and it can read any table that grants the anon role or leaves row level security off.",
          "Treat the key as public and lock the tables.",
        ],
      },
      {
        heading: "How do I check a table before launch?",
        paragraphs: [
          "Request the table with the anon key and confirm you cannot select rows you would not paste into a public chat.",
          "Enable row level security, add a policy, and repeat that request before you ship.",
        ],
      },
      {
        heading: "What policy should a user-owned table use?",
        paragraphs: [
          "Give the authenticated role a policy that compares the row owner to auth.uid(), and do not add a policy that lets anon select every row.",
          "Repeat that for every table in the public schema the client can touch.",
        ],
        code: RLS_POLICY_EXAMPLE,
      },
      {
        heading: "What about storage buckets?",
        paragraphs: [
          "A storage bucket that allows public listing shows every object to anyone who knows the project URL.",
          "Require a signed-in user, and scope the path to that user, before you mark the bucket public.",
        ],
      },
      {
        heading: "What should I do if the table was already readable?",
        paragraphs: [
          "Assume the rows were copied, rotate any secrets that were in those rows, and turn on row level security before the next deploy.",
          "Changing the policy later does not pull data back from someone who already downloaded it.",
        ],
      },
      {
        heading: "How does VibeCheck report an open table?",
        paragraphs: [
          "On an origin you own, VibeCheck tries the public client key that the bundle already contains and reports a table that returns rows without a signed-in user.",
          "The paid report includes every finding, with location, a short redacted response, and a copy-paste fix. The free teaser shows one finding, the lowest severity, and only the counts for the rest.",
        ],
      },
    ],
  },
  "guide-keys": {
    related: ["guide-lovable", "guide-rls", "how-it-works"],
    sections: [
      {
        heading: "Which keys are safe in the browser?",
        paragraphs: [
          "A publishable client key, such as a Supabase anon key, is meant to ship in the browser only because server rules limit what it can do.",
          "A service-role key, a secret API key, or a private token is not safe in the browser, because it acts as your server.",
        ],
      },
      {
        heading: "Why do generated apps leak server keys?",
        paragraphs: [
          "A generator can paste a secret into a client component, or into a NEXT_PUBLIC_ or VITE_ variable, so the browser calls the provider directly.",
          "That file is downloaded by every visitor who opens the app.",
        ],
      },
      {
        heading: "Where else do keys show up?",
        paragraphs: [
          "Keys also show up in a .env file left on the host, in git metadata, in a source map, and on a debug route that prints the environment.",
          "Those URLs do not need the app UI to be opened.",
        ],
      },
      {
        heading: "What should I do after a key is exposed?",
        paragraphs: [
          "Rotate the key in the provider dashboard first, because deleting the file does not invalidate a key someone already copied.",
          "Then remove it from the client and from the deploy artifact, store the new value in a server-only variable, and call the provider from a server route that returns only the data the page needs.",
        ],
      },
      {
        heading: "How does VibeCheck report a leaked key?",
        paragraphs: [
          "VibeCheck reports the file or URL where the credential appeared and redacts the secret in the report.",
          "The free teaser shows the lowest-severity finding in full and the counts for everything else. The paid report includes every finding, with redacted evidence and the fix steps.",
        ],
      },
    ],
  },
};

const CONTACT_LINE = "Use the email address published on the contact page.";

export const LEGAL_SECTIONS: Record<"terms" | "privacy" | "refund" | "contact", CopyBlock[]> = {
  terms: [
    {
      heading: "Who do these terms apply to?",
      paragraphs: ["These terms apply to anyone who creates a VibeCheck account or starts a scan."],
    },
    {
      heading: "What does VibeCheck provide?",
      paragraphs: [
        "VibeCheck provides a point-in-time security report for a web origin you prove you own, plus optional paid unlocks and monitoring described on the pricing page.",
        DISCLAIMER,
      ],
    },
    {
      heading: "What do I have to prove before a scan?",
      paragraphs: [
        "You have to serve a one-time token by DNS TXT or /.well-known/vibecheck-verify.txt and check the consent box before active probes start.",
        "You represent that you are allowed to authorize that scan.",
      ],
    },
    {
      heading: "What am I not allowed to scan?",
      paragraphs: [
        "Do not submit an origin you do not control, and do not use a report to attack someone else's app.",
        "The worker is limited to read-only requests plus a few tiny unauthenticated POSTs. That limit is not permission to point it at a third party.",
      ],
    },
    {
      heading: "How do accounts work?",
      paragraphs: [
        "Sign-in is an email link. The link expires quickly, and the session cookie keeps you signed in until it expires or you sign out.",
        "You are responsible for the mailbox you use.",
      ],
    },
    {
      heading: "How much do the paid plans cost?",
      paragraphs: [priceAnswer(), "Checkout is handled by the payment provider configured for this site. A failed payment does not unlock a report."],
    },
    {
      heading: "Is a report a certification?",
      paragraphs: [
        "No. A report lists findings from one scan date, with fixes you can paste into the app you own.",
        "It does not promise that the app stays in that condition after you deploy again.",
      ],
    },
    {
      heading: "Who can use the report?",
      paragraphs: [
        "You can use the unlocked report, PDF, and Markdown file to fix the app you scanned, including pasting a fix into a coding assistant.",
        "The public score page, when you opt in, shows the score and date only.",
      ],
    },
    {
      heading: "What does a report not promise?",
      paragraphs: [
        "A report is a point-in-time list of findings and fixes. It is not a warranty that the app is secure, and it is not legal advice.",
        "It does not promise that the app stays in that condition after you deploy again.",
      ],
    },
    {
      heading: "How do I contact you about these terms?",
      paragraphs: [`${CONTACT_LINE} Include the account email.`],
    },
  ],
  privacy: [
    {
      heading: "What does this privacy page cover?",
      paragraphs: ["This page describes the account, scan, and payment data the current VibeCheck app stores."],
    },
    {
      heading: "What account data do you store?",
      paragraphs: [
        "We store the email address you use to sign in, a hash of the magic-link token, and a hash of the session token.",
        "The magic link expires in 30 minutes. The session cookie is named vc_session, is httpOnly, and lasts 30 days unless you sign out.",
      ],
    },
    {
      heading: "What scan data do you store?",
      paragraphs: [
        "We store the origin you submit, the ownership token, consent time, scan status, score, coverage, and findings for that scan.",
        "A finding can include a short request and response excerpt. Secrets in that excerpt are redacted before they are shown in the report.",
      ],
    },
    {
      heading: "What does the payment provider receive?",
      paragraphs: [
        "Paid checkout is handled by the payment provider configured for this site. That provider processes the card. VibeCheck stores the customer id, checkout session id, and payment status the provider returns, not the full card number.",
        "A monitoring subscription also stores the subscription id and status.",
      ],
    },
    {
      heading: "Which cookies do you set?",
      paragraphs: [
        "The app sets the vc_session cookie so you stay signed in. It is not an advertising cookie.",
        "The app does not set analytics or marketing cookies.",
      ],
    },
    {
      heading: "What does a public score page show?",
      paragraphs: [
        "A public score page exists only after you turn sharing on. It shows the score out of 100, the scan date, and a rescan-needed state when the scan is stale.",
        "It does not list findings. Turn sharing off to stop serving that page.",
      ],
    },
    {
      heading: "How long do you keep data?",
      paragraphs: [
        "Magic links expire in 30 minutes and the session cookie expires in 30 days unless you sign out.",
        "Account rows, scan rows, findings, and alerts stay until you ask for them to be removed. Email the address on the contact page from the account mailbox to ask.",
      ],
    },
    {
      heading: "How do I ask a privacy question?",
      paragraphs: [`${CONTACT_LINE} Send it from the account mailbox and describe the request.`],
    },
  ],
  refund: [
    {
      heading: "Which purchases does this cover?",
      paragraphs: [
        `This covers the ${TIERS.report.priceLabel} full report, the ${TIERS.rescan.priceLabel} report plus rescan, and ${monitoringPriceWords()} monitoring, each plus applicable taxes.`,
        "The free teaser has no charge.",
      ],
    },
    {
      heading: "When is a paid report delivered?",
      paragraphs: [
        "For a finished full scan, a successful payment unlocks the report already stored for that scan. For a mini check, a successful payment starts a full scan of that origin. Retrying that full scan does not charge you again.",
        "The rescan credit is used later, when you start another scan. Monitoring unlocks full reports while the subscription status is active.",
      ],
    },
    {
      heading: "Can I get a refund on a one-time purchase?",
      paragraphs: [
        "Email the address on the contact page if you were charged and the paid scan did not produce a report after ownership proof and consent both succeeded. Include the account email, the scan id if you have one, and the receipt.",
      ],
    },
    {
      heading: "How do I cancel monitoring?",
      paragraphs: [
        "Cancel monitoring from the dashboard while you are signed in and the subscription is active. Cancellation is sent to the payment provider.",
        "Scheduled rescans stop when the subscription is no longer active. This page does not promise a refund of the current period.",
      ],
    },
    {
      heading: "How do I ask for a refund?",
      paragraphs: [`${CONTACT_LINE} Include the account email, the scan id if you have one, and the receipt from the payment provider.`],
    },
  ],
  contact: [
    {
      heading: "How do I contact VibeCheck?",
      paragraphs: [
        "Email the address shown on this page. Use it for scan questions, receipts, refund requests, and privacy requests.",
        "If this page does not show an address, a support mailbox is not configured on this server.",
      ],
    },
    {
      heading: "Where do I report unwanted scan traffic?",
      paragraphs: [
        "Use the abuse address on this page and on the scanner info page. Include the time in UTC, the URL that was requested, and the source address if you have it.",
        "That address is the mailbox the operator set for abuse reports. If the page does not show one, use the product email and put abuse report in the subject.",
      ],
    },
    {
      heading: "What should I include in the message?",
      paragraphs: [
        "Include the email on the VibeCheck account, the origin you scanned, and the scan id from the dashboard when you have one.",
        "Do not paste live secret keys into the email. Say which finding you mean and rotate the key in the provider dashboard.",
      ],
    },
    {
      heading: "Is this the address a payment provider should use?",
      paragraphs: ["Yes, when an address is shown on this page. Use it for receipts and payment questions."],
    },
  ],
};

export interface PublicPage {
  id: PublicPageId;
  path: string;
  /** Title segment. The layout template adds " · VibeCheck" unless absoluteTitle is set. */
  title: string;
  absoluteTitle?: string;
  description: string;
  h1: string;
  lede: string;
  crumb: string;
  changeFrequency: "weekly" | "monthly" | "yearly";
  priority: number;
}

export const PUBLIC_PAGES: PublicPage[] = [
  {
    id: "home",
    path: "/",
    title: "VibeCheck",
    absoluteTitle: HOME_TITLE,
    description: HOME_DESCRIPTION,
    h1: "Ship the vibe. Check the doors.",
    lede: DEFINITION,
    crumb: "Home",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    id: "pricing",
    path: "/pricing",
    title: "Pricing",
    description: `Free teaser, ${TIERS.report.priceLabel} full report, ${TIERS.rescan.priceLabel} report plus rescan, and ${monitoringPriceWords()} monitoring, plus applicable taxes.`,
    h1: "How much does VibeCheck cost?",
    lede: priceAnswer(),
    crumb: "Pricing",
    changeFrequency: "weekly",
    priority: 0.9,
  },
  {
    id: "faq",
    path: "/faq",
    title: "FAQ",
    description:
      "Answers on what VibeCheck scans, what the free teaser includes, how the paid plans differ, and why a report is not a certification.",
    h1: "Frequently asked questions",
    lede: "These answers cover what VibeCheck scans, what you pay, and what a finished report does and does not mean.",
    crumb: "FAQ",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    id: "how-it-works",
    path: "/how-it-works",
    title: "How a scan works",
    description:
      "Prove ownership, consent, and VibeCheck runs read-only checks that return a score, coverage, and a point-in-time security report.",
    h1: "How does a VibeCheck scan work?",
    lede: "A VibeCheck scan starts only after you prove you own the origin and consent, then runs read-only checks and returns a score and a report.",
    crumb: "How it works",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    id: "guides",
    path: "/guides",
    title: "Guides",
    description: "Short guides on Lovable app security, Supabase row level security, and API keys leaked by vibe-coded apps.",
    h1: "What should I read before a VibeCheck scan?",
    lede: "Read the Lovable, Supabase row level security, and leaked API key guides, then scan an origin you prove you own.",
    crumb: "Guides",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    id: "guide-lovable",
    path: "/guides/is-my-lovable-app-secure",
    title: "Is my Lovable app secure?",
    description:
      "A Lovable preview is not a security check. Review database rules, client secrets, admin routes, and paywalls on an origin you own.",
    h1: "Is my Lovable app secure?",
    lede: "A Lovable app is secure only when the database rules, server-side auth, and client bundle match what the UI shows; a working preview does not check those.",
    crumb: "Lovable apps",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    id: "guide-rls",
    path: "/guides/supabase-rls-checklist",
    title: "Supabase RLS checklist",
    description:
      "Turn on row level security for every exposed Supabase table and add policies that limit rows to the signed-in user before you ship.",
    h1: "Is row level security on for my Supabase tables?",
    lede: "Row level security is on only when every table the client can reach has RLS enabled and a policy that limits rows to the people who should see them; the anon key still ships in the browser.",
    crumb: "Supabase RLS",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    id: "guide-keys",
    path: "/guides/leaked-api-keys-vibe-coding",
    title: "Did my app leak an API key?",
    description:
      "An API key is leaked when it sits in downloaded JavaScript, a public .env file, or a NEXT_PUBLIC_ or VITE_ variable. Here is what to do.",
    h1: "Did my vibe-coded app leak an API key?",
    lede: "An API key is leaked when it appears in JavaScript the browser downloads, in a public file such as .env, or in a variable prefixed with NEXT_PUBLIC_ or VITE_.",
    crumb: "Leaked API keys",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    id: "demo-report",
    path: "/demo-report",
    title: "Sample report",
    description:
      "A sample VibeCheck report with invented data, so you can see the score, coverage, and findings before you scan an app you own.",
    h1: "What does a VibeCheck report look like?",
    lede: "This page is sample data so the report UI can be reviewed without a live target. It is not the result of a scan in this environment. Real scans require ownership proof and consent.",
    crumb: "Sample report",
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    id: "terms",
    path: "/terms",
    title: "Terms",
    description: "Terms for using VibeCheck, including ownership proof, point-in-time reports, and the paid plans.",
    h1: "Terms of service",
    lede: "These terms describe the VibeCheck scan service, including ownership proof, point-in-time reports, and the paid plans.",
    crumb: "Terms",
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    id: "privacy",
    path: "/privacy",
    title: "Privacy",
    description: "What VibeCheck stores: account email, scan data, the session cookie, and payment checkout records.",
    h1: "Privacy",
    lede: "This page explains the account, scan, and payment data the current VibeCheck app stores.",
    crumb: "Privacy",
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    id: "refund",
    path: "/refund",
    title: "Refunds",
    description: `Refund terms for the ${TIERS.report.priceLabel} report, the ${TIERS.rescan.priceLabel} plan, and ${monitoringPriceWords()} monitoring.`,
    h1: "What is the VibeCheck refund policy?",
    lede: `Paid plans are the ${TIERS.report.priceLabel} report, the ${TIERS.rescan.priceLabel} report plus rescan, and ${monitoringPriceWords()} monitoring, plus applicable taxes.`,
    crumb: "Refunds",
    changeFrequency: "yearly",
    priority: 0.3,
  },
  {
    id: "scanner-info",
    path: "/scanner-info",
    title: "Scanner info",
    description:
      "How VibeCheck identifies its scans, why they require ownership proof and consent, and how to report abuse.",
    h1: "What is the VibeCheck scanner?",
    lede: "VibeCheck scans only an origin whose owner published a proof and consented. The checks are read-only, and each request names VibeCheck.",
    crumb: "Scanner info",
    changeFrequency: "monthly",
    priority: 0.4,
  },
  {
    id: "contact",
    path: "/contact",
    title: "Contact",
    description: "Contact VibeCheck about a scan, a receipt, or a refund.",
    h1: "How do I contact VibeCheck?",
    lede: "Email the address on this page about a scan, a receipt, or a refund.",
    crumb: "Contact",
    changeFrequency: "yearly",
    priority: 0.4,
  },
];

const PAGES_BY_ID = new Map(PUBLIC_PAGES.map((page) => [page.id, page]));

export function getPublicPage(id: PublicPageId): PublicPage {
  const page = PAGES_BY_ID.get(id);
  if (!page) throw new Error(`Unknown public page: ${id}`);
  return page;
}

export function breadcrumbsFor(id: PublicPageId): { name: string; path: string }[] {
  const page = getPublicPage(id);
  if (page.path === "/") return [{ name: "Home", path: "/" }];
  const items = [{ name: "Home", path: "/" }];
  if (page.path.startsWith("/guides/")) items.push({ name: "Guides", path: "/guides" });
  items.push({ name: page.crumb, path: page.path });
  return items;
}

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/demo-report", label: "Sample report" },
  { href: "/check", label: "Mini check" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/faq", label: "FAQ" },
      { href: "/guides", label: "Guides" },
      { href: "/guides/is-my-lovable-app-secure", label: "Lovable apps" },
      { href: "/guides/supabase-rls-checklist", label: "Supabase RLS" },
      { href: "/guides/leaked-api-keys-vibe-coding", label: "Leaked API keys" },
      { href: "/demo-report", label: "Sample report" },
      { href: "/check", label: "Mini check" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
      { href: "/refund", label: "Refunds" },
      { href: "/scanner-info", label: "Scanner info" },
      { href: "/contact", label: "Contact" },
      { href: "/llms.txt", label: "llms.txt" },
      { href: "/llms-full.txt", label: "llms-full.txt" },
    ],
  },
] as const;

export function allCopyBlocks(): CopyBlock[] {
  return [
    ...PRICING_SECTIONS,
    ...HOW_TO_STEPS,
    ...HOW_TO_EXTRAS,
    ...Object.values(GUIDES).flatMap((guide) => guide.sections),
    ...Object.values(LEGAL_SECTIONS).flat(),
    ...SCANNER_INFO_SECTIONS,
  ];
}

export const SCANNER_INFO_SECTIONS: CopyBlock[] = [
  {
    heading: "When does VibeCheck scan a site?",
    paragraphs: [
      "A scan starts only after that account publishes an ownership proof for the origin and checks the consent box. The proof is a token in DNS TXT or at /.well-known/vibecheck-verify.txt.",
      "The app stores who consented, when, the target origin, and the proof method. The operator can export that record when answering an abuse report.",
    ],
  },
  {
    heading: "What does a scan send?",
    paragraphs: [
      "Requests use GET, HEAD, OPTIONS, and small POST bodies. The worker does not send PUT, PATCH, or DELETE. Each request carries a User-Agent that names VibeCheck and links to this page.",
      "Checks wait for a free slot on that host instead of firing all at once. Waiting does not skip a check. The render of one page can still load that page's own images and scripts together.",
    ],
  },
  {
    heading: "How do I report abuse?",
    paragraphs: [
      "Email the abuse address shown on this page. Include the time in UTC, the URL that was requested, and the source IP address if you have it.",
      "The operator looks up that host and can reply with the account, the time, the target, and whether ownership was shown by DNS TXT or the well-known file.",
    ],
  },
];
