import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { ShareButtons } from "./ShareButtons";
import { GestionTabs } from "./GestionTabs";
import { EstadoVenta } from "./EstadoVenta";
import { EditarVentaForm } from "./EditarVentaForm";
import { ServiciosContratoEditor, type ServicioDispContrato } from "./ServiciosContratoEditor";
import { fiscalFromParams } from "@/lib/calc/finanzas";

export const dynamic = "force-dynamic";

export default async function ContratoDetallePage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const sb = await createClient();

  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const verFinanzas = ["superadmin", "gerencia", "administracion", "operaciones"].includes(perfil?.rol ?? "");

  const [
    { data: venta },
    { data: abonos },
    { data: cxp },
    { data: b2b },
    { data: facturas },
    { data: asesores },
    { data: formasPagoRows },
  ] = await Promise.all([
    sb.from("ventas").select("*").eq("numero_contrato", numero).single(),
    sb.from("abonos").select("id, valor_abono, forma_pago, referencia, fecha_abono").eq("numero_contrato", numero).order("fecha_abono", { ascending: false }),
    sb.from("cuentas_por_pagar").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("aliados_b2b").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("facturacion").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("asesores").select("nombre, email, pct_comision_base"),
    sb.from("formas_pago").select("nombre").order("orden"),
  ]);
  const formasPago = (formasPagoRows ?? []).map((f) => f.nombre);

  const { data: paramsRows } = await sb.from("parametros_tributarios").select("parametro, valor");
  const fiscal = fiscalFromParams(paramsRows ?? []);

  if (!venta) notFound();

  // Servicios del paquete (para editar los add-ons de un contrato PENDIENTE).
  let serviciosDisp: ServicioDispContrato[] = [];
  let seleccionServicios: number[] = [];
  if (venta.estado === "pendiente" && venta.paquete_armado_id) {
    const [{ data: servFilas }, { data: itemsServ }] = await Promise.all([
      sb.from("tarifario_resultado").select("servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, precio_pvp").eq("paquete_id", venta.paquete_armado_id).eq("modulo", "servicios"),
      sb.from("contrato_items").select("descripcion").eq("numero_contrato", numero),
    ]);
    const map = new Map<number, ServicioDispContrato>();
    for (const r of servFilas ?? []) {
      if (r.servicio_id == null) continue;
      let s = map.get(r.servicio_id);
      if (!s) { s = { servicioId: r.servicio_id, nombre: r.servicio_nombre ?? "—", modo: r.tipo_tarifa === "grupo" ? "grupo" : "persona", personaPvp: null, grupos: [] }; map.set(r.servicio_id, s); }
      if (s.modo === "grupo") s.grupos.push({ pax_desde: r.pax_desde ?? 1, pax_hasta: r.pax_hasta ?? 1, precio: r.precio_pvp });
      else s.personaPvp = r.precio_pvp;
    }
    serviciosDisp = [...map.values()];
    const nombresSel = new Set((itemsServ ?? []).filter((it) => it.descripcion?.startsWith("Servicio · ")).map((it) => it.descripcion!.replace(/^Servicio · /, "")));
    seleccionServicios = serviciosDisp.filter((s) => nombresSel.has(s.nombre)).map((s) => s.servicioId);
  }

  const totalPagado = (abonos ?? []).reduce((s, a) => s + (a.valor_abono ?? 0), 0);
  const saldo = Math.max(venta.precio_venta - totalPagado, 0);

  // Buscar el % de comisión del asesor (por email o por nombre de firma)
  const asesorNombre = venta.asesor_firma_nombre ?? venta.asesor ?? "";
  const asesorRow = (asesores ?? []).find(
    (a) => a.email === venta.asesor || a.nombre === asesorNombre
  );
  const asesorPct = asesorRow?.pct_comision_base ?? 0.08;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/contratos" className="text-sm text-gray-400 hover:text-gray-600">
        ← Contratos
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-gray-900">{venta.numero_contrato}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {venta.cliente} · {venta.destino ?? "—"} · Viaje {formatFechaLarga(venta.fecha_salida)}
          </p>
          <div className="mt-2">
            <EstadoVenta numero={venta.numero_contrato} estado={venta.estado} plazo={venta.plazo} puedeConfirmar={verFinanzas} />
          </div>
        </div>
        <Link href={`/contrato/${encodeURIComponent(numero)}`} target="_blank">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>Ver / Imprimir contrato →</Button>
        </Link>
      </div>

      {/* Totales */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-xs opacity-80">Precio de venta{venta.moneda && venta.moneda !== "COP" ? ` (${venta.moneda})` : ""}</div>
          <div className="text-xl font-bold">{formatMoneda(venta.precio_venta, venta.moneda)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Total pagado</div>
          <div className="text-xl font-bold" style={{ color: "var(--brand-success)" }}>{formatMoneda(totalPagado, venta.moneda)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Saldo pendiente</div>
          <div className="text-xl font-bold text-gray-800">{formatMoneda(saldo, venta.moneda)}</div>
        </div>
      </div>

      {/* Editar datos del contrato */}
      <EditarVentaForm
        numero={venta.numero_contrato}
        inicial={{
          cliente: venta.cliente ?? "",
          clienteDocumento: venta.cliente_documento ?? "",
          clienteTelefono: venta.cliente_telefono ?? "",
          clienteEmail: venta.cliente_email ?? "",
          clienteDireccion: venta.cliente_direccion ?? "",
          destino: venta.destino ?? "",
          fechaSalida: venta.fecha_salida ?? "",
          fechaRegreso: venta.fecha_regreso ?? "",
          plazo: venta.plazo ?? "",
          tipoAsesor: venta.tipo_asesor ?? "interno",
          agenciaNombre: venta.agencia_nombre ?? "",
          agenciaAsesor: venta.agencia_asesor ?? "",
          freelanceNombre: venta.freelance_nombre ?? "",
          asesorNombre: venta.asesor_firma_nombre ?? "",
          planNombre: venta.plan_nombre ?? "",
          observaciones: venta.observaciones ?? "",
        }}
      />

      {/* Servicios adicionales (solo contrato pendiente) */}
      {venta.estado === "pendiente" && (
        <ServiciosContratoEditor
          numero={venta.numero_contrato}
          pax={venta.pax ?? 0}
          serviciosDisp={serviciosDisp}
          seleccionInicial={seleccionServicios}
        />
      )}

      {/* Compartir */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-700">Compartir con el cliente</p>
        <ShareButtons token={venta.share_token} numero={venta.numero_contrato} cliente={venta.cliente} />
      </div>

      {/* Flujo de la venta */}
      <GestionTabs
        numero={numero}
        precioVenta={venta.precio_venta}
        asesorNombre={asesorNombre}
        asesorPct={asesorPct}
        fiscal={fiscal}
        verFinanzas={verFinanzas}
        costos={{
          costo_hotel: venta.costo_hotel,
          costo_aereo: venta.costo_aereo,
          costo_receptivo: venta.costo_receptivo,
          costo_asistencia: venta.costo_asistencia,
          otros_costos: venta.otros_costos,
        }}
        abonos={abonos ?? []}
        totalPagado={totalPagado}
        cuentasPorPagar={cxp ?? []}
        comisionesB2B={b2b ?? []}
        facturas={facturas ?? []}
        formasPago={formasPago}
      />
    </div>
  );
}
