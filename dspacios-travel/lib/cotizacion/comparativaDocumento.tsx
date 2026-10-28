// ─────────────────────────────────────────────────────────────────────────
// #35 — Documento y ficha de una cotización COMPARATIVA (componentes de servidor).
//
// Una comparativa muestra los importes POR OPCIÓN (cada hotel con su total; si
// hay varias acomodaciones, el total de cada una). NUNCA hay un total global ni
// un «$0» ficticio: las opciones son alternativas, no se suman. Lo que se
// persiste en `resumen_publico` ya viene sin netos, proveedores ni recobro.
// ─────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, ExternalLink, GitCompareArrows, History, Printer } from "lucide-react";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatFechaLarga } from "@/lib/utils";
import { formatoExacto } from "@/lib/contrato/repartoTarifa";
import { menoresDeOpcion, menoresNoDesglosables, otrosServiciosDeOpcion, tarifaVisibleOpcion, tiquetesDeOpcion, agruparPorHotel, canalDeRol, desdeComparativa, limiteSolicitudVencida, resumenDeOpcion, totalPublicoOpcion, type GrupoHotel, type OpcionVista } from "@/lib/cotizacion/comparativa";
import { abiertaConSalidaPasada, hoyBogota } from "@/lib/cotizacion/vigencia";
import { tarifaPaqueteOpcion } from "@/lib/cotizacion/tarifaPaquete";
import { incluyeParaMostrar } from "@/lib/cotizacion/incluye";
import { visitantePuedeContinuar } from "@/lib/cotizacion/comparativaServidor";
import { PrintButton } from "@/components/contrato/PrintButton";
import { ComparativaHoja, type IdentidadHoja } from "@/components/cotizacion/ComparativaHoja";
import { cargarAgenciaDeCotizacion } from "@/lib/cotizacion/agenciaCotizacion";
import { DescartarBtn } from "@/app/(dashboard)/dashboard/cotizaciones/[id]/DescartarBtn";
import { PanelSolicitudes, SelectorOpciones, type ModoSeleccion, type ResumenHotelUI, type SolicitudUI } from "./comparativaAcciones";

type SB = SupabaseClient<Database>;
export type MadreComparativa = Database["public"]["Tables"]["cotizaciones"]["Row"];

type FilaOpcion = { opcion_ref: string; acomodacion_ref: string; orden: number; etiqueta: string; moneda: string; tarifa_persona: number | null; total: number; resumen_publico: unknown; plantilla_hija: unknown };

export type DatosComparativa = {
  grupos: GrupoHotel[];
  resumenes: Record<string, ResumenHotelUI>;
  elegida: { id: number; codigo: string; estado: string; opcionRef: string; acomodacionRef: string; numeroContrato: string | null } | null;
};


/** Opciones y opción elegida de una madre, leídas con el cliente que reciba (sesión o servicio). */
export async function cargarDatosComparativa(sb: SB, madreId: number): Promise<DatosComparativa> {
  const [{ data: ops }, { data: hijas }] = await Promise.all([
    sb.from("cotizacion_opciones").select("opcion_ref, acomodacion_ref, orden, etiqueta, moneda, tarifa_persona, total, resumen_publico, plantilla_hija").eq("cotizacion_id", madreId).order("orden"),
    sb.from("cotizaciones").select("id, codigo, estado, opcion_ref, acomodacion_ref, numero_contrato").eq("cotizacion_origen_id", madreId).neq("estado", "descartada").limit(1),
  ]);
  const filas = (ops ?? []) as unknown as FilaOpcion[];
  const vistas: OpcionVista[] = filas.map((o) => ({
    opcionRef: o.opcion_ref, acomodacionRef: o.acomodacion_ref, etiqueta: o.etiqueta, moneda: o.moneda,
    tarifaPersona: o.tarifa_persona == null ? null : Number(o.tarifa_persona), total: totalPublicoOpcion(Number(o.total), o.resumen_publico), orden: o.orden,
  }));
  const resumenes: Record<string, ResumenHotelUI> = {};
  for (const o of filas) {
    const r = resumenDeOpcion(o.resumen_publico);
    // Los «otros servicios» salen del snapshot congelado de la opción (verificado contra su total); nunca se muestran costos ni proveedores.
    const otros = otrosServiciosDeOpcion(o.plantilla_hija, o.total);
    if (otros.ok) { if (otros.otros.length) r.otros = otros.otros; } else r.otrosNoVerificables = true;
    const menores = menoresDeOpcion(o.resumen_publico, o.plantilla_hija, o.etiqueta);
    if (menores.length) r.menores = menores;
    if (menoresNoDesglosables(o.resumen_publico, o.plantilla_hija, o.etiqueta)) r.menoresNoDesglosables = true;
    // #75: vuelos por tiquete (del snapshot congelado) y tarifa por persona solo si cuadra con lo liquidado. Nada de esto expone precio, costo ni proveedor.
    const tiquetes = tiquetesDeOpcion(o.plantilla_hija, r.vuelos, o.moneda);
    if (tiquetes.length) r.tiquetes = tiquetes;
    r.tarifa = tarifaVisibleOpcion(o.resumen_publico, o.plantilla_hija, Number(o.total));
    // Tarifa del paquete por pasajero (vuelos y servicios repartidos); si aplica, reemplaza a la del alojamiento. En NETO sale del plan B2B congelado.
    r.paquete = tarifaPaqueteOpcion(o.resumen_publico, o.plantilla_hija, Number(o.total));
    // Incluye: el texto guardado que es exactamente la propuesta antigua del snapshot (sin edición del asesor) se muestra con el orden vigente; uno editado no se toca.
    r.incluye = incluyeParaMostrar(r.incluye, (o.plantilla_hija as { payload?: unknown } | null)?.payload);
    resumenes[`${o.opcion_ref}/${o.acomodacion_ref}`] = r;
    resumenes[o.opcion_ref] ??= r;
  }
  const h = hijas?.[0];
  return {
    grupos: agruparPorHotel(vistas), resumenes,
    elegida: h ? { id: h.id, codigo: h.codigo, estado: h.estado, opcionRef: h.opcion_ref ?? "", acomodacionRef: h.acomodacion_ref ?? "", numeroContrato: h.numero_contrato } : null,
  };
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800">{value || "—"}</div>
    </div>
  );
}

