export const OWNERSHIP_GUIDE_PATH = "/docs/verify-ownership";
export const OWNERSHIP_GUIDE_LINK_LABEL = "How do I do this? Step-by-step guide";
export const OWNERSHIP_NOT_FOUND_HINT =
  "DNS can take time. Check that the file URL opens and shows only the token.";

export function isOwnershipNotFound(message: string): boolean {
  return message.includes("Ownership proof was not found");
}

export const LOVABLE_BOLT_PROMPT = [
  "Add a public text file at this exact path:",
  "",
  "public/.well-known/vibecheck-verify.txt",
  "",
  "Put this token in the file as the entire body. Do not add quotes, a title, Markdown, or HTML.",
  "",
  "PASTE_THE_TOKEN_HERE",
  "",
  "Publish the site. Opening this URL in a browser must show only that token:",
  "",
  "https://YOUR_APP/.well-known/vibecheck-verify.txt",
].join("\n");

export interface GuideLink {
  href: string;
  label: string;
}

export interface GuideChunk {
  id: string;
  title: string;
  paragraphs?: string[];
  steps?: string[];
  notes?: string[];
  code?: string;
  prompt?: boolean;
  links?: GuideLink[];
  panel?: boolean;
}

export interface GuideStep {
  id: string;
  title: string;
  paragraphs: string[];
  chunks?: GuideChunk[];
}

