"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validarReglaDescuento } from "@/lib/hoteles/reglasDescuento";
import { guardarReglaDescuento, alternarReglaDescuento, eliminarReglaDescuento, aplicarReglaRetenida, descartarReglaRetenida, type PendienteCombinacion } from "./reglas-descuento-actions";
import { guardarCombinacionPromocion, activarCambioPromocion, descartarCambioPromocion } from "../actions";
import { CombinacionEditor } from "./CombinacionPromo";
import { ETIQUETA_ALTERNATIVA, textoFamilias, type CombinacionEntrada, type FamiliaRegla } from "@/lib/hoteles/promocionesVigencia";

export type ReglaFila = { id: number; tipo: "ebb" | "long_stay"; umbral: number; pct: number; activa: boolean; autorizada?: boolean; propuesta?: { umbral: number; pct: number; activa: boolean } | null };
/** Entrega 5 (`promociones_combinacion_estado`): por promoción, qué reglas pueden coincidir (con las autorizadas y con las retenidas) y su combinación. */
export type EstadoCombinacion = {
  promocion_id: number; nombre: string; requeridas: FamiliaRegla[]; requeridas_con_retenidas: FamiliaRegla[];
  combinacion: { estado: "heredada" | "configurada" | "pendiente"; alternativas: FamiliaRegla[]; acumulable_ebb: boolean | null; acumulable_long_stay: boolean | null; orden: ("promocion" | FamiliaRegla)[] | null } | null;
  /** P3: cambio de la promoción guardado y retenido (no se vende hasta activarlo). `desactualizado`: la promoción cambió después. */
  cambio_pendiente?: { cambios: Record<string, unknown>; faltan: FamiliaRegla[]; propuesto_en: string; desactualizado: boolean } | null;
};

/** Lo esencial del cambio pendiente, en palabras (las columnas que la ficha deja editar). */
function resumenCambio(c: Record<string, unknown>): string {
  const v = (k: string) => (c[k] == null || c[k] === "" ? null : String(c[k]));
  return [
    v("nombre") && `nombre «${v("nombre")}»`,
    v("fecha_inicio") && `viaje ${v("fecha_inicio")} a ${v("fecha_fin") ?? "—"}`,
    (v("compra_inicio") || v("compra_fin")) && `compra ${v("compra_inicio") ?? "—"} a ${v("compra_fin") ?? "—"}`,
    v("descuento_valor") && `descuento ${v("descuento_valor")}`,
    v("regimen_restringido") && `régimen ${v("regimen_restringido")}`,
  ].filter(Boolean).join(" · ");
}

const resueltas = (e: EstadoCombinacion) => (e.combinacion && e.combinacion.estado !== "pendiente" ? e.combinacion.alternativas : []);
const faltan = (e: EstadoCombinacion) => e.requeridas_con_retenidas.filter((f) => !resueltas(e).includes(f));
function resumenCombinacion(e: EstadoCombinacion): string {
  const c = e.combinacion;
  if (!c) return "";
  if (c.estado === "pendiente") return `Pendiente: no se vende hasta configurar con ${textoFamilias(c.alternativas)}.`;
  if (c.estado === "heredada") return `Como hasta hoy con ${textoFamilias(c.alternativas)}: la promoción y la regla de mayor % se aplican juntas.`;
  const acum = c.alternativas.map((f) => `${ETIQUETA_ALTERNATIVA[f]}: ${(f === "ebb" ? c.acumulable_ebb : c.acumulable_long_stay) ? "acumula" : "no acumula"}`).join(" · ");
  return c.orden?.length ? `${acum} · Orden: ${c.orden.map((x) => ETIQUETA_ALTERNATIVA[x]).join(" → ")}` : acum;
}

const TITULO = { ebb: "EBB (reserva anticipada)", long_stay: "Long Stay (estancia larga)" } as const;
const CAMPO = { ebb: "Días mínimos antes del check-in", long_stay: "Noches mínimas" } as const;
const resumen = (r: ReglaFila) => (r.tipo === "ebb" ? `${r.umbral} días o más antes del check-in` : `${r.umbral} noches o más`);

