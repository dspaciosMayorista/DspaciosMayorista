import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PaquetesListado, type PaqueteItem } from "./PaquetesListado";
import { resolverTabInicial } from "./tipo-paquetes";
import { cargarFilasResumenPaginado } from "@/lib/tarifario/resumen";

export const dynamic = "force-dynamic";

const MSG_ERROR_ESTADO_PUBLICACION =
  "No fue posible cargar el estado de publicación de los paquetes. Intenta nuevamente en unos segundos.";

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

  // Conteo de tarifas publicadas y "desde" por paquete.
  //
  // ⚠️ Causa raíz del incidente "RECEPTIVOS ADZ" (paquete activo con tarifas
  // reales mostrando "Sin publicar" en este listado): la consulta anterior
  // traía TODO `tarifario_resultado` filtrado por `.in("paquete_id", ids)`
  // (con el catálogo real, ~16.000 filas) en un solo `.select()` sin
  // `.range()` — el límite "Max Rows" del proyecto (Settings → API) puede
  // truncar esa respuesta EN SILENCIO (sin `error`), y cualquier paquete cuyas
  // filas cayeran fuera de la porción truncada quedaba con `conteo === 0` →
  // "Sin publicar", aunque sí tuviera tarifas reales publicadas.
  //
  // Ahora se lee `tarifario_resumen` (migración 162: vista agregada que
  // colapsa la dimensión acomodación, ~3.091 filas reales vs ~16.089 de
  // `tarifario_resultado`) con `cargarFilasResumenPaginado()` — el MISMO
  // lector robusto que ya usa `/tarifario` (lib/tarifario/resumen.ts: orden
  // total y determinista, avanza por la cantidad REAL de filas recibidas,
  // termina únicamente con página vacía, revisa error de cada página, límite
  // defensivo de páginas). Se reusa tal cual, sin duplicar el bucle ni crear
  // una migración nueva — evita descargar el catálogo completo para un
  // listado administrativo que solo necesita un conteo y un "desde".
  //
  // `desde_general` de la vista es `MIN(precio_pvp)` por combo (hotel/
  // categoría/régimen/servicio) — el mínimo entre combos de un mismo paquete
  // sigue siendo exactamente el mismo "desde" que daba el cálculo anterior
  // sobre filas crudas (mínimo de mínimos = mínimo global): el precio
  // publicado NO cambia. Lo que sí cambia es la MAGNITUD del contador: antes
  // contaba cada fila de `tarifario_resultado` (una por acomodación —
  // sencilla/doble/triple/múltiple/niño/niño2/infante, hasta 7× por combo
  // real); ahora cuenta combos publicados — un número más legible y
  // consistente con lo que el propio `/tarifario` público considera
  // "publicado" (misma vista, mismo filtro `paquete_activo = true`).
  //
  // Un error TÉCNICO real de esta consulta nunca se disfraza de "Sin
  // publicar" para todo el listado: se corta la página con un aviso de error
  // explícito (ver más abajo) — la ausencia de filas y un fallo de red son
  // dos cosas distintas.
  const conteo = new Map<number, number>();
  const desdePorPaquete = new Map<number, number>();
  let errorEstadoPublicacion = false;
  if (filas.length) {
    const pagResumen = await cargarFilasResumenPaginado(sb);
    if (!pagResumen.ok) {
      errorEstadoPublicacion = true;
      console.error(
        `[dashboard/paquetes] etapa=tarifario_resumen paginas=${pagResumen.paginasConsultadas} detalle=${
          pagResumen.error instanceof Error ? pagResumen.error.message : JSON.stringify(pagResumen.error)
        }`
      );
    } else {
      for (const r of pagResumen.filas) {
        conteo.set(r.paquete_id, (conteo.get(r.paquete_id) ?? 0) + 1);
        if (r.desde_general != null) {
          const prev = desdePorPaquete.get(r.paquete_id);
          if (prev == null || r.desde_general < prev) desdePorPaquete.set(r.paquete_id, r.desde_general);
        }
      }
    }
  }

  if (errorEstadoPublicacion) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Paquetes</h1>
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {MSG_ERROR_ESTADO_PUBLICACION}
        </p>
      </div>
    );
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
