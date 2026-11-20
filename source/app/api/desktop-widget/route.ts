import { randomUUID } from "node:crypto";
import { z } from "zod";
import { desktopWidgetOrigin } from "@/lib/desktop-widget-credential";
import { redeemDesktopPairing, verifyDesktopAuthorization } from "@/lib/desktop-widget-store";
import { completeDesktopWidgetTask, desktopWidgetDate, desktopWidgetView } from "@/lib/desktop-widget-view";
import { workspaceStateSchema } from "@/lib/workspace-state-schema";
import { getWorkspaceRecord, saveDesktopWidgetWorkspace } from "@/lib/workspace-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.string().min(1).max(120);
const completionInput = z.object({
  target: z.union([
    z.object({ kind: z.enum(["task", "milestone", "review"]), id }).strict(),
    z.object({ kind: z.literal("review-step"), id, stepId: id }).strict(),
  ]),
  done: z.boolean(),
  date: z.string().length(10),
  revision: z.number().int().nonnegative(),
}).strict();
const pairingInput = z.object({ code: z.string().max(80) }).strict();

function headers(origin: string | null) {
  return {
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
  };
}

function reply(origin: string | null, status: number, data: unknown) {
  return Response.json(data, { status, headers: headers(origin) });
}

async function widgetRequest(request: Request, handler: (origin: string) => Promise<Response>) {
  const origin = desktopWidgetOrigin(request.headers.get("origin"));
  if (!origin) return reply(null, 403, { status: "origin" });
  try { return await handler(origin); }
  catch { return reply(origin, 503, { status: "unavailable" }); }
}

export function OPTIONS(request: Request) {
  const origin = desktopWidgetOrigin(request.headers.get("origin"));
  if (!origin) return reply(null, 403, { status: "origin" });
  return new Response(null, { status: 204, headers: {
    ...headers(origin),
    "Access-Control-Allow-Methods": "GET, POST, PATCH",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
  } });
}

export function POST(request: Request) {
  return widgetRequest(request, async (origin) => {
    const input = pairingInput.safeParse(await request.json().catch(() => null));
    if (!input.success) return reply(origin, 400, { status: "invalid_code" });
    const token = await redeemDesktopPairing(input.data.code, origin);
    return token ? reply(origin, 200, { token }) : reply(origin, 401, { status: "invalid_code" });
  });
}

async function requestWorkspace(request: Request, origin: string) {
  const authorization = await verifyDesktopAuthorization(request.headers.get("authorization"), origin);
  if (!authorization) return { error: reply(origin, 401, { status: "pair_required" }) };
  const date = desktopWidgetDate(new URL(request.url).searchParams.get("timezone") ?? "");
  if (!date) return { error: reply(origin, 400, { status: "invalid_timezone" }) };
  const record = await getWorkspaceRecord(authorization.accountId);
  if (!record?.data) return { authorization, date, data: null, revision: record?.revision ?? 0 };
  const parsed = workspaceStateSchema.safeParse(record.data);
  if (!parsed.success) return { error: reply(origin, 409, { status: "workspace_format" }) };
  return { authorization, date, data: parsed.data, revision: record.revision };
}

export function GET(request: Request) {
  return widgetRequest(request, async (origin) => {
    const workspace = await requestWorkspace(request, origin);
    if (workspace.error) return workspace.error;
    return reply(origin, 200, desktopWidgetView(workspace.data, workspace.date, workspace.revision));
  });
}

export function PATCH(request: Request) {
  return widgetRequest(request, async (origin) => {
    const input = completionInput.safeParse(await request.json().catch(() => null));
    if (!input.success) return reply(origin, 400, { status: "invalid_task" });
    const workspace = await requestWorkspace(request, origin);
    if (workspace.error) return workspace.error;
    const { authorization, data, date, revision } = workspace;
    if (!data || input.data.revision !== revision || input.data.date !== date) return reply(origin, 409, { status: "conflict" });
    const next = completeDesktopWidgetTask(data, input.data.target, input.data.done, date, randomUUID());
    if (!next) return reply(origin, 409, { status: "conflict" });
    if (next === data) return reply(origin, 200, desktopWidgetView(data, date, revision));
    const result = await saveDesktopWidgetWorkspace(next, revision, authorization);
    if (result.status === "unauthorized") return reply(origin, 401, { status: "pair_required" });
    if (result.status === "conflict") return reply(origin, 409, { status: "conflict" });
    return reply(origin, 200, desktopWidgetView(next, date, result.revision));
  });
}
