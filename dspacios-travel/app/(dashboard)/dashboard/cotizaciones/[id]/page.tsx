import { createClient } from "@/lib/supabase/server";
import { contextoCotizacion, autorizaTenant } from "@/lib/cotizacion/acceso";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import CondicionesPanel from "@/components/cotizacion/CondicionesPanel";
import { condicionesParaUI, type FilaCondicionRowUI } from "@/lib/cotizacion/condicionesParaUI";
import { CotizacionAcciones } from "./CotizacionAcciones";
import { VigenciaCotizacion } from "./VigenciaCotizacion";
import { DescartarBtn } from "./DescartarBtn";
import { ConvertirManualBtn } from "./ConvertirManualBtn";
import { TitularEditor } from "./TitularEditor";
import { IncluyeEditor } from "./IncluyeEditor";
import { RecobroNinosEditor } from "./RecobroNinosEditor";
import { ConvertirCarritoBtn } from "./ConvertirCarritoBtn";
import { ROLES_CONTRATO_COMPLETO } from "@/lib/roles";
import PagosPreviosPanel, { type PagoPrevioUI } from "@/components/cotizacion/PagosPreviosPanel";

const TIPO_SERV_LABEL: Record<string, string> = {
  aereo: "Aéreo", hotel: "Hotel", traslado: "Traslado", asistencia: "Asistencia médica", otro: "Otro",
};

export const dynamic = "force-dynamic";

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800">{value || "—"}</div>
    </div>
  );
}

