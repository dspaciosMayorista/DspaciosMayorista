import { createClient } from "@/lib/supabase/server";
import { piezaResponse } from "../_pieza";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flyer cuadrado 1080×1080 (post de Instagram).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  return piezaResponse(sb, req, Number(id), "flyer");
}
