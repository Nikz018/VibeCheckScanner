import { findSecretKinds } from "../extract";
import { runModule, type ScanContext } from "../context";

export const SECRET_CHECK_IDS = ["secret_in_client", "client_backend_config"] as const;

export async function runSecrets(ctx: ScanContext): Promise<void> {
  await runModule([...SECRET_CHECK_IDS], ctx, async () => {
    const source = ctx.scriptText();
    const kinds = findSecretKinds(source);
    ctx.mark("secret_in_client");
    if (kinds.length > 0) {
      ctx.add("secret_in_client", `Public JavaScript included ${kinds.join(", ")}. The value was redacted.`);
    }

    ctx.mark("client_backend_config");
    const notes: string[] = [];
    if (ctx.config.supabaseUrl) notes.push("a Supabase project URL");
    if (ctx.config.supabaseAnonKey) notes.push("a public anon client key");
    if (ctx.config.firebaseDatabaseUrl || ctx.config.firebaseProjectId) notes.push("a Firebase client config");
    if (notes.length > 0) {
      ctx.add("client_backend_config", `The public bundle embeds ${notes.join(" and ")}. A client key is expected only when server-side rules reject unauthorized access.`);
    }
  });
}
