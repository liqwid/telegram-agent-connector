import {
  chmodSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

/**
 * Local pointer to this user's backend account. Holds the account id and
 * bearer token — never the Telegram api_hash or session, which stay on the
 * backend.
 */
const credentialsSchema = z.object({
  backendUrl: z.string(),
  accountId: z.string(),
  accountToken: z.string(),
});

export type Credentials = z.infer<typeof credentialsSchema>;

const credentialsFile = (): string =>
  process.env.TAC_CREDENTIALS_FILE ??
  join(homedir(), ".telegram-agent-connector.json");

export function loadCredentials(): Credentials | null {
  const file = credentialsFile();
  if (!existsSync(file)) return null;
  const parsed = credentialsSchema.safeParse(
    JSON.parse(readFileSync(file, "utf8")),
  );
  return parsed.success ? parsed.data : null;
}

export function saveCredentials(credentials: Credentials): void {
  const file = credentialsFile();
  writeFileSync(file, JSON.stringify(credentials, null, 2));
  chmodSync(file, 0o600);
}

export function deleteCredentials(): void {
  const file = credentialsFile();
  if (existsSync(file)) unlinkSync(file);
}
