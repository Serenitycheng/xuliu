import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { AccountId } from "./accounts";
import { createDesktopCredential, desktopPairingSeconds, parseDesktopCredential } from "./desktop-widget-credential";
import { getRedis } from "./redis";

function keys(accountId: AccountId) {
  const prefix = "xuliu:yiyan:desktop:";
  return { pending: prefix + "pending:" + accountId, active: prefix + "active:" + accountId };
}

function equal(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function issueYiyanDesktopPairing(accountId: AccountId, session: string, expiresAt: number) {
  const code = createDesktopCredential("xyp1", accountId);
  const pairing = parseDesktopCredential(code, "xyp1")!;
  const seconds = Math.min(desktopPairingSeconds, Math.floor((expiresAt - Date.now()) / 1000));
  if (seconds <= 0) return null;
  await getRedis().set(keys(accountId).pending, [pairing.hash, expiresAt, session].join("|"), { ex: seconds });
  return { code, expiresIn: seconds };
}

const redeem = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2], "PXAT", ARGV[3])
redis.call("DEL", KEYS[1])
return 1
`;

export async function redeemYiyanDesktopPairing(code: string, origin: string) {
  const pairing = parseDesktopCredential(code, "xyp1");
  if (!pairing) return null;
  const redis = getRedis(), target = keys(pairing.accountId);
  const pending = await redis.get<string>(target.pending);
  if (typeof pending !== "string") return null;
  const [hash, expiration, session] = pending.split("|");
  const expiresAt = Number(expiration);
  if (!session || !equal(hash, pairing.hash) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
  const token = createDesktopCredential("xyt1", pairing.accountId);
  const { hash: tokenHash } = parseDesktopCredential(token, "xyt1")!;
  const value = [tokenHash, origin, session].join("|");
  const result = await redis.eval(redeem, [target.pending, target.active], [pending, value, expiresAt]);
  return Number(result) === 1 ? token : null;
}

export async function hasYiyanDesktopAuthorization(accountId: AccountId) {
  return Boolean(await getRedis().exists(keys(accountId).active));
}

export async function revokeYiyanDesktopAuthorization(accountId: AccountId) {
  const target = keys(accountId);
  await getRedis().del(target.pending, target.active);
}

export async function verifyYiyanDesktopAuthorization(authorization: string | null, origin: string) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = parseDesktopCredential(authorization.slice(7), "xyt1");
  if (!token) return null;
  const key = keys(token.accountId).active;
  const stored = await getRedis().get<string>(key);
  if (typeof stored !== "string") return null;
  const [hash, savedOrigin, session] = stored.split("|");
  if (!session || savedOrigin !== origin || !equal(hash, token.hash)) return null;
  return { accountId: token.accountId, key, hash, origin, session, stored };
}

const replace = `
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
if ARGV[2] == "" then
  if string.sub(current, 1, string.len(ARGV[3])) ~= ARGV[3] then return 0 end
  return redis.call("DEL", KEYS[1])
end
if current ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "KEEPTTL")
return 1
`;

export async function updateYiyanDesktopSession(
  grant: NonNullable<Awaited<ReturnType<typeof verifyYiyanDesktopAuthorization>>>,
  session: string,
) {
  const prefix = grant.hash + "|" + grant.origin + "|";
  await getRedis().eval(replace, [grant.key], [grant.stored, session ? prefix + session : "", prefix]);
}
