"use client";

// ─────────────────────────────────────────────────────────────────────────
// Panel de PAGOS PREVIOS de una cotización (migración 164) — Commit 4.
//
// Cliente de vista + acciones: muestra el estado de congelado (pago mínimo
// exigido), el historial de pagos previos activos/anulados y el formulario
// para registrar uno nuevo (o anular uno activo). Las mutaciones van a las
// Server Actions de `dashboard/cotizaciones/pagos-actions.ts` (rol
// autorizado: superadmin/administración/gerencia/operaciones).
//
// El padre (page.tsx) decide si renderizarlo: solo para cotizaciones ABIERTAS
// y para un rol con permiso; aquí no hay lógica de autorización.
// ─────────────────────────────────────────────────────────────────────────
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2, Banknote, RotateCcw } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { registrarPagoPrevio, anularPagoPrevio } from "@/app/(dashboard)/dashboard/cotizaciones/pagos-actions";

export interface PagoPrevioUI {
  id: number;
  monto_cop: number;
  trm: number | null;
  fecha_pago: string | null;
  forma_pago: string | null;
  referencia: string | null;
  estado: string; // 'activo' | 'aplicado' | 'anulado'
}

export default function PagosPreviosPanel({
  cotizacionId,
  moneda,
  congelado,
  montoExigidoMoneda,
  montoExigidoCop,
  precioTotalMoneda,
  trmAutoritativa,
  pagos,
}: {
  cotizacionId: number;
  moneda: string;
  congelado: boolean;
  montoExigidoMoneda: number | null;
  montoExigidoCop: number | null;
  precioTotalMoneda: number | null;
  trmAutoritativa: number | null;
  pagos: PagoPrevioUI[];
}) {
  const router = useRouter();
  const esUSD = moneda === "USD";
  const [valor, setValor] = useState("");
  const [trm, setTrm] = useState(trmAutoritativa ? String(trmAutoritativa) : "");
  const [formaPago, setFormaPago] = useState("");
  const [referencia, setReferencia] = useState("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ── Idempotencia (A1): una clave de intento por INTENTO lógico de pago. ──
  // Se genera al iniciar, se CONSERVA ante resultado ambiguo (timeout/pérdida de
  // respuesta/reintento) y se ROTA solo tras éxito confirmado o cuando el usuario
  // inicia conscientemente otro pago (su `signature` — el conjunto de campos que
  // definen la identidad del pago — cambió). La `signature` compara los campos
  // REALES que se mandan, así que tocar el monto tras un rechazo es un pago nuevo.
  const intentRef = useRef<{ key: string; sig: string } | null>(null);
  function firmaDeIntento(opts: { monto: number; trm: number | null; forma: string; ref: string; fecha: string }) {
    return JSON.stringify([moneda, opts.monto, opts.trm, opts.forma.toLowerCase().trim(), opts.ref.trim(), opts.fecha]);
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const monto = Number(valor);
    if (!(monto > 0)) return setError("Indica el valor del pago.");
    if (esUSD && !(Number(trm) > 0)) return setError("Indica la TRM del día (cotización en USD).");
    const forma = formaPago.trim() || "Efectivo";
    const ref = referencia.trim();
    const trmNum = esUSD ? Number(trm) : null;
    const sig = firmaDeIntento({ monto, trm: trmNum, forma, ref, fecha });
    // ¿Misma intención que el intento pendiente? Reutiliza la clave (recupera el
    // pago original si ya se confirmó). ¿Cambió? Es OTRO pago → clave nueva.
    const intento = intentRef.current && intentRef.current.sig === sig ? intentRef.current : null;
    const key = intento?.key ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    intentRef.current = { key, sig };
    start(async () => {
      const r = await registrarPagoPrevio(
        cotizacionId,
        {
          valor: monto,
          moneda,
          trm: esUSD ? trmNum ?? undefined : undefined,
          formaPago: forma,
          referencia: ref || undefined,
          fechaPago: fecha,
        },
        key,
      );
      if (!r.ok) {
        // Mantener la clave: un error ambiguo puede ocultar un pago ya registrado;
        // reintentar con la misma clave recupera el resultado sin duplicar. Si el
        // usuario cambia el monto y reintenta, `sig` cambia y nace una clave nueva.
        return setError(r.error ?? "No se pudo registrar el pago.");
      }
      intentRef.current = null; // éxito confirmado → la próxima es una intención nueva
      setValor(""); setReferencia("");
      router.refresh();
    });
  }

  async function anular(pago: PagoPrevioUI) {
    if (!window.confirm("¿Anular este pago previo? Se reversará su asiento contable.")) return;
    setError(null);
    start(async () => {
      const r = await anularPagoPrevio(pago.id);
      if (!r.ok) return setError(r.error ?? "No se pudo anular el pago.");
      router.refresh();
    });
  }

  const activos = pagos.filter((p) => p.estado === "activo");
  const sumaActivosCop = Math.round(activos.reduce((s, p) => s + (Number(p.monto_cop) || 0), 0) * 100) / 100;

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">
        Pagos previos (pre-pago manual)
      </div>
      <div className="space-y-4 p-5">
        {/* Estado de congelado + pago mínimo */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Estado</div>
            <div className="text-sm text-gray-800">{congelado ? "Condiciones congeladas" : "Sin congelar (1er pago lo congela)"}</div>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Pago mínimo exigido</div>
            <div className="text-sm font-medium text-gray-800">
              {montoExigidoMoneda != null
                ? `${formatMoneda(montoExigidoMoneda, moneda)}${esUSD && trmAutoritativa ? ` ≈ ${formatMoneda(montoExigidoCop ?? 0, "COP")}` : ""}`
                : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Total abonado</div>
            <div className="text-sm text-gray-800">
              {esUSD && trmAutoritativa ? formatMoneda(sumaActivosCop / trmAutoritativa, "USD") : formatMoneda(sumaActivosCop, "COP")}
            </div>
          </div>
        </div>

        {/* Historial */}
        {pagos.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Forma</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-600">{p.fecha_pago ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {p.forma_pago ?? "—"}
                      {p.referencia && <span className="block text-[11px] text-gray-400">{p.referencia}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-800">
                      {formatMoneda(esUSD && p.trm ? (p.monto_cop || 0) / p.trm : p.monto_cop || 0, esUSD ? "USD" : "COP")}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                          (p.estado === "activo"
                            ? "bg-green-50 text-green-700"
                            : p.estado === "anulado"
                              ? "bg-gray-100 text-gray-500"
                              : "bg-blue-50 text-blue-700")
                        }
                      >
                        {p.estado === "activo" ? "Activo" : p.estado === "anulado" ? "Anulado" : "Aplicado"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.estado === "activo" && (
                        <button
                          onClick={() => anular(p)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
                          type="button"
                          disabled={pending}
                          title="Anular pago previo (revierte el asiento)"
                        >
                          <RotateCcw className="h-3 w-3" /> Anular
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Formulario de registro */}
        <form onSubmit={registrar} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Valor a abonar ({esUSD ? "USD" : "COP"})
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={esUSD ? "0.00" : "0"}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm"
                required
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Forma de pago</span>
              <input
                value={formaPago}
                onChange={(e) => setFormaPago(e.target.value)}
                placeholder="Ej. Efectivo, Transferencia, Tarjeta…"
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm"
              />
            </label>
            {esUSD && (
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">TRM del día</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={trm}
                  onChange={(e) => setTrm(e.target.value)}
                  placeholder="COP por USD"
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm"
                  required
                />
              </label>
            )}
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Fecha</span>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Referencia (opcional)</span>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="N° de consignación / comprobante…"
              className="mt-1 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
            Registrar pago previo
          </button>
          {precioTotalMoneda != null && (
            <p className="text-[11px] text-gray-400">
              No se admite sobrepagar: el acumulado de pagos previos no puede superar {formatMoneda(precioTotalMoneda, moneda)}.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
