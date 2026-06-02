import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic, type FilaTarifario } from "@/app/tarifario/TarifarioPublic";
import { liberarVencidas } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReservarPage() {
  const sb = await createClient();

  // Liberar reservas vencidas (perezoso) al entrar
  await liberarVencidas().catch(() => {});

  const filas: FilaTarifario[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await sb
      .from("tarifario_resultado")
      .select(
        "modulo, bloqueo_label, bloqueo_id, paquete_id, hotel_id, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp"
      )
      .eq("paquete_activo", true)
      .order("destino_nombre")
      .order("bloqueo_label")
      .order("hotel_nombre")
      .order("categoria")
      .order("regimen")
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    filas.push(...(page as unknown as FilaTarifario[]));
    if (page.length < PAGE) break;
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Reservar</h1>
      <p className="mb-6 text-sm text-gray-500">
        Tarifario comercial. Elige una salida y un hotel, y dale <b>Reservar</b> para generar el contrato.
      </p>
      {!filas.length ? (
        <p className="py-20 text-center text-gray-400">No hay tarifas publicadas. Genera el tarifario en un paquete.</p>
      ) : (
        <TarifarioPublic filas={filas} puedeReservar />
      )}
    </div>
  );
}
