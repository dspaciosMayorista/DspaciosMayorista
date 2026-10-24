import { createClient } from "@/lib/supabase/server";
import type { ComponentProps } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArmadoClient } from "./ArmadoClient";
import { resolverDestinosAereosPaquete } from "@/lib/paquetes/destinosAereos67";
import type { PublicacionMontaje } from "@/lib/paquetes/unidadesMontaje";
import { cargarFuentesMoneda90 } from "@/lib/reservar/fuentesMoneda90";
import { evaluarPublicacion90, mensajeEvaluacion90, textoEstadoTrm90 } from "@/lib/reservar/monedaPublicacion90";

export const dynamic = "force-dynamic";

export default async function PaqueteDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  // #101 — pestaña activa (`?tab=`): sobrevive a un F5 y a un enlace compartido. ArmadoClient valida el valor contra
  // las pestañas que el tipo de paquete realmente muestra.
  const tabParam = (await searchParams)?.tab;
  const pestanaInicial = Array.isArray(tabParam) ? tabParam[0] : tabParam;
  const paqueteId = Number(id);
  const sb = await createClient();

  const { data: pq } = await sb
    .from("armado_paquetes")
    .select("*, destinos(nombre, pais)")
    .eq("id", paqueteId)
    .single();
  if (!pq) notFound();

  const destinoId = pq.destino_id;
  // ¿El destino del paquete es internacional? (país distinto de Colombia → migr. 050).
  const paisDestino = (pq.destinos as { pais?: string | null } | null)?.pais ?? null;
  const destinoEsInternacional = !!paisDestino && !/^(colombia|co)$/i.test(paisDestino.trim());
  const viajeIni = pq.fecha_viaje_inicio;
  const viajeFin = pq.fecha_viaje_fin;

  // #67 — destinos de llegada permitidos para los vuelos de este paquete:
  // check apagado = solo el destino comercial (el filtro de siempre); encendido =
  // comercial + alternativas elegidas del MISMO país. Sin destino comercial no
  // se ofrece ningún vuelo (nunca "todos" como respaldo). Un error de lectura
  // se muestra como error, no como "no hay vuelos". Hoteles, servicios y el
  // destino público siguen filtrando por el destino comercial.
  const efAereo = await resolverDestinosAereosPaquete(sb, paqueteId);
  const destinosAereosError = efAereo.ok ? null : efAereo.error;
  const idsAereos = efAereo.ok && efAereo.efectivos.ok ? efAereo.efectivos.ids : [];
  const { data: altRows, error: errAlt } = await sb
    .from("armado_paquete_destinos_aereos")
    .select("destino_id")
    .eq("paquete_id", paqueteId);
  const destinosAereosErrorTotal = destinosAereosError ?? (errAlt ? "No se pudieron leer los destinos aéreos alternativos del paquete." : null);

  // Disponibles (filtrados por destino + rango de viaje)
  let qVuelos = sb
    .from("bloqueos_vuelo")
    .select("id, record, ruta, aerolinea, fecha_ida, fecha_regreso, tarifa_para_empaquetar, tarifa_neta, destino_id, moneda")
    .order("fecha_ida");
  // Un vuelo SIEMPRE pertenece a un destino: filtro estricto (los que no tienen
  // destino asignado no se mezclan en paquetes de otro destino).
  qVuelos = qVuelos.in("destino_id", idsAereos);
  if (viajeIni) qVuelos = qVuelos.gte("fecha_ida", viajeIni);
  if (viajeFin) qVuelos = qVuelos.lte("fecha_ida", viajeFin);

  // Vuelos por SISTEMA (Empaquetados, migración 156) — mismo filtro de
  // destino/rango de viaje que los bloqueos negociados; solo los activos
  // (uno apagado no debe ofrecerse para armar un paquete nuevo).
  let qEmpaquetados = sb
    .from("empaquetados")
    .select("id, record, ruta, aerolinea, fecha_ida, fecha_regreso, tarifa_para_empaquetar, destino_id, moneda")
    .eq("activo", true)
    .order("fecha_ida");
  qEmpaquetados = qEmpaquetados.in("destino_id", idsAereos);
  if (viajeIni) qEmpaquetados = qEmpaquetados.gte("fecha_ida", viajeIni);
  if (viajeFin) qEmpaquetados = qEmpaquetados.lte("fecha_ida", viajeFin);

  let qHoteles = sb.from("hoteles").select("id, nombre, zona, destino_id, moneda").eq("activo", true).order("nombre");
  if (destinoId) qHoteles = qHoteles.eq("destino_id", destinoId);

  let qServicios = sb
    .from("servicios_adicionales")
    .select("id, nombre, precio_persona, destino_id, moneda, servicio_tarifa_pax(pax_desde)")
    .eq("activo", true)
    .order("nombre");
  // Servicio aplica si: es del destino puntual, O es catch-all del MISMO alcance
  // que el destino del paquete (nacional vs internacional). Así las asistencias
  // marcadas "todos internacionales" solo salen en paquetes internacionales.
  if (destinoId) {
    const alc = destinoEsInternacional ? "internacional" : "nacional";
    qServicios = qServicios.or(`destino_id.eq.${destinoId},and(destino_id.is.null,alcance.eq.${alc})`);
  }

  const [
    { data: destinos },
    { data: vuelosDisp },
    { data: empaquetadosDisp },
    { data: hotelesDisp },
    { data: serviciosDisp },
    { data: selVuelos },
    { data: selEmpaquetados },
    { data: selHoteles },
    { data: selServicios },
  ] = await Promise.all([
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
    qVuelos,
    qEmpaquetados,
    qHoteles,
    qServicios,
    sb.from("armado_vuelos").select("bloqueo_id, aplica_mk, ta").eq("paquete_id", paqueteId),
    sb.from("armado_empaquetados").select("empaquetado_id, aplica_mk, ta").eq("paquete_id", paqueteId),
    sb.from("armado_hoteles").select("hotel_id, categorias, regimenes, prioridad").eq("paquete_id", paqueteId),
    sb.from("armado_servicios").select("servicio_id, modo, incluido").eq("paquete_id", paqueteId),
  ]);

  // Salidas dinámicas (solo aplican al tipo 'dinamico').
  const { data: salidas } = pq.tipo === "dinamico"
    ? await sb.from("salidas_dinamicas").select("*").eq("paquete_id", paqueteId).order("fecha_ida")
    : { data: null };
  // #90 D: la moneda de publicación la ELIGE quien monta el paquete (armado_paquetes.moneda_publicacion); ya no se deriva de los hoteles
  // disponibles. #63: el modo COP con TRM publica en COP aunque haya hoteles/servicios en USD. Para un paquete aún sin elegir, esta
  // prop solo da formato a los importes mostrados (la última moneda publicada): el panel de abajo exige elegirla antes de generar.
  const modo63 = (pq as { modo_oferta?: string | null }).modo_oferta === "cop_trm_63";
  const monedaElegida = (pq as { moneda_publicacion?: string | null }).moneda_publicacion;
  const monedaPaquete = modo63 ? "COP" : monedaElegida === "USD" || monedaElegida === "COP" ? monedaElegida : pq.moneda === "USD" ? "USD" : "COP";

  // #90 A/D — moneda de publicación que muestra el panel «Unidades del montaje»: se evalúan los VÍNCULOS GUARDADOS del paquete (no las
  // listas «disponibles» del editor) con LA MISMA lectura y LA MISMA evaluación que usan generarTarifario y la cotización de la oferta
  // (lib/reservar/fuentesMoneda90 + aporteFuentes90 + monedaPublicacion90): solo cuentan las fuentes que REALMENTE aportan al precio (las que el
  // generador descarta no exigen TRM ni bloquean). Paridad panel = generador = cotización. La moneda es la ELEGIDA, no la de los hoteles.
  const tipoPaquete = (pq.tipo ?? "bloqueo") as string; // mismo valor por defecto que generarTarifario
  const { publicacionMontaje, textoTrmMontaje } = await evaluarPublicacionMontaje();

  async function evaluarPublicacionMontaje(): Promise<{ publicacionMontaje: PublicacionMontaje; textoTrmMontaje: string | undefined }> {
    const fuentes = await cargarFuentesMoneda90(sb, paqueteId, { tipo: tipoPaquete, modo63 });
    if (!fuentes.ok) {
      return { publicacionMontaje: { estado: "rechazado", motivo: "No se pudieron leer los vínculos guardados del paquete para evaluar su moneda." }, textoTrmMontaje: undefined };
    }
    const ev = evaluarPublicacion90({
      modo: modo63 ? "cop_trm_63" : "legacy",
      monedaPublicacion: monedaElegida,
      trm: (pq as { trm_oferta?: number | null }).trm_oferta,
      fuentes: fuentes.fuentes,
    });
    const publicacionMontaje: PublicacionMontaje = ev.ok && ev.monedaPublicacion
      ? { estado: "publicable", moneda: ev.monedaPublicacion }
      : { estado: "rechazado", motivo: mensajeEvaluacion90(ev) };
    return { publicacionMontaje, textoTrmMontaje: modo63 ? textoEstadoTrm90(ev) : undefined };
  }

  // El resultado puede superar el tope de 1000 filas de PostgREST; paginamos.
  //
  // ⚠️ Excepción deliberada (Fase 2 de snapshots atómicos, migración 182):
  // esta pantalla es el EDITOR/diagnóstico del paquete en administración —
  // a diferencia de los lectores públicos/de cotización/reserva, necesita ver
  // el snapshot REAL tal como quedó (incluido uno bloqueado por
  // `armado_paquetes.tarifario_snapshot_publicable = false`) para poder
  // diagnosticar por qué está bloqueado. Sigue leyendo `tarifario_resultado`
  // directo, nunca `tarifario_resultado_publicable`.
  const resultado: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await sb
      .from("tarifario_resultado")
      .select("*")
      .eq("paquete_id", paqueteId)
      .order("bloqueo_id")
      .order("hotel_nombre")
      .order("categoria")
      .order("regimen")
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    resultado.push(...page);
    if (page.length < PAGE) break;
  }

  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;
  // Fuera del JSX: un objeto literal con una flecha adentro como prop no se puede serializar a un Client Component.
  // Sin FK a destinos: un id huérfano (destino borrado/fusionado) no se le muestra al editor; al volver a guardar se limpia.
  const destinosExistentes = new Set<number>();
  for (const d of destinos ?? []) destinosExistentes.add(d.id);
  const idsAlternativasGuardadas: number[] = [];
  for (const fila of altRows ?? []) {
    if (destinosExistentes.has(fila.destino_id)) idsAlternativasGuardadas.push(fila.destino_id);
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/paquetes" className="text-sm text-gray-400 hover:text-gray-600">← Paquetes</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{pq.nombre}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {destinoNombre ?? "Sin destino"} · mk {Math.round((pq.pct_mk ?? 0) * 100)}% ·{" "}
            {pq.activo ? "Activo" : "Inactivo"}
          </p>
        </div>
      </div>

      <ArmadoClient
        paqueteId={paqueteId}
        destinos={destinos ?? []}
        config={{
          nombre: pq.nombre,
          tipo: pq.tipo,
          noches: pq.noches,
          activo: pq.activo,
          destinoId: pq.destino_id,
          fechaCompraInicio: pq.fecha_compra_inicio ?? "",
          fechaCompraFin: pq.fecha_compra_fin ?? "",
          fechaViajeInicio: pq.fecha_viaje_inicio ?? "",
          fechaViajeFin: pq.fecha_viaje_fin ?? "",
          pctMk: Math.round((pq.pct_mk ?? 0) * 100),
          impuestoTipo: pq.impuesto_tipo,
          impuestoFijo: pq.impuesto_fijo,
          notas: pq.notas ?? "",
          condicionPagoTipo: pq.condicion_pago_tipo ?? "normal",
          condicionPagoPctInicial: pq.condicion_pago_pct_inicial ?? null,
          condicionPagoDiasSaldo: pq.condicion_pago_dias_saldo ?? null,
          restriccionComercial: pq.restriccion_comercial ?? "normal",
          programaIncluye: pq.programa_incluye ?? "",
          programaNoIncluye: pq.programa_no_incluye ?? "",
          programaTarifasEspeciales: pq.programa_tarifas_especiales ?? "",
          programaCondicionesComerciales: pq.programa_condiciones_comerciales ?? "",
          destinosAereosAlternativos: pq.destinos_aereos_alternativos === true,
          destinosAereosIds: idsAlternativasGuardadas,
          modoOferta: (pq as { modo_oferta?: string | null }).modo_oferta ?? "legacy",
          trmOferta: (pq as { trm_oferta?: number | null }).trm_oferta ?? null,
          monedaPublicacion: monedaElegida ?? null,
        }}
        destinosAereosError={destinosAereosErrorTotal}
        tieneDestino={!!destinoId}
        vuelosDisp={vuelosDisp ?? []}
        // 230: `moneda` de empaquetados no está en types/database.ts a propósito (ver su nota); se lee con el select sin tipo.
        empaquetadosDisp={(empaquetadosDisp ?? []) as unknown as ComponentProps<typeof ArmadoClient>["empaquetadosDisp"]}
        hotelesDisp={hotelesDisp ?? []}
        serviciosDisp={(serviciosDisp ?? []) as unknown as Parameters<typeof ArmadoClient>[0]["serviciosDisp"]}
        selVuelos={selVuelos ?? []}
        selEmpaquetados={selEmpaquetados ?? []}
        selHoteles={selHoteles ?? []}
        selServicios={selServicios ?? []}
        resultado={resultado as unknown as Parameters<typeof ArmadoClient>[0]["resultado"]}
        salidas={(salidas ?? []) as unknown as Parameters<typeof ArmadoClient>[0]["salidas"]}
        moneda={monedaPaquete}
        publicacionMontaje={publicacionMontaje}
        textoTrmMontaje={textoTrmMontaje}
        pestanaInicial={pestanaInicial ?? null}
        tarifarioEstado={(pq as { tarifario_estado?: string | null }).tarifario_estado ?? null}
        tarifarioError={(pq as { tarifario_error?: string | null }).tarifario_error ?? null}
        tarifarioPublicable={(pq as { tarifario_snapshot_publicable?: boolean | null }).tarifario_snapshot_publicable ?? null}
      />
    </div>
  );
}
