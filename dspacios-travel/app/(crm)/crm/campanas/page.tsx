import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { CampanaClient, type Campana } from "./CampanaClient";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function CampanasPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Campañas</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Solo administración / gerencia.</p>
      </div>
    );
  }

  const [{ data: elegibles }, { data: cumples }, { data: campanas }] = await Promise.all([
    sb.from("crm_contactos").select("categoria").eq("acepta_publicidad", true).eq("no_contactar", false).not("email", "is", null),
    sb.from("crm_contactos").select("fecha_nacimiento").eq("no_contactar", false).not("email", "is", null).not("fecha_nacimiento", "is", null),
    sb.from("crm_campanas").select("id, asunto, categoria, tipo, total, enviados, fallidos, created_at").order("created_at", { ascending: false }).limit(30),
  ]);

  const porCat: Record<string, number> = {};
  let total = 0;
  for (const c of elegibles ?? []) { porCat[c.categoria] = (porCat[c.categoria] ?? 0) + 1; total++; }

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const [, mm, dd] = hoy.split("-");
  let cumpleHoy = 0, cumpleMes = 0;
  for (const c of cumples ?? []) {
    const p = (c.fecha_nacimiento ?? "").split("-");
    if (p[1] === mm) { cumpleMes++; if (p[2] === dd) cumpleHoy++; }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/crm" className="text-sm text-gray-500 hover:text-gray-800">← Contactos</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold text-gray-900">Campañas y felicitaciones</h1>
      <p className="mb-6 text-sm text-gray-500">Solo se envía a contactos con email, que <b>aceptan publicidad</b> y no marcados &quot;no contactar&quot;.</p>
      <CampanaClient porCat={porCat} total={total} cumpleHoy={cumpleHoy} cumpleMes={cumpleMes} campanas={(campanas ?? []) as Campana[]} />
    </div>
  );
}
