import { findAccountById } from "@/lib/accounts";
import { desktopPairingSeconds } from "@/lib/desktop-widget-credential";
import { createDesktopPairing, hasDesktopAuthorization, revokeDesktopAuthorization } from "@/lib/desktop-widget-store";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function account() {
  const session = await getSession();
  return session ? findAccountById(session.userId) : null;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  return origin === url.origin || origin === `${url.protocol}//${request.headers.get("host")}`;
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const current = await account();
  if (!current) return json({ error: "请先登录序流。" }, 401);
  return json({ connected: await hasDesktopAuthorization(current.id) });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "请在序流网页上授权。" }, 403);
  const current = await account();
  if (!current) return json({ error: "请先登录序流。" }, 401);
  return json({ code: await createDesktopPairing(current.id), expiresIn: desktopPairingSeconds });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "请在序流网页上管理授权。" }, 403);
  const current = await account();
  if (!current) return json({ error: "请先登录序流。" }, 401);
  await revokeDesktopAuthorization(current.id);
  return json({ connected: false });
}
