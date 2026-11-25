import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { AccountId } from "./accounts";
import { createDesktopCredential, desktopPairingSeconds, parseDesktopCredential } from "./desktop-widget-credential";
import { getRedis } from "./redis";

const widgetScopes = {
  tasks: { key: "desktop-widget", pairing: "xdp1", token: "xdt1" },
  collectionbox: { key: "desktop-collectionbox", pairing: "xcp1", token: "xct1" },
} as const;

export type DesktopWidgetScope = keyof typeof widgetScopes;

function keys(accountId: AccountId, scope: DesktopWidgetScope) {
  const prefix = `xuliu-ai-v1:${widgetScopes[scope].key}`;
  return {
    pending: `${prefix}:pending:${accountId}`,
    active: `${prefix}:active:${accountId}`,
  };
}

export async function createDesktopPairing(accountId: AccountId, scope: DesktopWidgetScope = "tasks") {
  const { pairing } = widgetScopes[scope];
  const code = createDesktopCredential(pairing, accountId);
  const { hash } = parseDesktopCredential(code, pairing)!;
  await getRedis().set(keys(accountId, scope).pending, hash, { ex: desktopPairingSeconds });
  return code;
}

const redeemPairing = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2])
redis.call("DEL", KEYS[1])
return 1
`;

export async function redeemDesktopPairing(code: string, origin: string, scope: DesktopWidgetScope = "tasks") {
  const credential = widgetScopes[scope];
  const pairing = parseDesktopCredential(code, credential.pairing);
  if (!pairing) return null;
  const { accountId, hash } = pairing;
  const token = createDesktopCredential(credential.token, accountId);
  const target = keys(accountId, scope);
  const result = await getRedis().eval(redeemPairing, [target.pending, target.active],
    [hash, `${parseDesktopCredential(token, credential.token)!.hash}|${origin}`]);
  return Number(result) === 1 ? token : null;
}

export async function hasDesktopAuthorization(accountId: AccountId, scope: DesktopWidgetScope = "tasks") {
  return Boolean(await getRedis().exists(keys(accountId, scope).active));
}

export async function revokeDesktopAuthorization(accountId: AccountId, scope: DesktopWidgetScope = "tasks") {
  const target = keys(accountId, scope);
  await getRedis().del(target.pending, target.active);
}

export async function verifyDesktopAuthorization(authorization: string | null, origin: string, scope: DesktopWidgetScope = "tasks") {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = parseDesktopCredential(authorization.slice(7), widgetScopes[scope].token);
  if (!token) return null;
  const key = keys(token.accountId, scope).active;
  const value = `${token.hash}|${origin}`;
  const stored = await getRedis().get<string>(key);
  if (typeof stored !== "string" || Buffer.byteLength(value) !== Buffer.byteLength(stored)
    || !timingSafeEqual(Buffer.from(value), Buffer.from(stored))) return null;
  return { accountId: token.accountId, key, value };
}