export const OWNERSHIP_GUIDE_STEPS: GuideStep[] = [
  {
    id: "what-this-is",
    title: "What this check is, and why it is here",
    paragraphs: [
      "Before VibeCheck can look at your app, it has to see a short code that only the owner can publish. That code is the token. It starts with vc_.",
      "Publishing the token shows the scan is allowed. Active checks wait until the token is visible and you tick the consent box on the scan page.",
      "The token is a public proof, not your password and not a secret from your app. Copy the token from the scan page. Keep that tab open while you follow these steps. You will copy the Host, the Value, the URL, and the Body from it.",
      "Leave the proof in place until the scan finishes. A later scan, including a scheduled rescan, looks for the same token. If you remove it, the next run stops and asks you to publish it again.",
    ],
  },
  {
    id: "choose-one",
    title: "Choose one option",
    paragraphs: [
      "One option is enough. Add the DNS note or add the text file.",
      "Choose the DNS TXT record when you can sign in where the domain is managed. That is often the company you bought the domain from. If the domain uses Cloudflare nameservers, it is Cloudflare. Nameservers are the company that answers address-book questions for the domain.",
      "Choose the text file when a builder gave you the app address, or when you cannot find DNS for that exact address. Lovable, Bolt, Vercel, and Netlify projects usually fit this option. You check it by opening a link in your browser.",
      "The address has to match. example.com, www.example.com, and a name ending in vercel.app are different sites. Put the proof on the address you typed into VibeCheck.",
    ],
  },
  {
    id: "dns",
    title: "Option A: add a DNS TXT record",
    paragraphs: [
      "DNS is the address book for a domain. A TXT record is a short text note stored in that address book. VibeCheck reads the note and looks for your token.",
      "On the scan page, the DNS card shows Host and Value. The Value is the token.",
    ],
    chunks: [
      {
        id: "add-txt",
        title: "Add the record",
        steps: [
          "Copy Host and Value with the buttons on the scan page.",
          "Sign in where this domain's DNS is managed.",
          "Open the DNS page. The label may be DNS, DNS records, Manage DNS, Advanced DNS, or DNS zone.",
          "Add a record and set the type to TXT.",
          "In the host or name box, enter the host from the next section. In the value, content, or data box, paste the token.",
          "If you see TTL, leave the default. TTL is how long old copies of the record can linger. Save the record.",
          "Wait, then return to VibeCheck and click verify again.",
        ],
      },
      {
        id: "host-at",
        title: "Host @ and the full domain",
        paragraphs: [
          "The Host on the scan page is the full name, such as example.com or www.example.com. DNS forms often want a shorter value, because they add the domain for you.",
          "Many forms use @ for the bare domain, sometimes called the apex. If the Host is example.com, type @.",
          "If the Host is www.example.com, type www when the form shows your domain beside the box. The saved name should read www.example.com.",
          "If the form does not add the domain for you, type the full Host from the scan page.",
          "Read the name the form previews before you save. example.com.example.com means the domain was entered twice. Change it so the saved name matches the Host.",
        ],
      },
      {
        id: "cloudflare",
        title: "Cloudflare",
        panel: true,
        steps: [
          "Log in to Cloudflare and open the domain.",
          "Go to DNS, then Records, then Add record.",
          "Set Type to TXT.",
          "Set Name to @ when the Host is the domain itself. Set Name to the first label, such as www, when the Host has a word in front of the domain.",
          "Paste the token into Content and save.",
        ],
        notes: [
          "Add the record in Cloudflare when Cloudflare is the nameserver, including when you bought the domain at another company.",
          "TXT records do not use the orange-cloud proxy switch. You can ignore that control for this record.",
        ],
      },
      {
        id: "godaddy",
        title: "GoDaddy",
        panel: true,
        steps: [
          "Sign in to GoDaddy, open the domain, and choose DNS or Manage DNS.",
          "Choose Add New Record.",
          "Set Type to TXT.",
          "Set Name to @ for the domain itself, or to the label in front, such as www.",
          "Paste the token into Value and save.",
        ],
        notes: [
          "GoDaddy's Name field uses @ for the bare domain. When the field already shows your domain, type @ or the label, and leave the full domain out.",
        ],
      },
      {
        id: "namecheap",
        title: "Namecheap",
        panel: true,
        steps: [
          "Sign in to Namecheap and open Domain List.",
          "Choose Manage next to the domain, then the Advanced DNS tab.",
          "Choose Add New Record.",
          "Set the type to TXT Record.",
          "Set Host to @ for the domain itself, or to the label in front.",
          "Paste the token into Value, leave TTL on Automatic, and save with the checkmark.",
        ],
        notes: [
          "Use this page when the nameservers say Namecheap BasicDNS or Namecheap PremiumDNS. When the nameservers point at another company, add the TXT record at that company instead.",
        ],
      },
      {
        id: "hostinger",
        title: "Hostinger",
        panel: true,
        steps: [
          "Sign in to Hostinger and open hPanel.",
          "Go to Domains, select the domain, and open DNS / DNS Zone.",
          "Add a record with type TXT.",
          "Set the name to @ for the domain itself, or to the label in front.",
          "Paste the token into the TXT value and save.",
        ],
      },
      {
        id: "squarespace",
        title: "Google Domains and Squarespace domains",
        panel: true,
        paragraphs: [
          "Google Domains moved to Squarespace. DNS for those domains is edited in the Squarespace account that holds the domain.",
          "When the website is on Squarespace and the domain was bought elsewhere, add the TXT record where the nameservers are managed. That can be the other company.",
        ],
        steps: [
          "Sign in to Squarespace and open the domain.",
          "Open DNS settings, then DNS records, and add a record.",
          "Set the type to TXT.",
          "Set the host to @ for the domain itself, or to the label in front.",
          "Paste the token into the data or value field and save.",
        ],
      },
      {
        id: "route-53",
        title: "Amazon Route 53",
        panel: true,
        steps: [
          "Sign in to AWS and open Route 53.",
          "Open Hosted zones and select the domain's public hosted zone.",
          "Choose Create record.",
          "Leave the record name empty when the Host is the domain itself. Enter the label, such as www, when the Host has a word in front.",
          "Set the record type to TXT, paste the token as the value, and create the record.",
        ],
        notes: [
          "Use a public hosted zone. A private hosted zone is visible inside AWS, so the public lookup cannot see it.",
          "When the form says the TXT value must be in quotation marks, put one pair of quotes around the token and nothing else.",
        ],
      },
      {
        id: "dns-lookup",
        title: "Wait for DNS, then use a public DNS lookup",
        paragraphs: [
          "Saving the record does not update the public internet instantly. DNS providers call this wait propagation. It can take a few minutes, and it can take a few hours.",
          "VibeCheck can see the token after a public DNS lookup shows it. Clicking verify again is safe. The scan stays stopped until the token matches.",
          "Open a public DNS lookup, enter the Host from the scan page, and ask for TXT records. Look for the token. It starts with vc_. If the token is missing, wait and look up again. When it appears, return to VibeCheck and verify.",
          "From a computer terminal, you can run the command below. Replace example.com with the Host from the scan page. You want a line that contains the token.",
        ],
        code: "nslookup -type=TXT example.com",
        links: [{ href: "https://dns.google/query", label: "Google Public DNS lookup" }],
      },
    ],
  },
  {
    id: "file",
    title: "Option B: add a well-known file",
    paragraphs: [
      "A well-known file is a small text file at a fixed address on your site. VibeCheck opens that address and expects the token to be the whole page.",
      "On the scan page, the file card shows URL and Body. The Body is the token. The URL ends in /.well-known/vibecheck-verify.txt.",
    ],
    chunks: [
      {
        id: "add-file",
        title: "Add the file",
        steps: [
          "Copy the URL and the Body from the scan page.",
          "Create a text file on the live site at the path in that URL.",
          "Put the token in the file as the entire body. Leave out a title, quotes, and any extra sentence.",
          "Publish or deploy the site.",
          "Open the URL in a browser. The page should show only the token.",
          "Return to VibeCheck and verify.",
        ],
      },
      {
        id: "next-vite",
        title: "Next.js, Vite, and a plain static site",
        panel: true,
        paragraphs: [
          "Next.js and Vite serve files from a folder named public at the root of the project. A file there is published at the site root.",
          "Create public/.well-known/vibecheck-verify.txt. The folder name .well-known starts with a period. If a file list hides it, show hidden files, or create the folder from the project file tree.",
          "Paste only the token into the file, save, and deploy the way you usually publish.",
          "A plain static site uses the same path in the folder you upload, beside index.html: .well-known/vibecheck-verify.txt. When that folder is named public, the path is public/.well-known/vibecheck-verify.txt.",
        ],
      },
      {
        id: "vercel",
        title: "Vercel",
        panel: true,
        steps: [
          "Add public/.well-known/vibecheck-verify.txt to the project.",
          "Deploy, and wait until that deployment says Ready.",
          "Open the URL on the same address you typed into VibeCheck.",
        ],
        notes: [
          "A vercel.app preview and your custom domain are different sites. The file has to be on the address you are scanning.",
          "If the URL shows your app, with its menu and layout, the host returned the app page instead of the file. Add the real file under public, then deploy again.",
        ],
      },
      {
        id: "netlify",
        title: "Netlify",
        panel: true,
        steps: [
          "Add public/.well-known/vibecheck-verify.txt when the project has a public folder.",
          "When Netlify publishes a dist or build folder, that published folder needs .well-known/vibecheck-verify.txt inside it.",
          "Deploy, wait until the deploy is published, and open the URL.",
        ],
        notes: [
          "Netlify serves a real file from the publish folder when another rule sends unknown paths to the homepage. If you see the homepage, the text file is not in the published folder.",
          "Folders that start with a period are easy to leave out of a drag-and-drop upload. Check that .well-known was included.",
        ],
      },
      {
        id: "lovable-bolt",
        title: "Lovable and Bolt",
        panel: true,
        paragraphs: [
          "In Lovable or Bolt, ask the AI to add the file, then publish. Copy the prompt below. Replace PASTE_THE_TOKEN_HERE with the Body from the scan page, and replace the sample URL with the URL from the scan page.",
          "After the chat says the site is published, open the URL yourself. The browser page is the check.",
        ],
        prompt: true,
      },
      {
        id: "check-url",
        title: "Confirm the file in your browser",
        steps: [
          "Copy the URL from the well-known file card.",
          "Paste it into a new browser tab and press Enter.",
          "A working file looks plain. You see the token, with no site header, no styling, and no not-found message.",
          "If the address bar changes host, publish the file on the address you are scanning, or scan the address that stays in the bar.",
          "When the tab shows only the token, go back and verify.",
        ],
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "If the proof was not found",
    paragraphs: [
      "Ownership proof was not found means VibeCheck looked for the token and did not see it yet. Match the case below to what you see, fix that case, and click verify again.",
    ],
    chunks: [
      {
        id: "dns-wait",
        title: "DNS can take time",
        paragraphs: [
          "A new TXT record can take a few minutes, and it can take a few hours, before a public DNS lookup shows the token.",
          "Run the lookup again. When the answer contains the token, click verify on the scan page.",
        ],
      },
      {
        id: "www-apex",
        title: "www and the bare domain",
        paragraphs: [
          "www.example.com and example.com are different hosts. The bare domain is sometimes called the apex. A TXT record or a file on one host leaves the other host unchecked.",
          "Match the Host and the file URL to the address you typed into VibeCheck.",
        ],
      },
      {
        id: "http-https",
        title: "http and https",
        paragraphs: [
          "Scan the address that opens the proof. That is usually the https address.",
          "VibeCheck reads the address you entered. A redirect to another address is ignored, including a jump from http to https or from the bare domain to www. Put the token on the address you entered, or enter the address that shows the token.",
        ],
      },
      {
        id: "html-404",
        title: "The file is a web page, HTML, or a 404",
        paragraphs: [
          "Open the file URL. The page should show only the token.",
          "A designed page, your normal app page, or a 404 means the file is not being served. Deploy again with public/.well-known/vibecheck-verify.txt, or with that same path in the folder your host publishes.",
          "A token sitting inside a web page does not count. The whole body at that address has to be the token.",
        ],
      },
      {
        id: "spaces-quotes",
        title: "Extra spaces or quotes",
        paragraphs: [
          "For the file, the body is the token alone. Quotes, a label, or a second sentence will not match. Spaces around the token are okay, and a blank line at the end is okay.",
          "For DNS, paste the token as the value. On Route 53, one pair of quotes around the token is okay when the form requires quotes.",
        ],
      },
      {
        id: "wrong-subdomain",
        title: "Wrong subdomain",
        paragraphs: [
          "app.example.com needs the record or the file on app.example.com. A proof on example.com leaves the subdomain unchecked. A proof on a preview URL leaves the production domain unchecked.",
          "Copy the Host and the URL from the scan page and match them.",
        ],
      },
    ],
  },
];

export function ownershipGuidePlainText(): string {
  const parts: string[] = [LOVABLE_BOLT_PROMPT, OWNERSHIP_NOT_FOUND_HINT, OWNERSHIP_GUIDE_LINK_LABEL];
  for (const step of OWNERSHIP_GUIDE_STEPS) {
    parts.push(step.title, ...step.paragraphs);
    for (const chunk of step.chunks ?? []) {
      parts.push(chunk.title, ...(chunk.paragraphs ?? []), ...(chunk.steps ?? []), ...(chunk.notes ?? []));
      if (chunk.code) parts.push(chunk.code);
      for (const link of chunk.links ?? []) parts.push(link.label, link.href);
    }
  }
  return parts.join("\n");
}
