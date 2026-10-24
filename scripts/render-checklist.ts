import { writeFileSync } from "node:fs";
import { renderChecklistMarkdown } from "../src/lib/catalog";

writeFileSync(new URL("../docs/SECURITY_CHECKLIST.md", import.meta.url), renderChecklistMarkdown());
console.log("wrote docs/SECURITY_CHECKLIST.md");
