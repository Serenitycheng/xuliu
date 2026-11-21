import { cookies } from "next/headers";
import { findAccountById } from "@/lib/accounts";
import { getSession } from "@/lib/session";
import { hasYiyanSameOrigin, openYiyanSession, yiyanCookieName, yiyanKey } from "@/lib/yiyan-session";
import { hasYiyanDesktopAuthorization, issueYiyanDesktopPairing, revokeYiyanDesktopAuthorization } from "@/lib/yiyan-desktop-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function account() {
  const session = await getSession();
  return session ? findAccountById(session.userId) : null;
}

async function websiteYiyan(accountId: string) {
  const token = (await cookies()).get(yiyanCookieName)?.value;
  if (!token) return null;
  const login = openYiyanSession(token, yiyanKey(process.env.XULIU_SESSION_SECRET ?? ""), accountId, "connected");
  return login?.identity ? { token, expiresAt: login.expiresAt } : null;
}

export async function GET() {
  try {
    const current = await account();
    if (!current) return json({ error: "请先登录序流。" }, 401);
    const [connected, login] = await Promise.all([
      hasYiyanDesktopAuthorization(current.id),
      websiteYiyan(current.id),
    ]);
    return json({ connected, canPair: Boolean(login) });
  } catch {
    return json({ error: "暂时无法读取一言桌面授权，请稍后重试。" }, 503);
  }
}

export async function POST(request: Request) {
  if (!hasYiyanSameOrigin(request)) return json({ error: "请在序流网页上授权。" }, 403);
  try {
    const current = await account();
    if (!current) return json({ error: "请先登录序流。" }, 401);
    const login = await websiteYiyan(current.id);
    const code = login && await issueYiyanDesktopPairing(current.id, login.token, login.expiresAt);
    return code ? json(code) : json({ error: "请先到序流侧栏登录一言，再生成配对码。" }, 409);
  } catch {
    return json({ error: "暂时无法生成一言配对码，请稍后重试。" }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!hasYiyanSameOrigin(request)) return json({ error: "请在序流网页上管理授权。" }, 403);
  try {
    const current = await account();
    if (!current) return json({ error: "请先登录序流。" }, 401);
    await revokeYiyanDesktopAuthorization(current.id);
    return json({ connected: false });
  } catch {
    return json({ error: "暂时无法撤销一言桌面授权，请稍后重试。" }, 503);
  }
}
