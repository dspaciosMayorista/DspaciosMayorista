import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { rotacionDe, type EnvioMin, type Rotacion } from "@/lib/crm/difusion";
import { DifusionClient, type MaterialConRot, type EnvioRow, type PlanRow, type HotelOpt } from "./DifusionClient";

export const dynamic = "force-dynamic";
const ROLES = ["superadmin", "gerencia", "administracion", "operaciones", "venta"];

export default async function DifusionPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return <div className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-semibold text-gray-900">Difusión</h1><p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo interno.</p></div>;
  }

  const [{ data: materiales }, { data: envios }, { data: plan }, { data: hoteles }, { data: destinosCat }] = await Promise.all([
    sb.from("crm_material").select("*").eq("activo", true).order("created_at", { ascending: false }),
    sb.from("crm_envio").select("*").order("fecha_envio", { ascending: false }).limit(3000),
    sb.from("crm_difusion_plan").select("*").order("fecha_programada", { ascending: true }),
    sb.from("hoteles").select("id, nombre, destinos(nombre)").order("nombre"),
    sb.from("destinos").select("nombre").order("nombre"),
  ]);

  // Fecha "hoy" en zona Colombia (el server corre en UTC).
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

  const enviosMin: EnvioMin[] = (envios ?? []).map((e) => ({ material_id: e.material_id, hotel_producto: e.hotel_producto, fecha_envio: e.fecha_envio }));
  const matRot: MaterialConRot[] = (materiales ?? []).map((m) => ({
    ...m,
    rotacion: rotacionDe({ id: m.id, hotel_producto: m.hotel_producto }, enviosMin, hoy) as Rotacion,
  }));

  const hotelOpts: HotelOpt[] = (hoteles ?? []).map((h) => ({
    id: h.id, nombre: h.nombre,
    destino: (h.destinos as unknown as { nombre: string } | null)?.nombre ?? null,
  }));
  const destinos = (destinosCat ?? []).map((d) => d.nombre);

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <Link href="/crm" className="text-sm text-gray-400 hover:text-gray-600">← CRM</Link>
      <div className="mb-5 mt-2">
        <h1 className="text-2xl font-bold text-gray-900">Difusión — cronograma de material</h1>
        <p className="mt-1 text-sm text-gray-500">
          Controla qué material promocional enviar, qué pausar y qué priorizar. La rotación se calcula
          sola desde el histórico (no repetir hotel &lt; 21 días, mismo material &lt; 30 días).
        </p>
      </div>
      <DifusionClient
        hoy={hoy}
        materiales={matRot}
        envios={(envios ?? []) as EnvioRow[]}
        plan={(plan ?? []) as PlanRow[]}
        hoteles={hotelOpts}
        destinos={destinos}
      />
    </div>
  );
}
