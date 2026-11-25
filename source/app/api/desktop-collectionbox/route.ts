import { randomUUID } from "node:crypto";
import { z } from "zod";
import { applyCollectionBoxAction, collectionBoxView, type CollectionBoxAction } from "@/lib/desktop-collectionbox";
import { desktopWidgetOrigin } from "@/lib/desktop-widget-credential";
import { redeemDesktopPairing, verifyDesktopAuthorization } from "@/lib/desktop-widget-store";
import { desktopWidgetDate } from "@/lib/desktop-widget-view";
import { createEmptyWorkspaceState, workspaceStateSchema } from "@/lib/workspace-state-schema";
import { getWorkspaceRecord, saveDesktopWidgetWorkspace } from "@/lib/workspace-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scope = "collectionbox";
const key = z.string().min(1).max(120);
const title = z.string().trim().min(1).max(500);
const payload = z.object({
  revision: z.number().int().nonnegative(),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("idea"), title }).strict(),
    z.object({ kind: z.literal("category"), title }).strict(),
    z.object({ kind: z.literal("save"), categoryId: key, websiteId: key.optional(), fromId: key.optional(),
      title, url: z.string().trim().min(1).max(2000), description: z.string().trim().max(500) }).strict(),
    z.object({ kind: z.literal("remove"), categoryId: key, websiteId: key }).strict(),
  ]),
}).strict();
const pairingInput = z.object({ code: z.string().max(80) }).strict();

function headers(origin: string | null) {
  return { "Cache-Control": "no-store", "Vary": "Origin", ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) };
}

function reply(origin: string | null, status: number, data: unknown) {
  return Response.json(data, { status, headers: headers(origin) });
}

async function requestWidget(request: Request, handler: (origin: string) => Promise<Response>) {
  const origin = desktopWidgetOrigin(request.headers.get("origin"));
  if (!origin) return reply(null, 403, { status: "origin" });
  try { return await handler(origin); }
  catch { return reply(origin, 503, { status: "unavailable" }); }
}

export function OPTIONS(request: Request) {
  const origin = desktopWidgetOrigin(request.headers.get("origin"));
  if (!origin) return reply(null, 403, { status: "origin" });
  return new Response(null, { status: 204, headers: {
    ...headers(origin), "Access-Control-Allow-Methods": "GET, POST, PATCH",
    "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600",
  } });
}

export function POST(request: Request) {
  return requestWidget(request, async (origin) => {
    const input = pairingInput.safeParse(await request.json().catch(() => null));
    if (!input.success) return reply(origin, 400, { status: "invalid_code" });
    const token = await redeemDesktopPairing(input.data.code.trim(), origin, scope);
    return token ? reply(origin, 200, { token }) : reply(origin, 401, { status: "invalid_code" });
  });
}

async function openWorkspace(request: Request, origin: string) {
  const authorization = await verifyDesktopAuthorization(request.headers.get("authorization"), origin, scope);
  if (!authorization) return { error: reply(origin, 401, { status: "pair_required" }) };
  const record = await getWorkspaceRecord(authorization.accountId);
  const validated = workspaceStateSchema.safeParse(record?.data ?? createEmptyWorkspaceState());
  if (!validated.success) return { error: reply(origin, 409, { status: "workspace_format" }) };
  // Preserve the stored document, since schema transforms can add defaults outside the toolbox.
  return { authorization, data: (record?.data ?? validated.data) as typeof validated.data, revision: record?.revision ?? 0 };
}

export function GET(request: Request) {
  return requestWidget(request, async (origin) => {
    const workspace = await openWorkspace(request, origin);
    if (workspace.error) return workspace.error;
    return reply(origin, 200, collectionBoxView(workspace.data, workspace.revision));
  });
}

export function PATCH(request: Request) {
  return requestWidget(request, async (origin) => {
    const workspace = await openWorkspace(request, origin);
    if (workspace.error) return workspace.error;
    const input = payload.safeParse(await request.json().catch(() => null));
    if (!input.success) return reply(origin, 400, { status: "invalid_input" });
    const { authorization, data, revision } = workspace;
    if (input.data.revision !== revision) return reply(origin, 409, { status: "conflict" });
    const parsed = input.data.action;
    let action: CollectionBoxAction;
    if (parsed.kind === "idea") {
      const date = desktopWidgetDate(new URL(request.url).searchParams.get("timezone") ?? "");
      if (!date) return reply(origin, 400, { status: "invalid_timezone" });
      action = { ...parsed, date };
    } else {
      action = parsed;
    }
    const next = applyCollectionBoxAction(data, action, randomUUID());
    if (next.status !== "applied") return reply(origin, next.status === "invalid_url" ? 400 : 409, { status: next.status });
    const result = await saveDesktopWidgetWorkspace(next.data, revision, authorization);
    if (result.status === "unauthorized") return reply(origin, 401, { status: "pair_required" });
    if (result.status === "conflict") return reply(origin, 409, { status: "conflict" });
    return reply(origin, 200, { ...collectionBoxView(next.data, result.revision), categoryId: next.categoryId });
  });
}
