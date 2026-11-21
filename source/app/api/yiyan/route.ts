import { readYiyan, updateYiyan } from "@/lib/yiyan-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return readYiyan(request);
}

export function POST(request: Request) {
  return updateYiyan(request);
}
