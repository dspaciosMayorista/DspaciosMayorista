"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { formatMoneda } from "@/lib/utils";
import { fijarMinimoConfirmacion } from "./cobros-actions";

export type DetalleMinimo = {
  regla: "acuerdo" | "condicion_congelada" | "legacy_pct";
  minimo: number;
  moneda: string;
  pagado: number;
  alcanza: boolean;
  acuerdoTipo: "total" | "porcentaje" | "importe" | null;
};

const MOTIVO: Record<DetalleMinimo["regla"], string> = {
  acuerdo: "mínimo acordado por superadmin",
  condicion_congelada: "condición de pago congelada del contrato",
  legacy_pct: "regla general (sin condiciones congeladas)",
};

/**
 * #53 (307): muestra el mínimo VIGENTE para confirmar un contrato pendiente (NETO y PVP se resuelven igual) y, solo a superadmin, deja cambiarlo: porcentaje,
 * importe en la moneda de cobro o el total (100 % cuando el hotel lo exige). La base decide quién puede (`fijar_minimo_confirmacion`); esto solo evita botones que fallan.
 * Cambiar el mínimo NO confirma el contrato: si los abonos ya lo alcanzan, aparece el aviso de siempre con «Reintentar confirmación».
 */
export function MinimoConfirmacionPanel({
  numero, identidad, detalle, puedeEditar,
}: { numero: string; identidad: IdentidadContrato; detalle: DetalleMinimo; puedeEditar: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tipo, setTipo] = useState<"porcentaje" | "importe" | "total">("porcentaje");
  const [valor, setValor] = useState("");
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const moneda = detalle.moneda === "USD" ? "USD" : "COP";
  const saldoMinimo = Math.max(0, detalle.minimo - detalle.pagado);

  return (
    <section aria-label="Pago mínimo para confirmar" className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--brand-primary)" }} aria-hidden />
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">Pago mínimo para confirmar</h3>
          <p className="mt-1 text-gray-700">
            <span className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(detalle.minimo, moneda)}</span>
            <span className="ml-2 text-xs text-gray-500">{MOTIVO[detalle.regla]}</span>
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Pagado {formatMoneda(detalle.pagado, moneda)} · {detalle.alcanza ? "ya alcanza el mínimo" : `faltan ${formatMoneda(saldoMinimo, moneda)} para confirmar`}.
            NETO y PVP se resuelven con la misma regla.
          </p>

          {puedeEditar && (
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[auto_8rem_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setMsg(null);
                start(async () => {
                  const r = await fijarMinimoConfirmacion(numero, tipo, tipo === "total" ? null : Number(valor.replace(/\./g, "").replace(",", ".")), nota, identidad);
                  if (!r.ok) { setMsg({ ok: false, texto: r.error }); return; }
                  setMsg({ ok: true, texto: r.alcanza ? "Mínimo guardado. Los abonos ya lo alcanzan: usa «Reintentar confirmación» arriba para confirmar." : "Mínimo guardado." });
                  setValor(""); setNota("");
                  router.refresh();
                });
              }}
            >
              <label className="text-xs font-medium text-gray-700">
                Cambiar el mínimo
                <select className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                  <option value="porcentaje">Porcentaje del total</option>
                  <option value="importe">Importe ({moneda})</option>
                  <option value="total">Total (100 %)</option>
                </select>
              </label>
              <label className="text-xs font-medium text-gray-700">
                {tipo === "porcentaje" ? "Porcentaje" : "Importe"}
                <input
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100" inputMode="decimal"
                  disabled={tipo === "total"} value={tipo === "total" ? "" : valor} onChange={(e) => setValor(e.target.value)} placeholder={tipo === "porcentaje" ? "30" : "500.000"}
                />
              </label>
              <label className="text-xs font-medium text-gray-700">
                Nota (opcional)
                <input className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="p. ej. acuerdo con el hotel" />
              </label>
              <Button type="submit" size="sm" disabled={pending || (tipo !== "total" && !valor.trim())}>{pending ? "Guardando…" : "Guardar mínimo"}</Button>
            </form>
          )}
          {msg && <p role="status" className={`mt-2 text-xs ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.texto}</p>}
        </div>
      </div>
    </section>
  );
}
