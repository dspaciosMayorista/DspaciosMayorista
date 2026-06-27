import { createClient } from "@/lib/supabase/server";
import { piezaResponse } from "../_pieza";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Portada horizontal 1200×630 (cover / OG / sistema).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  return piezaResponse(sb, req, Number(id), "portada");
}