// errorCarga: la consulta falló (distinto de "sin reglas"): no se afirma que no hay reglas ni se deja administrar a ciegas.
export function HotelPromociones({ hotelId, reglas, errorCarga = false, combinaciones = [], errorCombinaciones = false }: { hotelId: number; reglas: ReglaFila[]; errorCarga?: boolean; combinaciones?: EstadoCombinacion[]; errorCombinaciones?: boolean }) {
  const router = useRouter();
  const [editId, setEditId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<"ebb" | "long_stay">("ebb");
  const [umbral, setUmbral] = useState("");
  const [pct, setPct] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [retenida, setRetenida] = useState<PendienteCombinacion[] | null>(null);
  const [configurando, setConfigurando] = useState<number | null>(null);
  const [activando, setActivando] = useState<number | null>(null);

  function limpiar() { setEditId(null); setUmbral(""); setPct(""); setErr(""); }
  function correr(f: () => Promise<{ ok: true; retenida?: PendienteCombinacion[] } | { ok: false; error: string }>, despues?: () => void) {
    setErr(""); setRetenida(null);
    start(async () => { const r = await f(); if (r.ok) { if (r.retenida) setRetenida(r.retenida); despues?.(); router.refresh(); } else setErr(r.error); });
  }
  function guardarCombinacion(id: number, c: CombinacionEntrada) {
    correr(() => guardarCombinacionPromocion(id, c), () => setConfigurando(null));
  }
  const conCoincidencias = combinaciones.filter((e) => e.requeridas_con_retenidas.length > 0 || e.combinacion || e.cambio_pendiente);
  function guardar() {
    const v = validarReglaDescuento({ tipo, umbral, pct });
    if (!v.ok) { setErr(v.error); return; }
    correr(() => guardarReglaDescuento({ hotelId, id: editId ?? undefined, tipo, umbral, pct }), limpiar);
  }
  function editar(r: ReglaFila) { setEditId(r.id); setTipo(r.tipo); setUmbral(String(r.umbral)); setPct(String(r.pct)); setErr(""); }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4" aria-label="Promociones">
      <h2 className="text-sm font-semibold text-gray-700">Promociones</h2>
      <p className="mb-3 mt-1 text-xs text-gray-500">
        Descuento sobre la neta del hotel, antes del markup. Si se cumplen varias, aplica solo la de mayor porcentaje (nunca se suman). No cambia las netas ni las temporadas.
      </p>

      {errorCarga ? (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          No se pudieron cargar las promociones de este hotel. La administración de reglas está deshabilitada para no editar a ciegas.
          <button type="button" onClick={() => router.refresh()} className="ml-2 font-medium underline">Reintentar</button>
        </div>
      ) : (["ebb", "long_stay"] as const).map((t) => {
        const filas = reglas.filter((r) => r.tipo === t).sort((a, b) => a.umbral - b.umbral);
        return (
          <div key={t} className="mb-3">
            <p className="mb-1 text-xs font-medium text-gray-600">{TITULO[t]}</p>
            {filas.length === 0 ? <p className="text-xs text-gray-400">Sin reglas.</p> : (
              <ul className="divide-y divide-gray-100">
                {filas.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className={r.activa ? "text-gray-700" : "text-gray-400"}>
                      {resumen(r)} → <b>{r.pct} %</b>{!r.activa && <span className="ml-2 text-xs">(inactiva)</span>}
                      {r.autorizada === false && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">Retenida: no se vende hasta configurar las promociones que coinciden</span>}
                      {r.propuesta && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">Cambio retenido: {r.tipo === "ebb" ? `${r.propuesta.umbral} días` : `${r.propuesta.umbral} noches`} → {r.propuesta.pct} %{r.propuesta.activa ? "" : " (inactiva)"}. Se sigue vendiendo la versión actual.</span>}
                    </span>
                    <span className="flex gap-3 text-xs">
                      {(r.autorizada === false || r.propuesta) && <>
                        <button type="button" disabled={pending} onClick={() => correr(() => aplicarReglaRetenida(r.id, hotelId))} className="text-gray-500 hover:text-gray-800">Aplicar</button>
                        <button type="button" disabled={pending} onClick={() => correr(() => descartarReglaRetenida(r.id, hotelId))} className="text-gray-500 hover:text-gray-800">Descartar cambio</button>
                      </>}
                      <button type="button" disabled={pending} onClick={() => correr(() => alternarReglaDescuento(r.id, hotelId, !r.activa))} className="text-gray-500 hover:text-gray-800">{r.activa ? "Desactivar" : "Activar"}</button>
                      <button type="button" disabled={pending} onClick={() => editar(r)} className="text-gray-500 hover:text-gray-800">Editar</button>
                      <button type="button" disabled={pending} onClick={() => { if (window.confirm("¿Eliminar esta promoción?")) correr(() => eliminarReglaDescuento(r.id, hotelId), () => { if (editId === r.id) limpiar(); }); }} className="text-gray-400 hover:text-red-500">Eliminar</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <fieldset disabled={errorCarga} className="flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3 disabled:opacity-50">
        <div>
          <label className="mb-1 block text-xs text-gray-600">Tipo</label>
          <select aria-label="Tipo de promoción" value={tipo} onChange={(e) => setTipo(e.target.value as "ebb" | "long_stay")} disabled={editId != null} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm">
            <option value="ebb">EBB</option>
            <option value="long_stay">Long Stay</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600">{CAMPO[tipo]}</label>
          <Input aria-label={CAMPO[tipo]} inputMode="numeric" className="w-28" value={umbral} onChange={(e) => setUmbral(e.target.value)} placeholder={tipo === "ebb" ? "30" : "4"} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600">Porcentaje de descuento</label>
          <Input aria-label="Porcentaje de descuento" inputMode="decimal" className="w-24" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="18" />
        </div>
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : editId != null ? "Guardar cambios" : "Agregar promoción"}</Button>
        {editId != null && <button type="button" onClick={limpiar} className="pb-2 text-xs text-gray-500">Cancelar</button>}
      </fieldset>
      {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      {retenida && (
        <div role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          El cambio quedó retenido: crea combinaciones sin configurar. La versión anterior sigue vendiéndose. Falta configurar:{" "}
          {retenida.map((p) => `«${p.promocion}» con ${textoFamilias(p.faltan)}`).join("; ")}. Configúralas abajo y luego «Aplicar».
        </div>
      )}

      {errorCombinaciones && (
        <p role="alert" className="mt-3 text-xs text-red-600">No se pudo cargar cómo combinan las promociones especiales con EBB / Long Stay. Recarga antes de configurarlas.</p>
      )}
      {!errorCombinaciones && conCoincidencias.length > 0 && (
        <div className="mt-4" aria-label="Promociones frente a EBB / Long Stay">
          <p className="text-xs font-medium text-gray-600">Promociones especiales frente a EBB / Long Stay</p>
          <p className="mb-1 text-xs text-gray-500">Solo EBB y Long Stay: gana el mayor %, no se suman. Con una promoción especial rige lo que diga el proveedor, configurado aquí.</p>
          <ul className="divide-y divide-gray-100">
            {conCoincidencias.map((e) => (
              <li key={e.promocion_id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>{e.nombre}</b> <span className="text-xs text-gray-500">{resumenCombinacion(e)}</span>
                    {faltan(e).length > 0 && e.combinacion?.estado !== "pendiente" && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">Falta configurar con {textoFamilias(faltan(e))}</span>}
                  </span>
                  {e.requeridas_con_retenidas.length > 0 && <button type="button" disabled={pending} onClick={() => setConfigurando(e.promocion_id)} className="text-xs text-gray-500 hover:text-gray-800">Configurar</button>}
                </div>
                {e.cambio_pendiente && (
                  <div role="status" data-testid={`cambio-pendiente-${e.promocion_id}`} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    <p><b>Cambio pendiente de activar</b> ({new Date(e.cambio_pendiente.propuesto_en).toLocaleString("es-CO")}): {resumenCambio(e.cambio_pendiente.cambios)}.
                      {" "}Falta configurar con {textoFamilias(e.cambio_pendiente.faltan)}. Se sigue vendiendo la versión autorizada.</p>
                    {e.cambio_pendiente.desactualizado && <p className="mt-1 font-medium">La promoción cambió después de dejar este cambio pendiente: no se puede activar; descártalo y vuelve a hacerlo sobre la versión actual.</p>}
                    <span className="mt-1 flex gap-3">
                      {!e.cambio_pendiente.desactualizado && <button type="button" disabled={pending} onClick={() => setActivando(e.promocion_id)} className="font-medium hover:underline">Configurar y activar</button>}
                      <button type="button" disabled={pending} onClick={() => correr(() => descartarCambioPromocion(e.promocion_id))} className="hover:underline">Descartar cambio</button>
                    </span>
                    {activando === e.promocion_id && (
                      <CombinacionEditor promocion={e.nombre} familias={[...new Set([...resueltas(e), ...e.cambio_pendiente.faltan])]} pendiente={pending}
                        inicial={e.combinacion?.estado === "configurada" ? { acumulable: { ebb: e.combinacion.acumulable_ebb, long_stay: e.combinacion.acumulable_long_stay }, orden: e.combinacion.orden } : null}
                        onGuardar={(c) => correr(() => activarCambioPromocion(e.promocion_id, c), () => setActivando(null))} onCancelar={() => setActivando(null)} />
                    )}
                  </div>
                )}
                {configurando === e.promocion_id && (
                  <CombinacionEditor promocion={e.nombre} familias={e.requeridas_con_retenidas} pendiente={pending}
                    inicial={e.combinacion?.estado === "configurada" ? { acumulable: { ebb: e.combinacion.acumulable_ebb, long_stay: e.combinacion.acumulable_long_stay }, orden: e.combinacion.orden } : null}
                    onGuardar={(c) => guardarCombinacion(e.promocion_id, c)} onCancelar={() => setConfigurando(null)} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
