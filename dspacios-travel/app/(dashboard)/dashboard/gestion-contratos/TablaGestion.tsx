// #106 · Lista de contratos (una fila por contrato). Un solo DOM. La disposición depende del ANCHO REAL DEL CONTENEDOR (container queries), no del viewport:
// la barra lateral (256 px) y el relleno de la página le quitan ~320 px al contenido, así que un breakpoint de viewport metía seis columnas en ~450 px y las fechas se
// montaban sobre el cobro. Contenedor < 36rem: tarjeta apilada · ≥ 36rem: 2 columnas · ≥ 48rem: 3 columnas · ≥ 64rem: seis columnas con encabezado. Todo el texto/tono sale de lib/gestionContratos/presentacion.ts (probado aparte).
import Link from "next/link";
import { Building2, CalendarDays, CircleAlert, ExternalLink, TriangleAlert } from "lucide-react";
import { EstadoBadge } from "@/components/EstadoBadge";
import {
  NOMBRE_AGENCIA, accionesSeguimiento, comisionVista, dinero, enlacesDe, facturaEmisionVista, facturaEnvioVista, fechaCorta, numeroMostrado, saldoVista, voucherEntregaVista, voucherGeneracionVista,
  type Vista,
} from "@/lib/gestionContratos/presentacion";
import type { FilaGestion } from "@/lib/gestionContratos/tipos";
import { SeguimientoControl } from "./SeguimientoControl";

export const REJILLA = "@xl:grid @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.05fr)_minmax(0,1.3fr)_minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1.1fr)] @xl:gap-x-4 @xl:gap-y-4 @5xl:gap-y-0";

function Bloque({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 min-w-0 @xl:mt-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 @5xl:hidden">{rotulo}</p>
      {children}
    </div>
  );
}

function Estado({ v }: { v: Vista }) {
  return (
    <>
      <EstadoBadge estado={v.texto} tono={v.tono} className="normal-case" />
      {v.detalle && <p className="mt-1 text-xs leading-snug text-gray-500">{v.detalle}</p>}
    </>
  );
}

/** Un paso del ciclo de un documento (generación → entrega, validación DIAN → envío), con su rótulo: así lo generado nunca se lee como entregado. */
function Paso({ rotulo, v }: { rotulo: string; v: Vista }) {
  return (
    <div className="mt-2 first-of-type:mt-0">
      <p className="mb-0.5 text-[11px] font-medium text-gray-500">{rotulo}</p>
      <Estado v={v} />
    </div>
  );
}

export function EncabezadoGestion() {
  return (
    <div className={`hidden border-b border-gray-200 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 @5xl:grid @5xl:gap-x-4 @5xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.05fr)_minmax(0,1.3fr)_minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1.1fr)]`} aria-hidden>
      <span>Contrato</span><span>Fechas</span><span>Cobro</span><span>Voucher</span><span>Factura</span><span>Comisión B2B</span>
    </div>
  );
}

