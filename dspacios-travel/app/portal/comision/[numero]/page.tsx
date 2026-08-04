import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrintButton } from "@/components/contrato/PrintButton";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { pesosEnLetras } from "@/lib/utils/numeroALetras";
import { agenciaDe } from "@/lib/tenant.server";
import { esTenant } from "@/lib/tenant";
import { calcComisionB2B } from "@/lib/calc/finanzas";

export const dynamic = "force-dynamic";

type AliadoCatalogo = {
  nombre: string;
  tipo_documento: string | null;
  nit: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
};

// Detalle de cómo se llegó al valor a cobrar. La vía 2 (aliados_b2b) trae el
// desglose completo (calcComisionB2B); la vía 1 (ventas.comision_b2b, flujo
// tarifario B2B) solo guarda el total ya calculado, sin desglose granular —
// se muestra un % "efectivo" (comisión/PVP) en vez del % contratado real.
type Detalle = {
  pvp: number;
  baseComisionable: number | null;
  pctComision: number;
  esPctEfectivo: boolean;
  comisionBase: number | null;
  recobroAliado: number | null;
  aplicaRetencion: boolean | null;
  pctRetencion: number | null;
  retencion: number | null;
  totalPagar: number;
};

export default async function CuentaCobroPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) notFound();
  const { data: perfil } = await sb.from("usuarios").select("nombre, rol").eq("id", user.id).maybeSingle();

  const admin = createAdminClient();
  const { data: v } = await admin
    .from("ventas")
    .select("numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, modo_compra, comision_b2b, comision_estado, b2b_usuario_id, agencia_nombre, freelance_nombre, tipo_asesor, tenant")
    .eq("numero_contrato", numero)
    .maybeSingle();
  if (!v) notFound();

  // Vía 1: flujo tarifario/reservar B2B (solo mayorista) — la comisión ya
  // queda en `ventas.comision_b2b`. Vía 2: comisión agregada a mano desde el
  // contrato (`aliados_b2b`) — único camino en minorista (sin tarifario/
  // reservar), también usado en mayorista para comisiones manuales. Se
  // intenta la vía 1 primero y se cae a la 2 si no aplica.
  const esVentasB2B = v.modo_compra === "comisionable" && !!v.comision_b2b;
  let aliadoB2B: { aliado: string | null; tipoAliado: string | null; aliadoId: number | null; detalle: Detalle } | null = null;
  if (!esVentasB2B) {
    const { data: b } = await admin
      .from("aliados_b2b")
      .select("aliado, tipo_aliado, aliado_id, base_comision, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion")
      .eq("numero_contrato", numero)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (b) {
      const c = calcComisionB2B({
        precioVenta: v.precio_venta ?? 0,
        baseComisionable: b.base_comision,
        pctComision: b.pct_comision,
        recobroTotal: b.recobro_total,
        pctRecobroAliado: b.pct_recobro_aliado,
        aplicaRetencion: b.aplica_retencion,
        pctRetencion: b.pct_retencion,
      });
      aliadoB2B = {
        aliado: b.aliado,
        tipoAliado: b.tipo_aliado,
        aliadoId: b.aliado_id,
        detalle: {
          pvp: v.precio_venta ?? 0,
          baseComisionable: b.base_comision,
          pctComision: b.pct_comision,
          esPctEfectivo: false,
          comisionBase: c.comisionBase,
          recobroAliado: c.recobroAliado,
          aplicaRetencion: b.aplica_retencion,
          pctRetencion: b.pct_retencion,
          retencion: c.retencion,
          totalPagar: c.totalPagar,
        },
      };
    }
  }
  if (!esVentasB2B && !aliadoB2B) notFound();

  const tipoAsesorEfectivo = esVentasB2B ? v.tipo_asesor : aliadoB2B!.tipoAliado;
  const aliadoNombre = esVentasB2B ? (v.freelance_nombre || v.agencia_nombre) : aliadoB2B!.aliado;
  const pvp = v.precio_venta ?? 0;
  const detalle: Detalle = esVentasB2B
    ? {
        pvp,
        baseComisionable: null,
        pctComision: pvp > 0 ? Number(v.comision_b2b) / pvp : 0,
        esPctEfectivo: true,
        comisionBase: null,
        recobroAliado: null,
        aplicaRetencion: null,
        pctRetencion: null,
        retencion: null,
        totalPagar: Number(v.comision_b2b),
      }
    : aliadoB2B!.detalle;
  const montoComision = detalle.totalPagar;

  // Seguridad: solo el aliado dueño del contrato (o un interno) puede verla.
  const esInterno = ["superadmin", "administracion", "gerencia", "operaciones"].includes(perfil?.rol ?? "");
  const esDueno = esVentasB2B
    ? v.b2b_usuario_id === user.id || [v.agencia_nombre, v.freelance_nombre].includes(perfil?.nombre ?? "")
    : !!aliadoNombre && aliadoNombre === (perfil?.nombre ?? "");
  if (!esInterno && !esDueno) notFound();
  // Cuenta de cobro = documento de PERSONA NATURAL (freelance). Las agencias
  // (persona jurídica) deben facturar electrónicamente, no generan este documento.
  if (tipoAsesorEfectivo === "agencia" && !esInterno) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm text-gray-600">
          Esta comisión corresponde a una agencia (persona jurídica). Las agencias deben
          enviar su factura electrónica para cobrar la comisión, no una cuenta de cobro.
        </p>
      </div>
    );
  }

  const moneda = v.moneda ?? "COP";
  const aliado = aliadoNombre || perfil?.nombre || "";
  const hoy = new Date().toISOString().slice(0, 10);
  // Membrete: razón/nombre comercial de la agencia dueña del contrato (mayorista
  // o minorista) — antes estaba fijo en "Mayorista", incorrecto para minorista.
  const tenantVenta = esTenant(v.tenant) ? v.tenant : "mayorista";
  const agencia = await agenciaDe(tenantVenta);
  const nombreAgencia = agencia?.nombre_comercial || agencia?.razon_social || "D'SPACIOS TRAVEL";
  const nitAgencia = agencia?.nit ?? null;
  const direccionAgencia = agencia?.direccion ?? null;

  // Datos del aliado (documento/dirección/cuenta bancaria) para el
  // encabezado y "Datos de pago" — desde el catálogo `aliados` si la
  // comisión quedó enlazada (aliado_id) o, si no, por coincidencia de
  // nombre (comisiones tipeadas a mano antes de que existiera el enlace).
  let aliadoInfo: AliadoCatalogo | null = null;
  if (!esVentasB2B && aliadoB2B?.aliadoId) {
    const { data } = await admin
      .from("aliados")
      .select("nombre, tipo_documento, nit, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta")
      .eq("id", aliadoB2B.aliadoId)
      .maybeSingle();
    aliadoInfo = data;
  } else if (aliado) {
    const { data } = await admin
      .from("aliados")
      .select("nombre, tipo_documento, nit, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta")
      .ilike("nombre", aliado)
      .limit(1)
      .maybeSingle();
    aliadoInfo = data;
  }

  const concepto = `Comisión por venta — Contrato ${v.numero_contrato} — Cliente ${v.cliente}${v.destino ? ` — Destino ${v.destino}` : ""}`;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href="/portal/b2b" className="text-sm text-gray-500 hover:text-gray-800">← Mis contratos</Link>
        <PrintButton />
      </div>
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="cuenta-doc rounded-xl bg-white p-8 shadow-sm print:rounded-none print:shadow-none">
          {/* ── Encabezado: quien cobra ────────────────────────────── */}
          <div className="text-sm text-gray-700">
            <p className="text-base font-semibold text-gray-900">{aliado}</p>
            {aliadoInfo?.nit && <p>{aliadoInfo.tipo_documento ?? "NIT"}: {aliadoInfo.nit}</p>}
            {aliadoInfo?.direccion && <p>Dirección: {aliadoInfo.direccion}</p>}
            {aliadoInfo?.telefono && <p>Teléfono: {aliadoInfo.telefono}</p>}
            {aliadoInfo?.email && <p>Email: {aliadoInfo.email}</p>}
          </div>

          <hr className="my-4 border-gray-200" />

          <h1 className="text-center text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>CUENTA DE COBRO</h1>
          <p className="mt-1 text-center text-sm text-gray-500">Fecha de elaboración: {formatFechaLarga(hoy)}</p>

          <div className="mt-6 text-sm text-gray-700">
            <p className="text-gray-500">COMPAÑÍA</p>
            <p className="font-semibold">{nombreAgencia}</p>
            {nitAgencia && <p>NIT: {nitAgencia}</p>}
            {direccionAgencia && <p>{direccionAgencia}</p>}
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">DEBE LA SUMA DE</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(montoComision, moneda)}</p>
            <p className="mt-1 text-sm text-gray-500">({pesosEnLetras(montoComision, moneda === "USD" ? "USD" : "COP")})</p>
          </div>

          <div className="mt-6 text-sm text-gray-700">
            <p className="text-gray-500">POR CONCEPTO DE</p>
            <p className="font-medium">{concepto}</p>
          </div>

          {/* ── Desglose: de dónde sale el valor ─────────────────────── */}
          <table className="mt-5 w-full border-collapse text-sm">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Fecha de viaje</td><td className="py-2 text-right">{formatFechaLarga(v.fecha_salida)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Total PVP</td><td className="py-2 text-right tabular-nums">{formatMoneda(detalle.pvp, moneda)}</td></tr>
              {detalle.baseComisionable != null && (
                <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Base comisionable</td><td className="py-2 text-right tabular-nums">{formatMoneda(detalle.baseComisionable, moneda)}</td></tr>
              )}
              <tr className="border-b border-gray-100">
                <td className="py-2 text-gray-500">{detalle.esPctEfectivo ? "% comisión (efectivo)" : "% comisión"}</td>
                <td className="py-2 text-right tabular-nums">{(detalle.pctComision * 100).toFixed(2)}%</td>
              </tr>
              {detalle.comisionBase != null && (
                <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Comisión</td><td className="py-2 text-right tabular-nums">{formatMoneda(detalle.comisionBase, moneda)}</td></tr>
              )}
              {detalle.recobroAliado != null && detalle.recobroAliado > 0 && (
                <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Recobro</td><td className="py-2 text-right tabular-nums">{formatMoneda(detalle.recobroAliado, moneda)}</td></tr>
              )}
              {detalle.aplicaRetencion && detalle.retencion != null && detalle.retencion > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-500">Retención en la fuente ({((detalle.pctRetencion ?? 0) * 100).toFixed(1)}%)</td>
                  <td className="py-2 text-right tabular-nums text-red-600">− {formatMoneda(detalle.retencion, moneda)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-[rgba(29,124,154,0.06)] px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">Total a cobrar</span>
            <span className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(montoComision, moneda)}</span>
          </div>

          {/* ── Declaración de retención (Art. 383 E.T.) ─────────────── */}
          {detalle.aplicaRetencion === false && (
            <div className="mt-6 text-xs text-gray-500">
              <p>
                Para efectos de lo establecido en el parágrafo 2 del Artículo 383 del E.T., modificado por el
                Artículo 17 de la Ley 1819 de 2016, manifiesto que:
              </p>
              <ol className="ml-4 mt-1 list-decimal space-y-0.5">
                <li>No he contratado o vinculado dos (2) personas o más trabajadores asociados a la actividad que desarrollo.</li>
                <li>En el año gravable anterior mis ingresos o ventas no superaron las 3.300 UVT.</li>
                <li>No soy declarante de renta.</li>
              </ol>
              <p className="mt-2 text-center font-semibold text-gray-600">NO HACER RETENCIÓN EN LA FUENTE</p>
            </div>
          )}

          {/* ── Datos de pago del aliado ──────────────────────────────── */}
          {aliadoInfo?.numero_cuenta && (
            <div className="mt-6 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <p className="font-semibold text-gray-700">Forma de pago: Transferencia bancaria</p>
              <p>Banco: {aliadoInfo.banco ?? "—"}</p>
              <p>Tipo de cuenta: {aliadoInfo.tipo_cuenta ?? "—"}</p>
              <p>A nombre de: {aliadoInfo.nombre}</p>
              <p>Número de cuenta: {aliadoInfo.numero_cuenta}</p>
            </div>
          )}

          <div className="mt-10 text-sm text-gray-600">
            <div className="border-t border-gray-300 pt-2" style={{ width: 260 }}>Firma</div>
            <p className="mt-1">{aliado}</p>
            {aliadoInfo?.nit && <p className="text-xs text-gray-400">{aliadoInfo.tipo_documento ?? "NIT"} {aliadoInfo.nit}</p>}
          </div>

          <footer className="mt-8 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
            Documento generado por el Portal B2B de D&apos;spacios Travel.
          </footer>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .cuenta-doc, .cuenta-doc * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { size: A4; margin: 14mm; }
        @media print { html, body { background: #fff !important; } }
      ` }} />
    </div>
  );
}
