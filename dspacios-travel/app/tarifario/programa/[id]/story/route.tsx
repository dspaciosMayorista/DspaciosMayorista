import { createClient } from "@/lib/supabase/server";
import { piezaResponse } from "../_pieza";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Historia de Instagram 1080×1920.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  return piezaResponse(sb, req, Number(id), "story");
}