export default async function CotizacionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createClient();
  const { data: c } = await sb
    .from("cotizaciones")
    .select("*")
    .eq("id", Number(id))
    .maybeSingle();

  if (!c) notFound();

  // Detalle interno: exige acceso al tenant de la cotización. Misma respuesta
  // (404) que "no existe" — no delata si el id pertenece a otra agencia.
  const ctxAcceso = await contextoCotizacion();
  if (!autorizaTenant(ctxAcceso, c.tenant)) notFound();

  const esManual = c.tipo === "manual";
  // Cotización combinada generada desde el carrito del tarifario público
  // (Fase 2 — checkout): puede traer varios hoteles/tours en un solo
  // documento. La conversión (Fase 3, ConvertirCarritoBtn) usa su propio
  // motor (convertirCotizacionCarrito) porque puede generar más de un
  // contrato (uno por destino) — no reutiliza CotizacionAcciones, que asume
  // un solo hotel.
  const esCarrito = c.tipo === "carrito";
  const moneda = c.moneda ?? "COP";
  const { data: serviciosManual } = esManual
    ? await sb.from("cotizacion_servicios").select("*").eq("cotizacion_id", c.id).order("orden")
    : { data: null };

  // Condiciones de pago por componente YA congeladas (migración 164). El panel
  // se enciende cuando existen filas (commit 4/5 las escribe al congelar); si
  // aún no hay snapshot, no renderiza nada. La tabla vive en el tipo base
  // (`types/database.ts`), así que se lee con el mismo cliente `sb`.
  const { data: condRows } = await sb
    .from("cotizacion_condiciones")
    .select("orden, tipo_componente, referencia_externa, valor_componente, condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo, monto_exigido, restriccion_comercial")
    .eq("cotizacion_id", c.id)
    .order("orden");
  const condicionesUI = condicionesParaUI((condRows ?? []) as FilaCondicionRowUI[]);

  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol, nombre").eq("id", user.id).single() : { data: null };
  const esSuperadmin = perfil?.rol === "superadmin";
  // El panel de pagos previos (migración 164) lo ve/opera solo el rol
  // autorizado — la MISMA lista que `_autorizado_pago_previo` en SQL.
  const esPagoAutorizado =
    !!perfil?.rol && (ROLES_CONTRATO_COMPLETO as readonly string[]).includes(perfil.rol);

  // Snapshot congelado (164) + pagos previos: solo se leen para el rol
  // autorizado en una cotización ABIERTA (RLS de `cotizacion_pagos_previos`).
  const lecturaPagos = esPagoAutorizado && c.estado === "abierta";
  const { data: congeladoCot } = lecturaPagos
    ? await sb
        .from("cotizaciones")
        .select("condicion_pago_congelada_en, trm_autoritativa, monto_exigido_total, monto_exigido_total_cop")
        .eq("id", c.id)
        .maybeSingle()
    : { data: null };
  const { data: pagosPrevios } = lecturaPagos
    ? await sb
        .from("cotizacion_pagos_previos")
        .select("id, monto_cop, trm, fecha_pago, forma_pago, referencia, estado")
        .eq("cotizacion_id", c.id)
        .order("id", { ascending: false })
    : { data: null };
  // Los asesores internos son los usuarios con rol 'venta'.
  const { data: asesores } = await sb.from("usuarios").select("nombre, email").eq("rol", "venta").eq("activo", true).order("nombre");
  // % por defecto del recobro para el aliado en B2B (editor de niños/recobro).
  const { data: paramDist } = await sb.from("parametros_tributarios").select("valor").eq("parametro", "recobro_pct_aliado_b2b").maybeSingle();
  const pctAliadoB2B = Number(paramDist?.valor ?? 0.5);
  const payload = (c.payload ?? {}) as {
    pasajeros?: unknown[]; infantes?: number;
    cliente?: { nombres?: string; apellidos?: string; tipoDoc?: string; numeroDoc?: string; nacimiento?: string; telefono?: string; email?: string };
    ninos?: number; tarifaNino?: number; recobro?: number; recobroAliado?: number;
    tipoAsesor?: "interno" | "agencia" | "freelance";
  };
  const esB2B = (payload.tipoAsesor ?? "interno") !== "interno";
  const tienePasajeros = Array.isArray(payload.pasajeros) && payload.pasajeros.length > 0;
  const clientePre = {
    nombres: payload.cliente?.nombres ?? "",
    apellidos: payload.cliente?.apellidos ?? "",
    tipoDoc: payload.cliente?.tipoDoc ?? "CC",
    numeroDoc: payload.cliente?.numeroDoc ?? "",
  };

  // Datos propios del carrito: pax máximo (para dimensionar la captura de
  // pasajeros) y destinos distintos (para ofrecer "1 contrato por destino").
  const payloadCarrito = (c.payload ?? {}) as {
    items?: { destino: string | null; pax: number; fechaIda: string | null; hotelNombre: string }[];
    tours?: { destino: string | null; pax: number }[];
    cliente?: { nombres?: string; apellidos?: string; numeroDoc?: string };
  };
  const itemsCarrito = payloadCarrito.items ?? [];
  const toursCarrito = payloadCarrito.tours ?? [];
  const destinosCarrito = [...new Set(itemsCarrito.map((i) => i.destino).filter((d): d is string => !!d))];
  const paxCarrito = Math.max(1, ...itemsCarrito.map((i) => i.pax || 0), ...toursCarrito.map((t) => t.pax || 0));
  const clienteCarritoPre = {
    nombres: payloadCarrito.cliente?.nombres ?? "",
    apellidos: payloadCarrito.cliente?.apellidos ?? "",
    numeroDoc: payloadCarrito.cliente?.numeroDoc ?? "",
  };
  const detalleCarrito = (c.detalle ?? {}) as { contratos?: string[] };
  const contratosCarrito = detalleCarrito.contratos ?? (c.numero_contrato ? [c.numero_contrato] : []);

  // Desglose interno: servicios + niños + recobro (oculto al cliente) = total.
  const detalleM = (c.detalle ?? {}) as { recobro?: { total?: number; empresa?: number; aliado?: number }; venta?: { ninos?: number } };
  const serviciosSubtotal = (serviciosManual ?? []).reduce((s, x) => s + (Number(x.valor) || 0), 0);
  const recobroTotal = Number(detalleM.recobro?.total ?? 0);
  const recobroEmpresa = Number(detalleM.recobro?.empresa ?? 0);
  const recobroAliado = Number(detalleM.recobro?.aliado ?? 0);
  const ninosSubtotal = Math.max((Number(c.precio_venta) || 0) - serviciosSubtotal - recobroTotal, 0);
  const numNinos = Number(detalleM.venta?.ninos ?? 0);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/cotizaciones" className="text-sm text-gray-400 hover:text-gray-600">
        ← Volver a cotizaciones
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-gray-900">{c.codigo}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {c.cliente ?? "—"} · {c.destino ?? "—"} · Viaje {formatFechaLarga(c.fecha_salida)}
          </p>
          <span className="mt-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            {c.estado}
          </span>
        </div>
        <Link href={`/cotizacion/${id}`} target="_blank">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>Ver / Imprimir cotización →</Button>
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-xs opacity-80">Precio de venta</div>
          <div className="text-xl font-bold">{formatMoneda(c.precio_venta ?? 0, moneda)}</div>
        </div>
        <Dato label="Pasajeros" value={String(c.pax ?? "—")} />
        <VigenciaCotizacion id={c.id} vigencia={c.vigencia_hasta} editable={c.estado === "abierta"} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Dato label="Hotel" value={c.hotel ?? "—"} />
        <Dato label="Plan" value={c.plan_nombre ?? "—"} />
        <Dato label="Fechas" value={`${formatFechaLarga(c.fecha_salida)} → ${formatFechaLarga(c.fecha_regreso)}`} />
        <Dato label="Asesor" value={c.asesor ?? "—"} />
      </div>

      <CondicionesPanel ui={condicionesUI} moneda={moneda} />

      {esManual && (
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">Servicios cotizados</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Plataforma</th><th className="px-4 py-2">Servicio</th>
                <th className="px-4 py-2">Proveedor</th><th className="px-4 py-2 text-right">Valor</th>
              </tr></thead>
              <tbody>
                {(serviciosManual ?? []).map((s) => (
                  <tr key={s.id} className="border-t border-gray-50">
                    <td className="px-4 py-2 text-gray-700">{TIPO_SERV_LABEL[s.tipo_servicio] ?? s.tipo_servicio}</td>
                    <td className="px-4 py-2 text-gray-500">{s.plataforma ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{s.nombre_servicio ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{s.proveedor ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">{formatMoneda(s.valor ?? 0, moneda)}</td>
                  </tr>
                ))}
                {!serviciosManual?.length && <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400">Sin servicios.</td></tr>}
              </tbody>
              <tfoot className="text-sm">
                <tr className="border-t border-gray-100 text-gray-500">
                  <td className="px-4 py-2" colSpan={4}>Subtotal servicios</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(serviciosSubtotal, moneda)}</td>
                </tr>
                {numNinos > 0 && (
                  <tr className="text-gray-500">
                    <td className="px-4 py-2" colSpan={4}>Niños ({numNinos})</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(ninosSubtotal, moneda)}</td>
                  </tr>
                )}
                {recobroTotal > 0 && (
                  <tr className="text-amber-700">
                    <td className="px-4 py-2" colSpan={4}>
                      Recobro <span className="text-[11px] text-amber-600">(oculto al cliente · empresa {formatMoneda(recobroEmpresa, moneda)}{recobroAliado > 0 ? ` · aliado ${formatMoneda(recobroAliado, moneda)}` : ""})</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(recobroTotal, moneda)}</td>
                  </tr>
                )}
                <tr className="border-t border-gray-200 font-medium">
                  <td className="px-4 py-2" colSpan={4}>Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(c.precio_venta ?? 0, moneda)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {esManual && c.estado === "abierta" && (
        <div className="mt-6 space-y-4">
          <TitularEditor
            id={c.id}
            inicial={{
              nombres: payload.cliente?.nombres ?? "",
              apellidos: payload.cliente?.apellidos ?? "",
              tipoDoc: payload.cliente?.tipoDoc ?? "CC",
              numeroDoc: payload.cliente?.numeroDoc ?? "",
              nacimiento: payload.cliente?.nacimiento ?? "",
              telefono: payload.cliente?.telefono ?? "",
              email: payload.cliente?.email ?? "",
            }}
          />
          <IncluyeEditor
            id={c.id}
            incluye={String((c.detalle as { incluye?: string } | null)?.incluye ?? "")}
            noIncluye={String((c.detalle as { noIncluye?: string } | null)?.noIncluye ?? "")}
          />
          <RecobroNinosEditor
            id={c.id}
            moneda={moneda}
            esB2B={esB2B}
            pctAliadoB2B={pctAliadoB2B}
            inicial={{
              ninos: Number(payload.ninos ?? detalleM.venta?.ninos ?? 0),
              tarifaNino: Number(payload.tarifaNino ?? 0),
              recobro: Number(payload.recobro ?? detalleM.recobro?.total ?? 0),
              recobroAliado: Number(payload.recobroAliado ?? detalleM.recobro?.aliado ?? 0),
            }}
          />
        </div>
      )}

      {/* Pagos previos + congelado de condiciones (migración 164, Commit 4).
          Solo cotización manual ABIERTA y rol autorizado; las demás tipos
          (single/carrito) llegan con la conversión a contrato único. */}
      {lecturaPagos && c.tipo === "manual" && (
        <PagosPreviosPanel
          cotizacionId={c.id}
          moneda={moneda}
          congelado={!!congeladoCot?.condicion_pago_congelada_en}
          montoExigidoMoneda={congeladoCot?.monto_exigido_total ?? null}
          montoExigidoCop={congeladoCot?.monto_exigido_total_cop ?? null}
          precioTotalMoneda={Number(c.precio_venta) || 0}
          trmAutoritativa={congeladoCot?.trm_autoritativa ?? null}
          pagos={(pagosPrevios ?? []) as PagoPrevioUI[]}
        />
      )}

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        {esManual ? (
          c.estado === "abierta" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-500">Cotización dinámica. Genera el contrato para confirmarla o descártala.</p>
              <div className="flex flex-wrap items-center gap-2">
                <DescartarBtn id={c.id} />
                <ConvertirManualBtn id={c.id} />
              </div>
            </div>
          ) : c.estado === "convertida" && c.numero_contrato ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-600">
                Convertida en contrato <span className="font-mono font-medium text-gray-800">{c.numero_contrato}</span>.
              </p>
              <Link href={`/dashboard/contratos/${encodeURIComponent(c.numero_contrato)}`}>
                <Button style={{ backgroundColor: "var(--brand-primary)" }}>Ver contrato →</Button>
              </Link>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Cotización descartada.</p>
          )
        ) : esCarrito ? (
          c.estado === "abierta" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-500">Cotización combinada del carrito (tarifario público).</p>
                <DescartarBtn id={c.id} />
              </div>
              <ConvertirCarritoBtn
                id={c.id}
                pax={paxCarrito}
                items={itemsCarrito.map((i) => ({ hotelNombre: i.hotelNombre, destino: i.destino, pax: i.pax, fechaIda: i.fechaIda ?? null }))}
                destinos={destinosCarrito}
                cliente={clienteCarritoPre}
                esSuperadmin={esSuperadmin}
                asesores={asesores ?? []}
                miNombre={perfil?.nombre ?? ""}
                miRolVenta={perfil?.rol === "venta"}
              />
            </div>
          ) : c.estado === "convertida" && contratosCarrito.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-600">
                Convertida en {contratosCarrito.length > 1 ? `${contratosCarrito.length} contratos` : "contrato"}:{" "}
                {contratosCarrito.map((n, i) => (
                  <span key={n}>
                    <span className="font-mono font-medium text-gray-800">{n}</span>
                    {i < contratosCarrito.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
              <div className="flex flex-wrap gap-2">
                {contratosCarrito.map((n) => (
                  <Link key={n} href={`/dashboard/contratos/${encodeURIComponent(n)}`}>
                    <Button style={{ backgroundColor: "var(--brand-primary)" }}>Ver {n} →</Button>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Cotización descartada.</p>
          )
        ) : c.estado === "abierta" ? (
          <CotizacionAcciones
            id={c.id}
            pax={c.pax ?? 1}
            infantes={payload.infantes ?? 0}
            tienePasajeros={tienePasajeros}
            cliente={clientePre}
            esSuperadmin={esSuperadmin}
            asesores={asesores ?? []}
            miNombre={perfil?.nombre ?? ""}
            miRolVenta={perfil?.rol === "venta"}
          />
        ) : c.estado === "convertida" && c.numero_contrato ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              Convertida en contrato <span className="font-mono font-medium text-gray-800">{c.numero_contrato}</span>.
            </p>
            <Link href={`/dashboard/contratos/${encodeURIComponent(c.numero_contrato)}`}>
              <Button style={{ backgroundColor: "var(--brand-primary)" }}>Ver contrato →</Button>
            </Link>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Cotización descartada.</p>
        )}
      </div>
    </div>
  );
}
