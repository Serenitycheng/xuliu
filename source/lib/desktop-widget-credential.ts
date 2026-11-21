import { createHash, randomBytes } from "node:crypto";
import { findAccountById, type AccountId } from "./accounts.ts";

type CredentialKind = "xdp1" | "xdt1" | "xyp1" | "xyt1";

export const desktopPairingSeconds = 5 * 60;

export function desktopWidgetOrigin(origin: string | null) {
  return origin && /^http:\/\/w-[a-z0-9-]{1,80}\.localhost:57140$/.test(origin) ? origin : null;
}

export function createDesktopCredential(kind: CredentialKind, accountId: AccountId) {
  return `${kind}.${accountId}.${randomBytes(24).toString("base64url")}`;
}

export function parseDesktopCredential(value: string, kind: CredentialKind) {
  const fields = /^(xdp1|xdt1|xyp1|xyt1)\.([a-z][a-z0-9]{0,31})\.([A-Za-z0-9_-]{32})$/.exec(value);
  const account = fields?.[1] === kind ? findAccountById(fields[2]) : null;
  if (!account) return null;
  return { accountId: account.id, hash: createHash("sha256").update(value).digest("hex") };
}
