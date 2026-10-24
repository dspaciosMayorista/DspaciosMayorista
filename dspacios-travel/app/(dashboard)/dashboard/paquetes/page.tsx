import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PaquetesListado, type PaqueteItem } from "./PaquetesListado";
import { resolverTabInicial } from "./tipo-paquetes";
import { cargarFilasResumenPaginado } from "@/lib/tarifario/resumen";
import { desdeListadoPorPaquete } from "@/lib/tarifario/desdeDoble";
import { Info } from "lucide-react";
import { paquetesConTarifarioAnteriorAInfante } from "./actions";

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
  // El "desde" NO es el mínimo de la vista (`MIN(precio_pvp)` incluía infante/niño): es la tarifa DOBLE publicable
  // (`precio_doble`) por paquete y por moneda — ver lib/tarifario/desdeDoble.ts (TASKS #92/#114). El contador cuenta
  // combos publicados (filas de la vista), no una fila por acomodación.
  //
  // Un error TÉCNICO real de esta consulta nunca se disfraza de "Sin
  // publicar" para todo el listado: se corta la página con un aviso de error
  // explícito (ver más abajo) — la ausencia de filas y un fallo de red son
  // dos cosas distintas.
  const conteo = new Map<number, number>();
  let desdePorPaquete = new Map<number, { moneda: string; valor: number }[]>();
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
      for (const r of pagResumen.filas) conteo.set(r.paquete_id, (conteo.get(r.paquete_id) ?? 0) + 1);
      // «Desde» = tarifa DOBLE publicable por moneda (#92/#114); sin DOBLE el paquete no entra al mapa y el listado dice «Consultar».
      desdePorPaquete = desdeListadoPorPaquete(pagResumen.filas);
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

  // Tarifa de infante (migración 226): paquetes activos cuyo tarifario se publicó ANTES y hay que regenerar a mano.
  // Es un aviso: si la consulta falla no se muestra nada (la reserva con infantes ya pide regenerar por su cuenta).
  const pendientesInfante = await paquetesConTarifarioAnteriorAInfante();

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
    desde: desdePorPaquete.get(p.id) ?? [],
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

      {pendientesInfante.ok && pendientesInfante.paquetes.length > 0 && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p>
              <b>{pendientesInfante.paquetes.length} {pendientesInfante.paquetes.length === 1 ? "paquete tiene" : "paquetes tienen"} el tarifario anterior a la tarifa de infante</b>{" "}
              (menores de 2 años). Ábrelos y pulsa <b>Generar tarifario</b>; hasta entonces no se puede reservar con infantes en ellos.
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {pendientesInfante.paquetes.map((p) => (
                <li key={p.id}><Link href={`/dashboard/paquetes/${p.id}`} className="underline">{p.nombre}</Link></li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <PaquetesListado paquetes={paquetes} tabInicial={tabInicial} />
    </div>
  );
}
