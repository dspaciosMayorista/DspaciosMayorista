import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCOP } from "@/lib/utils";
import { calcularEstadosFinancieros } from "@/lib/finanzas/estadoResultados";

export const dynamic = "force-dynamic";
const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function EstadosFinancierosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Estados financieros</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Uso contable (administración / gerencia).</p>
      </div>
    );
  }

  const { mes } = await searchParams;
  const ef = await calcularEstadosFinancieros(mes);
  const r = ef.resultados;
  const s = ef.situacion;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Estados financieros</h1>
      <p className="mb-4 mt-1 text-sm text-gray-500">
        Estado de Resultados con ingreso propio como ingreso y el costo del proveedor neto de IVA (no es el flujo).
      </p>

      {/* Selector de mes */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Mes:</span>
        {ef.meses.map((m) => (
          <Link key={m} href={`?mes=${m}`} className="rounded-md px-2.5 py-1 text-sm font-medium"
            style={m === ef.mes ? { backgroundColor: "var(--brand-primary)", color: "white" } : { backgroundColor: "#f3f4f6", color: "#6b7280" }}>
            {m}
          </Link>
        ))}
        {ef.meses.length === 0 && <span className="text-sm text-gray-400">Sin ventas registradas.</span>}
      </div>

      {/* Validador de configuración */}
      <div className={`mb-6 rounded-xl border p-4 ${ef.validador.incompletos > 0 ? "border-amber-300 bg-amber-50" : "border-[#66B596]/40 bg-[#66B596]/10"}`}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">
            Configuración del periodo: {ef.validador.completos}/{ef.validador.contratos.length} contratos completos
          </p>
          <Link href="/dashboard/contabilidad/facturacion" className="text-xs font-medium text-[#1D7C9A] hover:underline">Ir a Facturación →</Link>
        </div>
        {ef.validador.incompletos > 0 && (
          <>
            <p className="mt-1 text-xs text-amber-700">
              {ef.validador.incompletos} contrato(s) sin configurar completos: el Estado de Resultados de abajo está
              <b> subvalorado</b> hasta que cada contrato tenga su facturación (ingreso propio) y todos sus proveedores
              marcados (Costo + base gravable / IRT).
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead><tr className="text-left text-gray-400">
                  <th className="py-1 pr-3">Contrato</th><th className="py-1 pr-3">Cliente</th>
                  <th className="py-1 pr-3">Facturación</th><th className="py-1 pr-3">Proveedores</th><th className="py-1">Estado</th>
                </tr></thead>
                <tbody>
                  {ef.validador.contratos.filter((c) => !c.completo).map((c) => (
                    <tr key={c.numero_contrato} className="border-t border-amber-200/60">
                      <td className="py-1 pr-3"><Link href={`/dashboard/contratos/${encodeURIComponent(c.numero_contrato)}`} className="font-mono text-[#1D7C9A] hover:underline">{c.numero_contrato}</Link></td>
                      <td className="py-1 pr-3 text-gray-600">{c.cliente ?? "—"}</td>
                      <td className="py-1 pr-3">{c.facturacionOk ? "✓" : <span className="text-amber-700">falta</span>}</td>
                      <td className="py-1 pr-3 text-gray-600">{c.proveedoresConfig}/{c.totalProveedores}</td>
                      <td className="py-1 text-amber-700">incompleto</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Estado de resultados */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}>Estado de Resultados · {ef.mes}</h2>
          <table className="w-full text-sm">
            <tbody>
              <Fila k="Ingresos operacionales (ingreso propio)" v={r.ingresoPropio} bold />
              <Fila k="(−) Costo de ventas (proveedor − IVA)" v={-r.costoVentas} />
              <Fila k="= Utilidad bruta" v={r.utilidadBruta} bold linea />
              <Fila k="(−) Gastos de personal (nómina)" v={-r.gastosPersonal} />
              <Fila k="(−) Gastos generales (fijos + pagos)" v={-r.gastosGenerales} />
              <Fila k="(−) Provisión ICA + Bomberil" v={-(r.provIca + r.provBomberil)} />
              <Fila k="(−) Provisión Fontur" v={-r.provFontur} />
              <Fila k="= Utilidad operacional" v={r.utilidadOperacional} bold linea />
              <Fila k="(+) Otros ingresos (movimientos)" v={r.otrosIngresos} />
              <Fila k="= Utilidad antes de impuestos (renta líquida)" v={r.utilidadAntesImp} bold linea />
              <Fila k="(−) Impuesto de renta (35% renta líquida)" v={-r.impuestoRenta} />
              <Fila k="= Utilidad neta del periodo" v={r.utilidadNeta} bold linea color="var(--brand-primary)" />
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
            <span className="text-xs font-medium text-gray-500">Margen neto (sobre ingreso propio)</span>
            <span className="text-sm font-bold" style={{ color: r.utilidadNeta < 0 ? "#C0392B" : "var(--brand-primary)" }}>{r.margenNeto.toFixed(1)}%</span>
          </div>
        </section>

        {/* Situación financiera */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}>Estado de Situación Financiera</h2>
          <p className="mb-2 text-[11px] text-gray-400">Borrador con la información del sistema (acumulado). Faltan efectivo/bancos y capital — los ajustamos.</p>
          <table className="w-full text-sm">
            <tbody>
              <Fila k="Cuentas por cobrar (cartera)" v={s.cuentasPorCobrar} />
              <Fila k="= Total activo (parcial)" v={s.cuentasPorCobrar} bold linea />
              <Fila k="Cuentas por pagar proveedores (IP)" v={s.cuentasPorPagar} />
              <Fila k="IRT por pagar (a terceros)" v={s.irtPorPagar} />
              <Fila k="› Total proveedores (IP + IRT)" v={s.cuentasPorPagar + s.irtPorPagar} />
              <Fila k="IVA por pagar" v={s.ivaPorPagar} />
              <Fila k="= Total pasivo (parcial)" v={s.cuentasPorPagar + s.irtPorPagar + s.ivaPorPagar} bold linea />
              <Fila k="= Patrimonio (residual)" v={s.patrimonioResidual} bold linea color="var(--brand-primary)" />
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Fila({ k, v, bold, linea, color }: { k: string; v: number; bold?: boolean; linea?: boolean; color?: string }) {
  return (
    <tr className={linea ? "border-t border-gray-200" : "border-t border-gray-50"}>
      <td className={`py-1.5 ${bold ? "font-semibold text-gray-800" : "text-gray-600"}`}>{k}</td>
      <td className={`py-1.5 text-right tabular-nums ${bold ? "font-bold" : ""}`} style={color ? { color } : v < 0 ? { color: "#6b7280" } : undefined}>
        {formatCOP(v)}
      </td>
    </tr>
  );
}
