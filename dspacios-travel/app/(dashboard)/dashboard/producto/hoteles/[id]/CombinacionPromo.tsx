"use client";

// #43/#60 entrega 5 — Combinación de una promoción con EBB / Long Stay, según el proveedor. Sin valores por defecto: cada regla que
// coincide se responde «acumula» o «no acumula», y si algo no acumula se ordenan explícitamente las alternativas (gana la primera que
// la reserva cumpla; las siguientes solo si acumulan con las ya incluidas). EBB y Long Stay nunca acumulan entre sí.
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ETIQUETA_ALTERNATIVA, requiereOrden, textoFamilias, validarCombinacion,
  type AlternativaOrden, type CombinacionEntrada, type FamiliaRegla,
} from "@/lib/hoteles/promocionesVigencia";

export function CombinacionEditor({ promocion, familias, inicial, onGuardar, onCancelar, pendiente }: {
  promocion: string;
  familias: FamiliaRegla[];
  inicial?: CombinacionEntrada | null;
  onGuardar: (c: CombinacionEntrada) => void;
  onCancelar: () => void;
  pendiente?: boolean;
}) {
  const [acum, setAcum] = useState<CombinacionEntrada["acumulable"]>(() => ({ ...(inicial?.acumulable ?? {}) }));
  const [orden, setOrden] = useState<AlternativaOrden[]>(() => {
    const base: AlternativaOrden[] = inicial?.orden?.length ? inicial.orden.filter((x) => x === "promocion" || familias.includes(x as FamiliaRegla)) : [];
    return base.length === familias.length + 1 ? base : [];
  });
  const [err, setErr] = useState("");
  const necesitaOrden = requiereOrden(familias, acum);
  const sinOrdenar: AlternativaOrden[] = (["promocion", ...familias] as AlternativaOrden[]).filter((x) => !orden.includes(x));
  const mover = (i: number, d: -1 | 1) => setOrden((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });

  function guardar() {
    const v = validarCombinacion({ acumulable: acum, orden: necesitaOrden ? orden : null }, familias);
    if (!v.ok) { setErr(v.error); return; }
    setErr("");
    onGuardar({ acumulable: v.valor.acumulable, orden: v.valor.orden });
  }

  return (
    <div role="group" aria-label={`Combinación de ${promocion}`} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="text-xs text-amber-900">
        «{promocion}» puede coincidir con {textoFamilias(familias)}. Responde según el proveedor. Mientras no se responda, la versión que hoy se vende no cambia.
      </p>
      {familias.map((f) => (
        <fieldset key={f} className="mt-2">
          <legend className="text-xs font-medium text-gray-700">¿Acumula con {ETIQUETA_ALTERNATIVA[f].toLowerCase()}?</legend>
          <label className="mr-4 text-xs"><input type="radio" name={`acum-${f}`} checked={acum[f] === true} onChange={() => setAcum((a) => ({ ...a, [f]: true }))} /> Sí, se suman</label>
          <label className="text-xs"><input type="radio" name={`acum-${f}`} checked={acum[f] === false} onChange={() => setAcum((a) => ({ ...a, [f]: false }))} /> No acumula</label>
        </fieldset>
      ))}
      {necesitaOrden && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-700">Orden según el proveedor (gana la primera que la reserva cumpla)</p>
          <ol className="mt-1 space-y-1">
            {orden.map((x, i) => (
              <li key={x} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-gray-500">{i + 1}.</span>
                <span className="flex-1">{ETIQUETA_ALTERNATIVA[x]}</span>
                <button type="button" aria-label={`Subir ${ETIQUETA_ALTERNATIVA[x]}`} onClick={() => mover(i, -1)} disabled={i === 0}><ArrowUp size={14} /></button>
                <button type="button" aria-label={`Bajar ${ETIQUETA_ALTERNATIVA[x]}`} onClick={() => mover(i, 1)} disabled={i === orden.length - 1}><ArrowDown size={14} /></button>
                <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => setOrden((o) => o.filter((y) => y !== x))}>Quitar</button>
              </li>
            ))}
          </ol>
          {sinOrdenar.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-2 text-xs">
              <span className="text-gray-500">Agregar en el siguiente lugar:</span>
              {sinOrdenar.map((x) => <button key={x} type="button" className="underline" onClick={() => setOrden((o) => [...o, x])}>{ETIQUETA_ALTERNATIVA[x]}</button>)}
            </p>
          )}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button onClick={guardar} disabled={pendiente} style={{ backgroundColor: "var(--brand-primary)" }}>{pendiente ? "…" : "Guardar combinación"}</Button>
        <button type="button" onClick={onCancelar} className="text-xs text-gray-500">Cancelar</button>
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}
