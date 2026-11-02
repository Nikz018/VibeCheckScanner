export const CODE_PRIVACY_PROMISE =
  "We clone one repository you choose into a temporary folder, scan it, and delete that copy before the job finishes. The report keeps only short excerpts with secrets masked. Your code is not stored and is not used for training.";

export const OWASP_ALIGNMENT =
  "These checks are aligned with the OWASP Top 10 (2021). A passed row means the checks did not find an issue. This is not a certification.";

export const CODE_SCAN_LIMITATIONS = [
  "JavaScript and TypeScript are covered in this version, including Next.js, React, Vite, Node, Supabase, and Firebase projects. Python rules are not included yet.",
  "Secrets, committed env files, Supabase SQL and row level security, and Firebase rules are checked in any file the scan reads.",
  "The repository copy is deleted when the scan finishes. Only short redacted excerpts are kept.",
  "These checks do not prove that every bug is gone.",
] as const;
