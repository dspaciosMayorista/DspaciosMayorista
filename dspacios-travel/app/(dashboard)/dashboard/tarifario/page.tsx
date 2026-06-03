import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { TarifarioPublic, type FilaTarifario } from "@/app/tarifario/TarifarioPublic";

export const dynamic = "force-dynamic";

export default async function TarifarioInternoPage() {
  const sb = await createClient();

  // Tarifario generado (resultado de los paquetes). Paginado por si supera 1000.
  const filas: FilaTarifario[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await sb
      .from("tarifario_resultado")
      .select(
        "modulo, bloqueo_label, bloqueo_id, paquete_id, hotel_id, servicio_nombre, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp"
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tarifario</h1>
          <p className="mt-1 text-sm text-gray-500">
            Resultado publicado de los paquetes (vista interna). Para generar contratos usa <b>Reservar</b>.
          </p>
        </div>
        <Link href="/dashboard/producto/destinos" className="text-sm text-[var(--brand-accent)] hover:underline">
          Gestionar destinos →
        </Link>
      </div>

      {!filas.length ? (
        <p className="py-20 text-center text-gray-400">
          Aún no hay tarifas publicadas. Arma un paquete y dale <b>Generar tarifario</b>.
        </p>
      ) : (
        <TarifarioPublic filas={filas} />
      )}
    </div>
  );
}
