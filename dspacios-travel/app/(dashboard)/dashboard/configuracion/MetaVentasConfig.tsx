"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { guardarMetaVentas } from "./actions";

type Fila = { periodo: string; moneda: string; valor: number; actualizado_por: string | null };

// Meta GENERAL mensual de la agencia — la referencia comercial persistida
// para alcanzar el punto de equilibrio, que el Dashboard compara contra las
// ventas reales del mes. Tres cosas que NO es, a propósito:
//   1) NO es la suma de las cuotas individuales `asesores.meta_mensual`
//      (otro concepto, usado en el cálculo de comisiones por asesor).
//   2) NO reemplaza ni modifica el cálculo dinámico de "Punto de equilibrio"
//      (`pe_empleados`/`pe_costos`, módulo aparte) — ese sigue siendo un
//      breakeven recalculado en caliente cada vez que se abre esa pantalla.
//      Esta meta es un número congelado que alguien decide y guarda a mano;
//      puede coincidir con ese cálculo o no, son dos datos técnicos
//      DISTINTOS (uno vive en esta tabla, el otro nunca se persiste).
//   3) NO se muestra en el Dashboard como si fuera el mismo dato que el
//      punto de equilibrio dinámico — el Dashboard solo conoce y compara
//      esta meta persistida.
// Una fila por mes/moneda; guardar sobre un mes ya configurado lo actualiza
// (mismo periodo = mismo registro, por la unicidad de la tabla).
export function MetaVentasConfig({ historial }: { historial: Fila[] }) {
  const hoy = new Date();
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  const metaActual = historial.find((f) => f.periodo === periodoActual && f.moneda === "COP");

  const [periodo, setPeriodo] = useState(periodoActual);
  const [valor, setValor] = useState(metaActual ? String(Math.round(metaActual.valor)) : "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await guardarMetaVentas({ periodo, valor: Number(valor) || 0 });
      setMsg(r.ok ? "✓ Guardado" : r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">Meta general del mes</h2>
      <p className="mt-1 mb-4 text-xs text-gray-500">
        Referencia mensual de punto de equilibrio. Es la meta de LA AGENCIA — no la suma de las metas individuales de los asesores, ni el mismo dato que el cálculo dinámico del módulo Punto de equilibrio (ese se recalcula en caliente; esta meta queda guardada tal como se ingresa).
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-700">
          Mes
          <DateInput aria-label="Periodo" type="month" className="mt-1 w-40" value={periodo} onValueChange={(dateValue) => setPeriodo(dateValue)} />
        </label>
        <label className="text-sm text-gray-700">
          Meta general (COP)
          <Input type="number" className="mt-1 w-40" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" />
        </label>
        <Button variant="outline" className="mt-6" onClick={guardar} disabled={pending || !periodo || Number(valor) <= 0}>
          Guardar
        </Button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}

      {historial.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="mb-2 text-xs font-medium text-gray-500">Últimas metas configuradas</p>
          <ul className="space-y-1 text-sm text-gray-600">
            {historial.slice(0, 6).map((f) => (
              <li key={`${f.periodo}-${f.moneda}`} className="flex justify-between gap-2">
                <span>{f.periodo} ({f.moneda})</span>
                <span className="tabular-nums">{f.moneda === "COP" ? formatCOP(f.valor) : f.valor.toLocaleString("es-CO")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
