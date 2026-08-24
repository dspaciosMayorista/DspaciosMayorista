import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PaquetesListado, type PaqueteItem } from "./PaquetesListado";
import { resolverTabInicial } from "./tipo-paquetes";

export const dynamic = "force-dynamic";

export default async function PaquetesPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string | string[] }>;
}) {
  const { tipo: tipoParam } = await searchParams;
  const tabInicial = resolverTabInicial(tipoParam);

  const sb = await createClient();
  const { data: paquetesRaw } = await sb
    .from("armado_paquetes")
    .select("id, nombre, activo, pct_mk, tipo, fecha_viaje_inicio, fecha_viaje_fin, destinos(nombre)")
    .order("id", { ascending: false });

  type Row = {
    id: number;
    nombre: string;
    activo: boolean;
    pct_mk: number;
    tipo: PaqueteItem["tipo"];
    fecha_viaje_inicio: string | null;
    fecha_viaje_fin: string | null;
    destinos: { nombre: string } | null;
  };
  const filas = (paquetesRaw ?? []) as unknown as Row[];

  // Conteo de tarifas resultantes y "desde" por paquete
  const ids = filas.map((p) => p.id);
  const conteo = new Map<number, number>();
  const desdePorPaquete = new Map<number, number>();
  if (ids.length) {
    const { data: res } = await sb
      .from("tarifario_resultado")
      .select("paquete_id, precio_pvp")
      .in("paquete_id", ids);
    for (const r of res ?? []) {
      conteo.set(r.paquete_id, (conteo.get(r.paquete_id) ?? 0) + 1);
      const prev = desdePorPaquete.get(r.paquete_id);
      if (prev == null || r.precio_pvp < prev) desdePorPaquete.set(r.paquete_id, r.precio_pvp);
    }
  }

  // Todo el cómputo por-item vive aquí (server, una sola vez); el listado
  // cliente solo filtra/ordena localmente (ver tipo-paquetes.ts) — no repite
  // consultas a Supabase al cambiar de pestaña.
  const paquetes: PaqueteItem[] = filas.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    activo: p.activo,
    pctMk: p.pct_mk,
    tipo: p.tipo,
    destino: p.destinos?.nombre ?? null,
    fechaViajeInicio: p.fecha_viaje_inicio,
    fechaViajeFin: p.fecha_viaje_fin,
    nTarifas: conteo.get(p.id) ?? 0,
    desde: desdePorPaquete.get(p.id) ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Paquetes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Armas el paquete sobre el Producto (costos) y le pones el margen. El resultado se publica en el Tarifario.
          </p>
        </div>
        <Link href="/dashboard/paquetes/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo paquete</Button>
        </Link>
      </div>

      <PaquetesListado paquetes={paquetes} tabInicial={tabInicial} />
    </div>
  );
}
