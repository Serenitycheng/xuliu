import { z } from "zod";
import { desktopWidgetOrigin } from "@/lib/desktop-widget-credential";
import { fetchYiyanOriginalImage } from "@/lib/yiyan-image-service";
import { limitYiyan, readYiyan, updateYiyan } from "@/lib/yiyan-route";
import { YiyanError } from "@/lib/yiyan-service";
import { openYiyanSession, yiyanCookieName, yiyanKey } from "@/lib/yiyan-session";
import { redeemYiyanDesktopPairing, updateYiyanDesktopSession, verifyYiyanDesktopAuthorization } from "@/lib/yiyan-desktop-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pairing = z.object({ code: z.string().max(80) }).strict();

function headers(origin: string | null) {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
  };
}

function reply(origin: string | null, status: number, data: unknown) {
  return Response.json(data, { status, headers: headers(origin) });
}

export function OPTIONS(request: Request) {
  const origin = desktopWidgetOrigin(request.headers.get("origin"));
  if (!origin) return reply(null, 403, { error: "请求来源无效。" });
  return new Response(null, { status: 204, headers: {
    ...headers(origin),
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
  } });
}

function pairRequired(origin: string) {
  return reply(origin, 401, { pairRequired: true, error: "一言桌面授权已到期，请在序流网页重新配对。" });
}

async function handle(request: Request) {
  const origin = desktopWidgetOrigin(request.headers.get("origin"));
  if (!origin) return reply(null, 403, { error: "请求来源无效。" });
  const url = new URL(request.url);
  try {
    if (request.method === "POST" && url.searchParams.get("pair") === "1") {
      const input = pairing.safeParse(await request.json().catch(() => null));
      const token = input.success ? await redeemYiyanDesktopPairing(input.data.code, origin) : null;
      return token ? reply(origin, 200, { token }) : reply(origin, 401, { error: "配对码无效或已过期，请重新生成。" });
    }
    const grant = await verifyYiyanDesktopAuthorization(request.headers.get("authorization"), origin);
    if (!grant) return pairRequired(origin);
    const key = yiyanKey(process.env.XULIU_SESSION_SECRET ?? "");
    if (!openYiyanSession(grant.session, key, grant.accountId, "connected")) return pairRequired(origin);

    if (request.method === "GET" && url.searchParams.has("image")) {
      await limitYiyan(grant.accountId + ":desktop:image", 120, 3600, false);
      const response = await fetchYiyanOriginalImage(url.searchParams.get("image") ?? "");
      return new Response(response.body, { headers: { ...headers(origin), "Content-Type": response.headers.get("Content-Type")! } });
    }
    const context = { owner: grant.accountId, key, session: grant.session };
    const response = request.method === "POST" ? await updateYiyan(request, context) : await readYiyan(request, context);
    if (response.status === 401) {
      await updateYiyanDesktopSession(grant, "");
      return pairRequired(origin);
    }
    const changed = response.cookies.get(yiyanCookieName);
    if (changed) await updateYiyanDesktopSession(grant, changed.value);
    return new Response(response.body, {
      status: response.status,
      headers: { ...headers(origin), "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    if (error instanceof YiyanError) return reply(origin, error.status, { error: error.message });
    return reply(origin, 503, { error: "暂时无法连接一言，请稍后重试。" });
  }
}

export const GET = handle;
export const POST = handle;