function Fila({ f }: { f: FilaGestion }) {
  const saldo = saldoVista(f);
  const accV = accionesSeguimiento(f.voucher.entrega, f.voucher.n > 0);
  const accF = accionesSeguimiento(f.factura.envio, f.factura.emitida);
  const esMay = f.tenant === "mayorista";
  return (
    <article className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm @3xl:rounded-none @3xl:border-0 @3xl:border-b @3xl:shadow-none ${REJILLA}`} aria-label={`Contrato ${numeroMostrado(f.numero)}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-gray-700"
            style={{ backgroundColor: esMay ? "rgba(38,187,217,.14)" : "rgba(174,244,74,.28)" }}>
            <Building2 size={12} aria-hidden /> {NOMBRE_AGENCIA[f.tenant]}
          </span>
          <EstadoBadge estado={f.estado ?? "sin estado"} />
        </div>
        <p className="mt-1.5 break-words font-mono text-sm font-semibold text-gray-900">{numeroMostrado(f.numero)}</p>
        <p className="break-words text-sm text-gray-700">{f.cliente ?? "Sin cliente"}</p>
        {f.destino && <p className="text-xs text-gray-500">{f.destino}</p>}
        {f.financieroPendiente && <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700"><TriangleAlert size={12} aria-hidden /> Registro financiero incompleto</p>}
      </div>

      <Bloque rotulo="Fechas">
        <p className="flex items-center gap-1 text-sm text-gray-700"><CalendarDays size={12} className="shrink-0 text-gray-400" aria-hidden /> Compra {fechaCorta(f.fechaVenta)}</p>
        <p className="text-sm text-gray-700">Viaje {fechaCorta(f.fechaSalida)}</p>
        {f.fechaRegreso ? <p className="text-sm text-gray-700">Regreso {fechaCorta(f.fechaRegreso)}</p> : null}
      </Bloque>

      <Bloque rotulo="Cobro">
        <p className="break-words text-sm tabular-nums text-gray-700">Total {dinero(f.total, f.monedaCobro)} <span className="text-xs text-gray-400">{f.monedaCobro}</span></p>
        <p className="break-words text-sm tabular-nums text-gray-700">Pagado {dinero(f.pagado, f.monedaCobro)}{f.nAbonos > 0 ? <span className="text-xs text-gray-400"> · {f.nAbonos} abono{f.nAbonos === 1 ? "" : "s"}</span> : null}</p>
        <div className="mt-1"><Estado v={saldo} /></div>
        {f.cobroConvertido && <p className="mt-1 text-xs text-gray-500">Oferta en {f.monedaOferta} ({dinero(f.precioOferta, f.monedaOferta)}); se cobra en {f.monedaCobro}.</p>}
      </Bloque>

      <Bloque rotulo="Voucher">
        <Paso rotulo="Generación" v={voucherGeneracionVista(f)} />
        <Paso rotulo="Entrega" v={voucherEntregaVista(f)} />
        {f.voucher.nota && f.voucher.evento === "marcar" && <p className="mt-1 break-words text-xs italic text-gray-500">«{f.voucher.nota}»</p>}
        <SeguimientoControl numero={f.numero} uid={f.uid} tipo="voucher_entregado" puedeMarcar={accV.marcar} puedeRetirar={accV.retirar} />
      </Bloque>

      <Bloque rotulo="Factura">
        <Paso rotulo="Emisión (DIAN)" v={facturaEmisionVista(f)} />
        <Paso rotulo="Envío" v={f.factura.emitida ? facturaEnvioVista(f) : { texto: "—", tono: "neutral", detalle: "Se registra cuando la factura esté emitida (validada por la DIAN)." }} />
        {f.factura.nota && f.factura.evento === "marcar" && <p className="mt-1 break-words text-xs italic text-gray-500">«{f.factura.nota}»</p>}
        <SeguimientoControl numero={f.numero} uid={f.uid} tipo="factura_enviada" puedeMarcar={accF.marcar} puedeRetirar={accF.retirar} />
      </Bloque>

      <Bloque rotulo="Comisión B2B">
        <Estado v={comisionVista(f.comision.clase)} />
        {f.comision.filas > 1 && <p className="mt-1 text-xs text-gray-500">{f.comision.filas} filas de comisión</p>}
      </Bloque>

      <nav aria-label={`Accesos del contrato ${numeroMostrado(f.numero)}`} className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3 @xl:col-span-full">
        {enlacesDe(f).map((e) => (
          <Link key={e.clave} href={e.href} prefetch={false} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium hover:bg-gray-50" style={{ color: "var(--brand-primary)" }}>
            <ExternalLink size={11} aria-hidden /> {e.etiqueta}
          </Link>
        ))}
      </nav>
    </article>
  );
}

export function TablaGestion({ filas }: { filas: FilaGestion[] }) {
  if (filas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
        <CircleAlert size={20} className="mx-auto mb-2 text-gray-400" aria-hidden />
        No hay contratos que coincidan con estos filtros.
      </div>
    );
  }
  return (
    <div className="@container">
      <div className="space-y-3 @3xl:space-y-0 @3xl:overflow-hidden @3xl:rounded-xl @3xl:border @3xl:border-gray-200 @3xl:bg-white @3xl:pt-3 @3xl:shadow-sm">
        <EncabezadoGestion />
        {filas.map((f) => <Fila key={`${f.numero}:${f.uid}`} f={f} />)}
      </div>
    </div>
  );
}