function ResumenViaje({ m }: { m: Pick<MadreComparativa, "cliente" | "destino" | "fecha_salida" | "fecha_regreso" | "pax" | "moneda" | "vigencia_hasta"> }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Dato label="Cliente" value={m.cliente ?? ""} />
      <Dato label="Destino" value={m.destino ?? ""} />
      <Dato label="Fechas" value={m.fecha_salida ? `${formatFechaLarga(m.fecha_salida)} → ${m.fecha_regreso ? formatFechaLarga(m.fecha_regreso) : "—"}` : ""} />
      <Dato label="Pasajeros" value={m.pax ? String(m.pax) : ""} />
      <Dato label="Moneda" value={m.moneda ?? ""} />
      <Dato label="Vigente hasta" value={m.vigencia_hasta ? formatFechaLarga(m.vigencia_hasta) : ""} />
    </div>
  );
}

/** Documento de una comparativa (enlace público e impresión). */
export function ComparativaDocumento({
  madre, datos, modo, token, vencida, motivoDeshabilitada, identidad = null,
}: {
  madre: MadreComparativa; datos: DatosComparativa; modo: ModoSeleccion; token: string | null; vencida: boolean; motivoDeshabilitada?: string; identidad?: IdentidadHoja;
}) {
  const hoja = <ComparativaHoja madre={madre} grupos={datos.grupos} resumenes={datos.resumenes} vencida={vencida} identidad={identidad} />;
  // Página imprimible (sin enlace ni acciones): solo la hoja. En el enlace público la pantalla conserva sus controles y al imprimir se cambia por la hoja.
  if (modo === "solo_lectura" && !token) return hoja;
  const desde = desdeComparativa(datos.grupos.flatMap((g) => g.acomodaciones));
  const deshabilitada = modo === "solo_lectura" || vencida || !!datos.elegida || madre.estado !== "abierta";
  const motivo = motivoDeshabilitada ?? (vencida ? "Esta comparativa venció." : madre.estado !== "abierta" ? "Esta comparativa ya no está disponible." : undefined);
  return (
    <>
    <div className="mx-auto max-w-5xl rounded-xl bg-white p-5 shadow-sm md:p-8 print:hidden">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><GitCompareArrows size={13} aria-hidden /> Cotización comparativa</p>
          <h1 className="text-2xl font-semibold text-gray-900">{madre.codigo}</h1>
          <p className="text-sm text-gray-500">Compara los hoteles y escoge <b>uno</b>. Cada total corresponde a ese hotel por separado: no se suman.</p>
        </div>
        {desde && <p className="text-right text-xs text-gray-400">Desde<br /><span className="text-lg font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatoExacto(desde.total, desde.moneda)}</span></p>}
      </header>
      <ResumenViaje m={madre} />
      <div className="mt-6">
        <SelectorOpciones version={madre.version} token={token} grupos={datos.grupos} resumenes={datos.resumenes}
          modo={modo} deshabilitada={deshabilitada} motivoDeshabilitada={motivo}
          elegida={datos.elegida ? { codigo: datos.elegida.codigo, opcionRef: datos.elegida.opcionRef, acomodacionRef: datos.elegida.acomodacionRef } : null} />
      </div>
      <footer className="mt-6 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
        Los valores están sujetos a disponibilidad y se revalidan al continuar con una opción. Elegir una opción no genera cobros ni un contrato por sí solo.
      </footer>
    </div>
    <div className="hidden print:block">{hoja}</div>
    </>
  );
}

/**
 * Identidad impresa en la hoja: la de la agencia dueña de la cotización, con LA MISMA regla que la cotización normal (`/cotizacion/[id]`, `/cot/[token]`): error técnico, tenant inválido,
 * fila ausente o Minorista sin RNT → falla de forma explícita; no se emite una hoja con marca pero sin emisor acreditado.
 */
async function identidadDe(sb: unknown, tenant: string | null): Promise<IdentidadHoja> {
  const r = await cargarAgenciaDeCotizacion(sb, tenant);
  if (!r.ok) throw new Error(r.mensaje);
  return r.agencia;
}

const ESTILO_IMPRESION = ".contrato-doc, .contrato-doc * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } @page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } .contrato-doc { box-shadow: none !important; max-width: none !important; } }";

const ETIQUETA_EVENTO: Record<string, string> = {
  creada: "Comparativa creada", elegida: "Opción elegida", hija_descartada: "Cotización elegida descartada",
  solicitud_registrada: "Solicitud registrada", solicitud_actualizada: "Solicitud actualizada", solicitud_atendida: "Solicitud atendida",
  solicitud_rechazada: "Solicitud rechazada", solicitud_superada: "Solicitud superada por otra elección",
};

/** Ficha INTERNA (dashboard) de una comparativa: opciones, elección, solicitudes e historial. */
export async function FichaComparativa({ madre, puedeResolver, hoy }: { madre: MadreComparativa; puedeResolver: boolean; hoy: string }) {
  const sb = await createClient();
  const datos = await cargarDatosComparativa(sb, madre.id);
  const [{ data: sols }, { data: evs }] = await Promise.all([
    sb.from("cotizacion_comparativa_solicitudes").select("id, estado, opcion_ref, acomodacion_ref, contacto_nombre, contacto_telefono, contacto_email, nota, created_at").eq("cotizacion_id", madre.id).order("id", { ascending: false }).limit(100),
    sb.from("cotizacion_comparativa_eventos").select("id, tipo, opcion_ref, acomodacion_ref, actor_tipo, created_at").eq("cotizacion_id", madre.id).order("id", { ascending: false }).limit(100),
  ]);
  const etiquetaDe = (ref: string) => datos.grupos.find((g) => g.opcionRef === ref)?.etiqueta ?? `Hotel ${ref}`;
  const hace72h = limiteSolicitudVencida();
  const solicitudes: SolicitudUI[] = (sols ?? []).map((s) => ({
    id: s.id, estado: s.estado, opcionRef: s.opcion_ref, acomodacionRef: s.acomodacion_ref, etiqueta: etiquetaDe(s.opcion_ref), nombre: s.contacto_nombre,
    telefono: s.contacto_telefono, email: s.contacto_email, nota: s.nota, creada: formatFechaLarga(s.created_at.slice(0, 10)),
    vencida: new Date(s.created_at).getTime() < hace72h || (!!madre.vigencia_hasta && madre.vigencia_hasta < hoy) || abiertaConSalidaPasada(madre, hoy),
  }));
  const vencida = (!!madre.vigencia_hasta && madre.vigencia_hasta < hoy) || abiertaConSalidaPasada(madre, hoy);
  const abierta = madre.estado === "abierta";
  const modo: ModoSeleccion = abierta && !vencida && !datos.elegida ? "interno" : "solo_lectura";
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <Link href="/dashboard/cotizaciones" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"><ArrowLeft size={14} aria-hidden /> Volver a cotizaciones</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><GitCompareArrows size={13} aria-hidden /> Comparativa · {madre.estado}</p>
          <h1 className="text-2xl font-semibold text-gray-900">{madre.codigo}</h1>
          <p className="max-w-2xl text-sm text-gray-500">
            Esta cotización compara hoteles; <b>no se cobra ni se convierte en contrato</b>. Al elegir una opción se crea una cotización simple con lo común y esa opción: esa sí sigue el flujo normal (pagos previos, conversión).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Link href={`/cotizacion/${madre.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"><Printer size={14} aria-hidden /> Documento<span className="sr-only"> (se abre en otra pestaña; muestra la comparativa a PVP)</span></Link>
          <Link href={`/cot/${madre.share_token}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"><ExternalLink size={14} aria-hidden /> Enlace del cliente</Link>
          {abierta && !datos.elegida && <DescartarBtn id={madre.id} />}
        </div>
      </header>

      <ResumenViaje m={madre} />

      {datos.elegida && (
        <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Opción elegida: <b>{etiquetaDe(datos.elegida.opcionRef)}</b>. Continúa en la cotización{" "}
          <Link href={`/dashboard/cotizaciones/${datos.elegida.id}`} className="font-semibold underline">{datos.elegida.codigo}</Link>
          {datos.elegida.numeroContrato ? ` (contrato ${datos.elegida.numeroContrato})` : ""}. Para elegir otra, descarta esa cotización (solo si no tiene pagos ni contrato).
        </section>
      )}

      <SelectorOpciones version={madre.version} token={madre.share_token} grupos={datos.grupos} resumenes={datos.resumenes} modo={modo}
        deshabilitada={modo === "solo_lectura"} motivoDeshabilitada={vencida ? "Esta comparativa venció." : undefined}
        elegida={datos.elegida ? { codigo: datos.elegida.codigo, opcionRef: datos.elegida.opcionRef, acomodacionRef: datos.elegida.acomodacionRef } : null} />

      <PanelSolicitudes solicitudes={solicitudes} puedeResolver={puedeResolver && abierta} hayElegida={!!datos.elegida} />

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700"><History size={14} aria-hidden /> Historial</h2>
        <ol className="space-y-1.5 text-sm text-gray-600">
          {(evs ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.opcion_ref ? ` · opción ${e.opcion_ref}` : ""}{e.actor_tipo ? ` · ${e.actor_tipo}` : ""}</span>
              <span className="text-xs text-gray-400">{formatFechaLarga(e.created_at.slice(0, 10))}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Página imprimible /cotizacion/[id] de una comparativa. */
export async function PaginaImprimibleComparativa({ madre, hoy }: { madre: MadreComparativa; hoy: string }) {
  const sb = await createClient();
  const datos = await cargarDatosComparativa(sb, madre.id);
  if (!datos.grupos.length) notFound();
  const vencida = (!!madre.vigencia_hasta && madre.vigencia_hasta < hoy) || abiertaConSalidaPasada(madre, hoy);
  const identidad = await identidadDe(sb, madre.tenant);
  return (
    <div className="min-h-screen bg-gray-100 py-6 print:min-h-0 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href={`/dashboard/cotizaciones/${madre.id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} aria-hidden /> Volver a la comparativa</Link>
        <PrintButton />
      </div>
      <div className="px-4 print:px-0">
        <ComparativaDocumento madre={madre} datos={datos} modo="solo_lectura" token={null} vencida={vencida} identidad={identidad} />
      </div>
      <style dangerouslySetInnerHTML={{ __html: ESTILO_IMPRESION }} />
    </div>
  );
}

/**
 * Enlace público de una comparativa (`/cot/<token>`). SOLO LECTURA: se resuelve únicamente por
 * `share_token` y devuelve null si el token no es de una comparativa (la página sigue su camino de
 * siempre). El token nunca autoriza escribir: para continuar con una opción el visitante pasa por el
 * checkout (que revalida y reliquida) o envía una solicitud que confirma una persona del equipo.
 */
export async function paginaPublicaComparativa(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const admin = createAdminClient();
  const { data: madre } = await admin.from("cotizaciones").select("*").eq("share_token", token).eq("modo", "comparativa").maybeSingle();
  if (!madre) return null;
  if (madre.estado === "descartada") notFound();
  const datos = await cargarDatosComparativa(admin, madre.id);
  const identidad = await identidadDe(admin, madre.tenant);

  // Quién mira (solo para elegir el camino «checkout» vs «solicitud»; no concede nada).
  const ses = await createClient();
  const { data: { user } } = await ses.auth.getUser();
  const { data: perfil } = user ? await ses.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle() : { data: null };
  // Anónima, o del carrito marcada para compartir mientras su creador interno siga activo con rol permitido: el visitante continúa por el checkout (misma regla que la base).
  const anonima = await visitantePuedeContinuar(admin, madre);
  const modo: ModoSeleccion =
    madre.tipo === "comparativa_carrito" && (anonima || canalDeRol(perfil?.rol, perfil?.activo) !== "publico") ? "checkout" : "solicitud";
  const vencida = (!!madre.vigencia_hasta && madre.vigencia_hasta < hoyBogota()) || abiertaConSalidaPasada(madre, hoyBogota());
  return (
    <div className="min-h-screen bg-gray-100 py-6 print:min-h-0 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-5xl items-center justify-end px-4 print:hidden"><PrintButton /></div>
      <div className="px-4 print:px-0">
        <ComparativaDocumento madre={madre} datos={datos} modo={modo} token={token} vencida={vencida} identidad={identidad} />
      </div>
      <style dangerouslySetInnerHTML={{ __html: ESTILO_IMPRESION }} />
    </div>
  );
}
