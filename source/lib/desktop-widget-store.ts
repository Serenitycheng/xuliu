import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { AccountId } from "./accounts";
import { createDesktopCredential, desktopPairingSeconds, parseDesktopCredential } from "./desktop-widget-credential";
import { getRedis } from "./redis";

function keys(accountId: AccountId) {
  return {
    pending: `xuliu-ai-v1:desktop-widget:pending:${accountId}`,
    active: `xuliu-ai-v1:desktop-widget:active:${accountId}`,
  };
}

export async function createDesktopPairing(accountId: AccountId) {
  const code = createDesktopCredential("xdp1", accountId);
  const { hash } = parseDesktopCredential(code, "xdp1")!;
  await getRedis().set(keys(accountId).pending, hash, { ex: desktopPairingSeconds });
  return code;
}

const redeemPairing = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2])
redis.call("DEL", KEYS[1])
return 1
`;

export async function redeemDesktopPairing(code: string, origin: string) {
  const pairing = parseDesktopCredential(code, "xdp1");
  if (!pairing) return null;
  const { accountId, hash } = pairing;
  const token = createDesktopCredential("xdt1", accountId);
  const target = keys(accountId);
  const result = await getRedis().eval(redeemPairing, [target.pending, target.active],
    [hash, `${parseDesktopCredential(token, "xdt1")!.hash}|${origin}`]);
  return Number(result) === 1 ? token : null;
}

export async function hasDesktopAuthorization(accountId: AccountId) {
  return Boolean(await getRedis().exists(keys(accountId).active));
}

export async function revokeDesktopAuthorization(accountId: AccountId) {
  const target = keys(accountId);
  await getRedis().del(target.pending, target.active);
}

export async function verifyDesktopAuthorization(authorization: string | null, origin: string) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = parseDesktopCredential(authorization.slice(7), "xdt1");
  if (!token) return null;
  const key = keys(token.accountId).active;
  const value = `${token.hash}|${origin}`;
  const stored = await getRedis().get<string>(key);
  if (typeof stored !== "string" || Buffer.byteLength(value) !== Buffer.byteLength(stored)
    || !timingSafeEqual(Buffer.from(value), Buffer.from(stored))) return null;
  return { accountId: token.accountId, key, value };
}
