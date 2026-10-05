"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import {
  generarTarifasDubai, validarDubaiParams, type DubaiParams, type DubaiPromo, type DubaiBase, type DubaiSuplementoRegimen,
  analizarMixta, filaSustitucionMixta, aplicarAdultsOnly, valoresDeFila, CAMPOS_VALOR_TARIFA, fotoTarifas,
  type MixtaParams, type MixtaAcom, MIXTA_ACOMS, type CalcTipo, type TarifaGenerada, type TarifaExistente, type BloqueoPromoMixta,
  generarTarifasCorporativa, type CorporativaParams,
} from "@/lib/calc/calculadoras";
import {
  CAMPOS_MIXTA, claveMixta, valoresPorRegimenIniciales, basesDesdeValores, basesPorRegimen, quitarValoresCelda,
  type CampoMixta, type ValoresPorRegimen,
} from "@/lib/calc/mixtaValores";
import { separarFilasVencidas } from "@/lib/calc/promoCalculadora";
import type { TemporadaRango } from "@/lib/calc/paquetes";
import { REGLA_EDAD_DEFAULT, construirReglaEdadDesdeMaximos } from "@/lib/calc/reglaEdadTarifa";
import { PAX_TARIFA_DEFAULT } from "@/lib/acomodaciones";
import { guardarCalculadora, generarTarifasCalculadora, sustituirPromoManualMixta } from "../actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

const CONFIRMAR_REEMPLAZO =
  "¿Reemplazar todas las tarifas VIGENTES de este hotel (todos los regímenes) por las generadas ahora? " +
  "Las de vigencias con compra cerrada se conservan y cada fila reemplazada queda en el historial interno.";

function mensajeGeneracion(
  g: Awaited<ReturnType<typeof generarTarifasCalculadora>>,
  modo: "agregar" | "reemplazar",
): string {
  if (!g.ok) return g.error;
  const base = `✓ Generadas ${g.generadas} tarifas (${modo === "reemplazar" ? "reemplazaron las vigentes" : "agregadas/actualizadas solo en sus temporadas"}).`;
  const partes = [base];
  if (g.vencidasConservadas.length > 0) partes.push(`Sin tocar por compra cerrada: ${g.vencidasConservadas.join(", ")}.`);
  if (g.promosManualesIntactas.length > 0) partes.push(`Promociones escritas a mano sin tocar: ${g.promosManualesIntactas.join("; ")}.`);
  return partes.join(" ");
}

export function CalculadoraEditor({
  hotelId, categorias, temporadas, regimenes, tipoInicial, dubaiInicial, mixtaInicial, corporativaInicial, adultsOnly = false,
  vigencias, hoy, tarifasExistentes,
}: {
  hotelId: number;
  categorias: string[];
  temporadas: string[];
  regimenes: string[];
  tipoInicial: CalcTipo | null;
  dubaiInicial: DubaiParams | null;
  mixtaInicial: MixtaParams | null;
  corporativaInicial: CorporativaParams | null;
  adultsOnly?: boolean;
  // Vigencias del hotel (`hotel_temporadas`) y hoy (Bogotá): para derivar
  // promociones y no regenerar vigencias con compra cerrada.
  vigencias: TemporadaRango[];
  hoy: string;
  // Filas actuales de `tarifa_hotel`: una promo escrita a mano no se pisa.
  tarifasExistentes: TarifaExistente[];
}) {
  const [open, setOpen] = useState(false);
  const [tipoCalc, setTipoCalc] = useState<CalcTipo>(tipoInicial ?? "dubai");

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">
          Tarifa por fórmula (calculadora)
          {tipoInicial && <span className="ml-2 rounded-full bg-[var(--brand-success)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--brand-success)]">configurada: {tipoInicial}</span>}
        </span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Tipo de calculadora:</span>
            <select value={tipoCalc} onChange={(e) => setTipoCalc(e.target.value as CalcTipo)} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm">
              <option value="dubai">Dubai (base + modificadores)</option>
              <option value="mixta">Mixta (por hab/pax + IVA)</option>
              <option value="corporativa">Corporativa (tarifa por habitación + suplementos)</option>
            </select>
          </div>
          {tipoCalc === "dubai" && <DubaiForm hotelId={hotelId} categorias={categorias} temporadas={temporadas} regimenes={regimenes} inicial={dubaiInicial} adultsOnly={adultsOnly} tarifasExistentes={tarifasExistentes} />}
          {tipoCalc === "mixta" && <MixtaForm hotelId={hotelId} categorias={categorias} temporadas={temporadas} regimenes={regimenes} inicial={mixtaInicial} adultsOnly={adultsOnly} vigencias={vigencias} hoy={hoy} tarifasExistentes={tarifasExistentes} />}
          {tipoCalc === "corporativa" && <CorporativaForm hotelId={hotelId} categorias={categorias} temporadas={temporadas} regimenes={regimenes} inicial={corporativaInicial} adultsOnly={adultsOnly} tarifasExistentes={tarifasExistentes} />}
        </div>
      )}
    </section>
  );
}

// ── Formulario DUBAI ────────────────────────────────────────────────────
function DubaiForm({
  hotelId, categorias, temporadas, regimenes, inicial, adultsOnly, tarifasExistentes,
}: { hotelId: number; categorias: string[]; temporadas: string[]; regimenes: string[]; inicial: DubaiParams | null; adultsOnly: boolean; tarifasExistentes: TarifaExistente[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const [sencillaPct, setSencillaPct] = useState(String(inicial?.modificadores?.sencilla_pct ?? 50));
  const [pax3Pct, setPax3Pct] = useState(String(inicial?.modificadores?.pax3_pct ?? -20));
  const [pax4Pct, setPax4Pct] = useState(String(inicial?.modificadores?.pax4_pct ?? -20));
  const [ninoPct, setNinoPct] = useState(String(inicial?.modificadores?.nino_pct ?? -50));
  // Niño 2 (segundo menor de la MISMA habitación) — opcional. Vacío = como
  // siempre, `neto_nino2` sale `null` (ningún dato histórico se ve afectado).
  const [nino2Pct, setNino2Pct] = useState(inicial?.modificadores?.nino2_pct != null ? String(inicial.modificadores.nino2_pct) : "");
  const [infantePct, setInfantePct] = useState(String(inicial?.modificadores?.infante_pct ?? -100));
  const [infanteNota, setInfanteNota] = useState(inicial?.infante_nota ?? "");

  const [regimenBase, setRegimenBase] = useState(inicial?.regimen_base ?? regimenes[0] ?? "PC");
  const supInicial: Record<string, string> = {};
  for (const s of inicial?.suplementos ?? []) supInicial[s.regimen] = String(s.monto);
  const [suplementos, setSuplementos] = useState<Record<string, string>>(supInicial);

  const baseInicial: Record<string, string> = {};
  // Config propia (edades/suplementos) de cada BASE — keyed igual que el
  // precio (`categoria|temporada`), así el índice con el que se construye
  // `params.bases` (más abajo, `basesList`) coincide SIEMPRE con el que
  // devuelve `validarDubaiParams` (`origen:"base", indice`) — nunca hay que
  // adivinar cuál fila del arreglo le corresponde a cuál celda de la UI.
  const basesExtraInicial: Record<string, Partial<DubaiBase>> = {};
  for (const b of inicial?.bases ?? []) {
    baseInicial[`${b.categoria}|${b.temporada}`] = String(b.precio);
    basesExtraInicial[`${b.categoria}|${b.temporada}`] = {
      usarEdadesPropias: b.usarEdadesPropias, edadesPropias: b.edadesPropias,
      usarSuplementosPropios: b.usarSuplementosPropios, suplementosPropios: b.suplementosPropios,
      condicionesPropias: b.condicionesPropias,
    };
  }
  const [bases, setBases] = useState<Record<string, string>>(baseInicial);
  const [basesExtra, setBasesExtra] = useState<Record<string, Partial<DubaiBase>>>(basesExtraInicial);

  const [promos, setPromos] = useState<DubaiPromo[]>(inicial?.promos ?? []);

  const setSup = (r: string, v: string) => setSuplementos((s) => ({ ...s, [r]: v }));
  const setBase = (c: string, t: string, v: string) => setBases((s) => ({ ...s, [`${c}|${t}`]: v }));
  function setBaseExtra(clave: string, patch: Partial<DubaiBase>) {
    setBasesExtra((s) => ({ ...s, [clave]: { ...s[clave], ...patch } }));
  }
  // Solo `infanteMax`/`ninoMax` son editables — `infanteMin` (siempre 0) y
  // `ninoMin` (siempre `infanteMax + 1`) son valores DERIVADOS, nunca los
  // escribe el operador (mismo contrato que el CHECK SQL de la migración 177
  // y `validarRangoReglaEdad`). `construirReglaEdadDesdeMaximos` es la ÚNICA
  // fuente de esta derivación — el objeto que termina en `DubaiParams` sale
  // siempre completo y consistente, sin importar qué mínimos traía cargado
  // un registro histórico.
  function setBaseEdad(clave: string, campo: "infanteMax" | "ninoMax", valor: string) {
    setBasesExtra((s) => {
      const actual = s[clave]?.edadesPropias ?? REGLA_EDAD_DEFAULT;
      const num = Number(valor) || 0;
      const nueva = campo === "infanteMax"
        ? construirReglaEdadDesdeMaximos(num, actual.ninoMax)
        : construirReglaEdadDesdeMaximos(actual.infanteMax, num);
      return { ...s, [clave]: { ...s[clave], edadesPropias: nueva } };
    });
  }
  // Suplementos PROPIOS de una BASE — reemplazan COMPLETO el general
  // (`suplementos[]`) para los regímenes que esa base genera (nunca el
  // régimen base: ver `suplementoEfectivoBase` en `lib/calc/calculadoras.ts`,
  // que además fuerza 0 en el régimen base sin importar lo que se cargue acá).
  function setBaseSuplementoPropio(clave: string, regimen: string, monto: string) {
    setBasesExtra((s) => {
      const actuales = s[clave]?.suplementosPropios ?? [];
      const sinEseRegimen = actuales.filter((x) => x.regimen !== regimen);
      const propios: DubaiSuplementoRegimen[] = [...sinEseRegimen, { regimen, monto: Number(monto) || 0 }];
      return { ...s, [clave]: { ...s[clave], suplementosPropios: propios } };
    });
  }

  // `basesList` es la ÚNICA fuente de `DubaiBase[]` — se usa TAL CUAL para
  // `params.bases` y para renderizar la sección "Edades/suplementos propios
  // por base" (mismo orden, mismo índice en ambos lados).
  const basesList = useMemo<DubaiBase[]>(
    () =>
      categorias
        .flatMap((c) =>
          temporadas.map((t) => {
            const clave = `${c}|${t}`;
            const precio = Number(bases[clave]) || 0;
            return { categoria: c, temporada: t, precio, ...(basesExtra[clave] ?? {}) };
          })
        )
        .filter((b) => b.precio > 0),
    [categorias, temporadas, bases, basesExtra]
  );

  function agregarPromo() {
    setPromos((ps) => [...ps, { temporadaBase: temporadas[0] ?? "", temporadaPromo: "", regimen: regimenBase, descuentoPct: 10 }]);
  }
  function editarPromo(i: number, patch: Partial<DubaiPromo>) {
    setPromos((ps) => ps.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  }
  function quitarPromo(i: number) {
    setPromos((ps) => ps.filter((_, n) => n !== i));
  }
  // Mismo criterio que `setBaseEdad`: solo `infanteMax`/`ninoMax` editables,
  // `infanteMin`/`ninoMin` siempre derivados.
  function setPromoEdad(i: number, campo: "infanteMax" | "ninoMax", valor: string) {
    setPromos((ps) => ps.map((p, n) => {
      if (n !== i) return p;
      const actual = p.edadesPropias ?? REGLA_EDAD_DEFAULT;
      const num = Number(valor) || 0;
      const nueva = campo === "infanteMax"
        ? construirReglaEdadDesdeMaximos(num, actual.ninoMax)
        : construirReglaEdadDesdeMaximos(actual.infanteMax, num);
      return { ...p, edadesPropias: nueva };
    }));
  }

  const params = useMemo<DubaiParams>(() => ({
    regimen_base: regimenBase,
    modificadores: {
      sencilla_pct: Number(sencillaPct) || 0,
      pax3_pct: Number(pax3Pct) || 0,
      pax4_pct: Number(pax4Pct) || 0,
      nino_pct: Number(ninoPct) || 0,
      ...(nino2Pct.trim() !== "" ? { nino2_pct: Number(nino2Pct) || 0 } : {}),
      infante_pct: Number(infantePct) || 0,
    },
    suplementos: regimenes.filter((r) => r !== regimenBase).map((r) => ({ regimen: r, monto: Number(suplementos[r]) || 0 })),
    bases: basesList,
    promos,
    infante_nota: infanteNota,
  }), [regimenBase, sencillaPct, pax3Pct, pax4Pct, ninoPct, nino2Pct, infantePct, infanteNota, suplementos, basesList, regimenes, promos]);

  // Validación EN VIVO (preview) — la misma función pura que revalida el
  // servidor al guardar (`guardarCalculadora` → `validarDubaiParams`); acá
  // solo se usa para mostrar el error ANTES de intentar guardar, nunca como
  // autoridad (el servidor vuelve a validar siempre).
  const erroresValidacion = useMemo(() => validarDubaiParams(params), [params]);
  const erroresDeBase = (indice: number) => erroresValidacion.filter((e) => e.origen === "base" && e.indice === indice);
  const erroresDePromo = (indice: number) => erroresValidacion.filter((e) => e.origen === "promo" && e.indice === indice);

  const preview = useMemo(() => generarTarifasDubai(params).filter((f) => f.alimentacion === regimenBase), [params, regimenBase]);
  // Vista previa de promos: se muestran aparte porque pueden ser de OTRO régimen.
  const previewPromos = useMemo(() => {
    const nombresPromo = new Set(promos.map((p) => p.temporadaPromo?.trim()).filter(Boolean));
    return generarTarifasDubai(params).filter((f) => nombresPromo.has(f.temporada));
  }, [params, promos]);

  function guardar(modo: "solo" | "agregar" | "reemplazar") {
    if (modo === "reemplazar" && !confirm(CONFIRMAR_REEMPLAZO)) return;
    // Fail-closed en el cliente (misma validación pura) para no esperar al
    // servidor con un config que ya se sabe inválido — el servidor
    // (`guardarCalculadora`) SIEMPRE vuelve a validar, nunca confía en esto.
    if (erroresValidacion.length > 0) { setMsg(erroresValidacion.map((e) => e.mensaje).join(" ")); return; }
    setMsg("");
    start(async () => {
      const r = await guardarCalculadora(hotelId, "dubai", params);
      if (!r.ok) { setMsg(r.error); return; }
      if (modo === "solo") { setMsg("✓ Calculadora guardada."); router.refresh(); return; }
      const g = await generarTarifasCalculadora(hotelId, modo, fotoTarifas(tarifasExistentes));
      setMsg(mensajeGeneracion(g, modo));
      router.refresh();
    });
  }

  if (categorias.length === 0 || temporadas.length === 0) {
    return <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Primero define las <b>categorías</b> del hotel y sus <b>temporadas</b> (con fechas) más abajo. Luego vuelve aquí.</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">Carga una <b>base por persona/noche</b> (en doble, con el régimen base) por categoría y temporada; el sistema deriva sencilla/triple/múltiple/niño con los modificadores y suma los suplementos de régimen.</p>
      <div>
        <p className={lbl}>Modificadores (% sobre la base)</p>
        <div className={`grid grid-cols-2 gap-3 ${adultsOnly ? "sm:grid-cols-3" : "sm:grid-cols-6"}`}>
          <div><label className="text-[11px] text-gray-500">Sencilla</label><Input type="number" value={sencillaPct} onChange={(e) => setSencillaPct(e.target.value)} /></div>
          <div><label className="text-[11px] text-gray-500">3er pax</label><Input type="number" value={pax3Pct} onChange={(e) => setPax3Pct(e.target.value)} /></div>
          <div><label className="text-[11px] text-gray-500">4to pax</label><Input type="number" value={pax4Pct} onChange={(e) => setPax4Pct(e.target.value)} /></div>
          {!adultsOnly && (
            <>
              <div><label className="text-[11px] text-gray-500">Niño 1</label><Input type="number" value={ninoPct} onChange={(e) => setNinoPct(e.target.value)} /></div>
              <div>
                <label className="text-[11px] text-gray-500">Niño 2 (opcional)</label>
                <Input type="number" value={nino2Pct} onChange={(e) => setNino2Pct(e.target.value)} placeholder="sin configurar*" />
              </div>
              <div><label className="text-[11px] text-gray-500">Infante</label><Input type="number" value={infantePct} onChange={(e) => setInfantePct(e.target.value)} /></div>
            </>
          )}
        </div>
        {!adultsOnly && (
          <p className="mt-1 text-[11px] text-gray-400">
            *Sin configurar Niño 2, esa habitación no tendrá una segunda tarifa de niño disponible (comportamiento de siempre) — no significa que cobre igual que Niño 1.
          </p>
        )}
        {!adultsOnly && (
          <div className="mt-2">
            <label className="text-[11px] text-gray-500">Nota de infante (opcional, ej. &quot;Comparte cama con los padres&quot;)</label>
            <Input value={infanteNota} onChange={(e) => setInfanteNota(e.target.value)} placeholder="Nota especial para la tarifa de infante" />
          </div>
        )}
        {adultsOnly && <p className="mt-2 text-[11px] text-gray-400">Este hotel es Adults Only: no se piden modificadores de niño/infante.</p>}
      </div>
      <div>
        <p className={lbl}>Régimen</p>
        <div className="mb-2 flex items-center gap-2 text-xs text-gray-600">
          <span>Régimen base (incluido en la base):</span>
          <select value={regimenBase} onChange={(e) => setRegimenBase(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm">
            {regimenes.length === 0 && <option value="PC">PC</option>}
            {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {regimenes.filter((r) => r !== regimenBase).map((r) => (
            <div key={r}><label className="text-[11px] text-gray-500">Suplemento {r} (por pax)</label><Input type="number" value={suplementos[r] ?? ""} onChange={(e) => setSup(r, e.target.value)} placeholder="0" /></div>
          ))}
        </div>
      </div>
      <div>
        <p className={lbl}>Base por persona (doble, {regimenBase}) — por categoría y temporada</p>
        <ResponsiveTableShell minWidth={420} className="overflow-x-auto">
          <table className="min-w-[420px] border-collapse text-sm">
            <thead><tr className="text-left text-xs text-gray-400"><th className="px-2 py-1">Categoría \ Temporada</th>{temporadas.map((t) => <th key={t} className="px-2 py-1">{t}</th>)}</tr></thead>
            <tbody>
              {categorias.map((c) => (
                <tr key={c} className="border-t border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-700" data-label="Categoría">{c}</td>
                  {temporadas.map((t) => (
                    <td key={t} className="px-1 py-1" data-label={t}><Input type="number" className="w-28" value={bases[`${c}|${t}`] ?? ""} onChange={(e) => setBase(c, t, e.target.value)} placeholder="0" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableShell>
      </div>
      {!adultsOnly && basesList.length > 0 && (
        <div>
          <p className={lbl}>Edades y suplementos propios por base <span className="font-normal text-gray-400">(opcional — solo aparecen las celdas con precio cargado arriba)</span></p>
          <div className="space-y-2">
            {basesList.map((b, i) => {
              const clave = `${b.categoria}|${b.temporada}`;
              const errores = erroresDeBase(i);
              const edad = b.edadesPropias ?? REGLA_EDAD_DEFAULT;
              return (
                <div key={clave} className="rounded-lg border border-gray-100 p-2 text-xs">
                  <p className="font-medium text-gray-700">{b.categoria} / {b.temporada}</p>

                  <label className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
                    <input
                      type="checkbox"
                      checked={!!b.usarEdadesPropias}
                      onChange={(e) => setBaseExtra(clave, { usarEdadesPropias: e.target.checked })}
                    />
                    Usar edades propias (en vez de las edades generales del hotel)
                  </label>
                  {b.usarEdadesPropias && (
                    <div className="mt-1 grid grid-cols-2 gap-2 pl-5 sm:grid-cols-4">
                      {/* Infante desde/Niño desde son valores DERIVADOS (0 y
                          infanteMax+1 respectivamente) — nunca los escribe el
                          operador, ver construirReglaEdadDesdeMaximos. */}
                      <div><label className="text-[10px] text-gray-400">Infante desde</label><Input type="number" value={0} disabled className="bg-gray-50 text-gray-400" /></div>
                      <div><label className="text-[10px] text-gray-400">Infante hasta</label><Input type="number" value={edad.infanteMax} onChange={(e) => setBaseEdad(clave, "infanteMax", e.target.value)} /></div>
                      <div><label className="text-[10px] text-gray-400">Niño desde</label><Input type="number" value={edad.infanteMax + 1} disabled className="bg-gray-50 text-gray-400" /></div>
                      <div><label className="text-[10px] text-gray-400">Niño hasta</label><Input type="number" value={edad.ninoMax} onChange={(e) => setBaseEdad(clave, "ninoMax", e.target.value)} /></div>
                    </div>
                  )}

                  <label className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-600">
                    <input
                      type="checkbox"
                      checked={!!b.usarSuplementosPropios}
                      onChange={(e) => setBaseExtra(clave, { usarSuplementosPropios: e.target.checked })}
                    />
                    Usar suplementos propios (en vez de los generales de la sección Régimen)
                  </label>
                  {b.usarSuplementosPropios && (
                    <div className="mt-1 grid grid-cols-2 gap-2 pl-5 sm:grid-cols-3">
                      {regimenes.filter((r) => r !== regimenBase).map((r) => {
                        const actual = (b.suplementosPropios ?? []).find((s) => s.regimen === r);
                        return (
                          <div key={r}>
                            <label className="text-[10px] text-gray-400">Suplemento propio {r}</label>
                            <Input type="number" value={actual != null ? String(actual.monto) : ""} onChange={(e) => setBaseSuplementoPropio(clave, r, e.target.value)} placeholder="0" />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-2 pl-5">
                    <label className="text-[10px] text-gray-400">Condición de esta tarifa (opcional, texto libre)</label>
                    <Input
                      value={b.condicionesPropias ?? ""}
                      onChange={(e) => setBaseExtra(clave, { condicionesPropias: e.target.value })}
                      placeholder='Ej. "Tarifa temporada baja, sujeta a disponibilidad."'
                    />
                  </div>

                  {errores.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11px] text-red-600">
                      {errores.map((e, k) => <li key={k}>{e.mensaje}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <p className={lbl}>Promociones <span className="font-normal text-gray-400">(el descuento % se aplica sobre la tarifa completa del régimen ya resuelta, incluido el suplemento efectivo)</span></p>
        <p className="mb-2 text-[11px] text-gray-500">
          La <b>temporada promo</b> debe existir como vigencia del hotel (créala arriba en Temporadas, con su propia fecha/vigencia de compra).
          Cada promo aplica <b>solo al régimen elegido</b>, aunque el hotel tenga varios.
        </p>
        <div className="space-y-2">
          {promos.map((p, i) => {
            const errores = erroresDePromo(i);
            const edad = p.edadesPropias ?? REGLA_EDAD_DEFAULT;
            return (
              <div key={i} className="rounded-lg border border-gray-100 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={p.temporadaBase} onChange={(e) => editarPromo(i, { temporadaBase: e.target.value })} className="rounded-lg border border-gray-300 bg-white px-2 py-1">
                    {temporadas.map((t) => <option key={t} value={t}>Base: {t}</option>)}
                  </select>
                  <span className="text-gray-400">→</span>
                  <select value={p.temporadaPromo} onChange={(e) => editarPromo(i, { temporadaPromo: e.target.value })} className="rounded-lg border border-gray-300 bg-white px-2 py-1">
                    <option value="">— Elige la temporada promo —</option>
                    {temporadas.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select value={p.regimen} onChange={(e) => editarPromo(i, { regimen: e.target.value })} className="rounded-lg border border-gray-300 bg-white px-2 py-1">
                    {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <label className="flex items-center gap-1">
                    <Input type="number" min={0} max={100} className="h-7 w-20 text-xs" value={String(p.descuentoPct)} onChange={(e) => editarPromo(i, { descuentoPct: Number(e.target.value) || 0 })} />
                    %
                  </label>
                  <button type="button" onClick={() => quitarPromo(i)} className="text-gray-400 hover:text-red-500">Quitar</button>
                </div>

                {!adultsOnly && (
                  <>
                    <label className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-600">
                      <input
                        type="checkbox"
                        checked={!!p.usarEdadesPropias}
                        onChange={(e) => editarPromo(i, { usarEdadesPropias: e.target.checked })}
                      />
                      Usar edades propias (gana sobre las de su base; si no, hereda las de su base)
                    </label>
                    {p.usarEdadesPropias && (
                      <div className="mt-1 grid grid-cols-2 gap-2 pl-5 sm:grid-cols-4">
                        {/* Infante desde/Niño desde son valores DERIVADOS (0 y
                            infanteMax+1 respectivamente) — nunca los escribe
                            el operador, ver construirReglaEdadDesdeMaximos. */}
                        <div><label className="text-[10px] text-gray-400">Infante desde</label><Input type="number" value={0} disabled className="bg-gray-50 text-gray-400" /></div>
                        <div><label className="text-[10px] text-gray-400">Infante hasta</label><Input type="number" value={edad.infanteMax} onChange={(e) => setPromoEdad(i, "infanteMax", e.target.value)} /></div>
                        <div><label className="text-[10px] text-gray-400">Niño desde</label><Input type="number" value={edad.infanteMax + 1} disabled className="bg-gray-50 text-gray-400" /></div>
                        <div><label className="text-[10px] text-gray-400">Niño hasta</label><Input type="number" value={edad.ninoMax} onChange={(e) => setPromoEdad(i, "ninoMax", e.target.value)} /></div>
                      </div>
                    )}
                  </>
                )}

                <label className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-600">
                  <input
                    type="checkbox"
                    checked={!!p.usarSuplementoPropio}
                    onChange={(e) => editarPromo(i, { usarSuplementoPropio: e.target.checked })}
                  />
                  Usar suplemento propio (en vez del general de la sección Régimen)
                </label>
                {p.usarSuplementoPropio && (
                  <div className="mt-1 pl-5">
                    <label className="text-[10px] text-gray-400">Suplemento propio de {p.regimen || "(elige régimen)"}{p.regimen === regimenBase ? " — régimen base" : ""}</label>
                    <Input
                      type="number"
                      value={p.suplementoPropioMonto == null ? "" : String(p.suplementoPropioMonto)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        editarPromo(i, { suplementoPropioMonto: raw.trim() === "" ? null : Number(raw) || 0 });
                      }}
                      placeholder="vacío = incompleto; 0 = cero explícito"
                    />
                  </div>
                )}

                <div className="mt-2 pl-5">
                  <label className="text-[10px] text-gray-400">Condiciones propias de esta promoción (opcional, texto libre)</label>
                  <Input
                    value={p.condicionesPropias ?? ""}
                    onChange={(e) => editarPromo(i, { condicionesPropias: e.target.value })}
                    placeholder='Ej. "No reembolsable. No endosable. Aplica solo para reservas nuevas."'
                  />
                </div>

                {errores.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-9 text-[11px] text-red-600">
                    {errores.map((e, k) => <li key={k}>{e.mensaje}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={agregarPromo} className="mt-2 text-xs font-medium" style={{ color: "var(--brand-accent)" }}>+ Agregar promoción</button>
      </div>
      {preview.length > 0 && <PreviewTabla titulo={`Vista previa (${regimenBase})`} filas={preview} ocultarNinos={adultsOnly} />}
      {previewPromos.length > 0 && <PreviewTabla titulo="Vista previa — promociones" filas={previewPromos} ocultarNinos={adultsOnly} />}
      <BotonesGuardar pending={pending} msg={msg} onGuardar={() => guardar("solo")} onAgregar={() => guardar("agregar")} onReemplazar={() => guardar("reemplazar")} />
    </div>
  );
}

// ── Formulario MIXTA (por hab/pax + IVA) ───────────────────────────────────
type AcomCfg = Record<MixtaAcom, { modo: "hab" | "pax"; iva: boolean }>;
const ACOM_LABEL: Record<MixtaAcom, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple" };
const CAMPO_LABEL: Record<CampoMixta, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño 1", nino2: "Niño 2", infante: "Infante" };

function MixtaForm({
  hotelId, categorias, temporadas, regimenes, inicial, adultsOnly, vigencias, hoy, tarifasExistentes,
}: { hotelId: number; categorias: string[]; temporadas: string[]; regimenes: string[]; inicial: MixtaParams | null; adultsOnly: boolean; vigencias: TemporadaRango[]; hoy: string; tarifasExistentes: TarifaExistente[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const [regimen, setRegimen] = useState(inicial?.regimen ?? regimenes[0] ?? "PC");
  const [acom, setAcom] = useState<AcomCfg>(() => {
    const def: AcomCfg = {
      sencilla: { modo: "pax", iva: false }, doble: { modo: "pax", iva: false },
      triple: { modo: "pax", iva: false }, multiple: { modo: "pax", iva: false },
    };
    if (inicial?.acom) for (const a of MIXTA_ACOMS) if (inicial.acom[a]) def[a] = inicial.acom[a];
    return def;
  });
  const [ninoIva, setNinoIva] = useState(inicial?.nino?.iva ?? false);
  const [infanteNota, setInfanteNota] = useState(inicial?.infante_nota ?? "");
  const [pax, setPax] = useState<Record<MixtaAcom, string>>(() => {
    const def: Record<MixtaAcom, string> = {
      sencilla: String(inicial?.pax?.sencilla ?? PAX_TARIFA_DEFAULT.sencilla),
      doble: String(inicial?.pax?.doble ?? PAX_TARIFA_DEFAULT.doble),
      triple: String(inicial?.pax?.triple ?? PAX_TARIFA_DEFAULT.triple),
      multiple: String(inicial?.pax?.multiple ?? PAX_TARIFA_DEFAULT.multiple),
    };
    return def;
  });

  // Valores por RÉGIMEN: alternar de régimen ya no vacía lo cargado y guardar
  // conserva los demás regímenes (`bases_por_regimen`).
  const [valoresPorRegimen, setValoresPorRegimen] = useState<ValoresPorRegimen>(() => valoresPorRegimenIniciales(inicial));
  const vals = useMemo(() => valoresPorRegimen[regimen] ?? {}, [valoresPorRegimen, regimen]);
  const setVal = (c: string, t: string, campo: CampoMixta, v: string) =>
    setValoresPorRegimen((s) => ({ ...s, [regimen]: { ...(s[regimen] ?? {}), [claveMixta(c, t, campo)]: v } }));

  function cambiarRegimen(v: string) { setRegimen(v); setMsg(""); }

  const setAcomCfg = (a: MixtaAcom, patch: Partial<{ modo: "hab" | "pax"; iva: boolean }>) =>
    setAcom((s) => ({ ...s, [a]: { ...s[a], ...patch } }));

  const params = useMemo<MixtaParams>(() => ({
    regimen,
    iva_pct: 19,
    acom,
    nino: { iva: ninoIva },
    pax: { sencilla: Number(pax.sencilla) || 1, doble: Number(pax.doble) || 2, triple: Number(pax.triple) || 3, multiple: Number(pax.multiple) || 4 },
    bases: basesDesdeValores(vals, categorias, temporadas),
    bases_por_regimen: basesPorRegimen(valoresPorRegimen),
    infante_nota: infanteNota,
  }), [regimen, acom, ninoIva, pax, vals, valoresPorRegimen, categorias, temporadas, infanteNota]);

  const ctx = useMemo(() => ({ vigencias, hoy, tarifasExistentes }), [vigencias, hoy, tarifasExistentes]);
  const analisis = useMemo(() => analizarMixta(params, ctx), [params, ctx]);
  const { generables: preview, vencidas } = useMemo(() => separarFilasVencidas(analisis.filas, vigencias, hoy), [analisis, vigencias, hoy]);
  const avisosPromo = analisis.promos.filter((a) => a.estado !== "no_aplica_regimen");
  // Temporadas que son promociones % (se derivan, no se teclean).
  const promosPct = useMemo(() => new Set(vigencias.filter((v) => v.tipo === "descuento_pct").map((v) => v.nombre.trim())), [vigencias]);
  const avisoDe = (t: string) => analisis.promos.find((a) => a.temporada === t);
  const derivadaDe = (c: string, t: string) => analisis.filas.find((f) => f.temporada === t && f.tipo_habitacion === c && f.precio_final_autoritativo);
  const bloqueoDe = (c: string, t: string) => avisoDe(t)?.bloqueadas?.find((b) => b.categoria === c);

  // Acción EXPLÍCITA: sustituir los valores escritos a mano de UNA promo en UNA
  // categoría de ESTE régimen por el −% calculado desde su base. Guarda antes la
  // calculadora (con esa celda limpia) y envía lo que muestra la vista previa;
  // el servidor recalcula y no escribe nada si no coincide.
  function sustituir(c: string, t: string, b: BloqueoPromoMixta) {
    const aviso = avisoDe(t);
    const fmt = (v: number | null | undefined) => (v == null ? "—" : formatCOP(v));
    const campos = adultsOnly ? CAMPOS_VALOR_TARIFA.slice(0, 4) : CAMPOS_VALOR_TARIFA;
    const etiquetas: Record<string, string> = {
      neto_sencilla: "Sencilla", neto_doble: "Doble", neto_triple: "Triple", neto_multiple: "Múltiple",
      neto_nino: "Niño 1", neto_nino2: "Niño 2", neto_infante: "Infante",
    };
    const lineas = campos.map((k) => `${etiquetas[k]}: ${fmt(b.actual[k])} → ${fmt(b.propuesta[k])}`).join("\n");
    const origen = b.origen.includes("tarifa_guardada") ? "guardados en las tarifas" : "tecleados en la calculadora";
    if (!confirm(
      `Sustituir los valores ${origen} de "${t}" · ${c} · régimen ${regimen} por el −${aviso?.pct}% calculado desde ${aviso?.base}:\n\n${lineas}\n\n` +
      "Solo cambia esta fila: otras categorías, regímenes y temporadas no se tocan. Antes se guarda la calculadora tal como la ves y la versión anterior queda en el historial interno.",
    )) return;

    const valsNuevos = quitarValoresCelda(vals, c, t);
    const porRegimenNuevo = { ...valoresPorRegimen, [regimen]: valsNuevos };
    const paramsNuevos: MixtaParams = {
      ...params,
      bases: basesDesdeValores(valsNuevos, categorias, temporadas),
      bases_por_regimen: basesPorRegimen(porRegimenNuevo),
    };
    const calculo = filaSustitucionMixta(paramsNuevos, ctx, { temporada: t, regimen, categoria: c });
    if (!calculo.ok) { setMsg(calculo.error); return; }
    const [esperada] = aplicarAdultsOnly([calculo.fila], adultsOnly);
    setMsg("");
    start(async () => {
      const r = await guardarCalculadora(hotelId, "mixta", paramsNuevos);
      if (!r.ok) { setMsg(r.error); return; }
      const res = await sustituirPromoManualMixta(hotelId, { temporada: t, regimen, categoria: c }, valoresDeFila(esperada), fotoTarifas(tarifasExistentes));
      if (!res.ok) {
        // No se sustituyó nada: se devuelve la calculadora a como estaba (con
        // los valores tecleados de esa celda) para no perderlos.
        const rev = await guardarCalculadora(hotelId, "mixta", params);
        setMsg(rev.ok ? res.error : `${res.error} Además no se pudo restaurar la calculadora: ${rev.error}`);
        router.refresh();
        return;
      }
      setValoresPorRegimen(porRegimenNuevo);
      setMsg(`✓ ${t} · ${c} (${regimen}) quedó con el valor calculado (−${aviso?.pct}% sobre ${aviso?.base}).`);
      router.refresh();
    });
  }

  function guardar(modo: "solo" | "agregar" | "reemplazar") {
    if (modo === "reemplazar" && !confirm(CONFIRMAR_REEMPLAZO)) return;
    setMsg("");
    start(async () => {
      const r = await guardarCalculadora(hotelId, "mixta", params);
      if (!r.ok) { setMsg(r.error); return; }
      if (modo === "solo") { setMsg("✓ Calculadora guardada."); router.refresh(); return; }
      const g = await generarTarifasCalculadora(hotelId, modo, fotoTarifas(tarifasExistentes));
      setMsg(mensajeGeneracion(g, modo));
      router.refresh();
    });
  }

  if (categorias.length === 0 || temporadas.length === 0) {
    return <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Primero define las <b>categorías</b> del hotel y sus <b>temporadas</b> (con fechas) más abajo. Luego vuelve aquí.</div>;
  }

  const camposVisibles = adultsOnly ? CAMPOS_MIXTA.filter((campo) => !["nino", "nino2", "infante"].includes(campo)) : CAMPOS_MIXTA;

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Por cada acomodación eliges si la tarifa es <b>por habitación</b> o <b>por persona</b> y si lleva <b>IVA (19%)</b>.
        Las tarifas por habitación se dividen entre los pax para guardarlas por persona. Carga los valores por categoría y temporada;
        cada régimen conserva sus propios valores. Las promociones con descuento % se calculan solas desde su temporada base.
      </p>

      <div className="flex items-center gap-2 text-xs text-gray-600">
        <span>Régimen:</span>
        <select value={regimen} onChange={(e) => cambiarRegimen(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm">
          {regimenes.length === 0 && <option value="PC">PC</option>}
          {regimenes.map((r) => <option key={r} value={r}>{r}{r !== regimen && Object.keys(valoresPorRegimen[r] ?? {}).length > 0 ? " · con valores" : ""}</option>)}
        </select>
      </div>

      {/* Config por acomodación: modo + IVA + pax */}
      <div>
        <p className={lbl}>Modo e IVA por acomodación</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MIXTA_ACOMS.map((a) => (
            <div key={a} className="rounded-lg border border-gray-100 p-2">
              <p className="mb-1 text-xs font-medium text-gray-700">{ACOM_LABEL[a]}</p>
              <select value={acom[a].modo} onChange={(e) => setAcomCfg(a, { modo: e.target.value as "hab" | "pax" })} className="mb-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs">
                <option value="pax">Por persona</option>
                <option value="hab">Por habitación</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={acom[a].iva} onChange={(e) => setAcomCfg(a, { iva: e.target.checked })} /> + IVA 19%
              </label>
              {acom[a].modo === "hab" && (
                <div className="mt-1"><label className="text-[10px] text-gray-400">Pax por hab</label><Input type="number" min={1} className="h-7 text-xs" value={pax[a]} onChange={(e) => setPax((s) => ({ ...s, [a]: e.target.value }))} /></div>
              )}
            </div>
          ))}
        </div>
        {!adultsOnly && (
          <>
            <label className="mt-2 flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={ninoIva} onChange={(e) => setNinoIva(e.target.checked)} /> Niño/Infante + IVA 19% (siempre son por persona)
            </label>
            <div className="mt-2">
              <label className="text-[11px] text-gray-500">Nota de infante (opcional, ej. &quot;Comparte cama con los padres&quot;)</label>
              <Input value={infanteNota} onChange={(e) => setInfanteNota(e.target.value)} placeholder="Nota especial para la tarifa de infante" />
            </div>
          </>
        )}
        {adultsOnly && <p className="mt-2 text-[11px] text-gray-400">Este hotel es Adults Only: no se piden valores de niño/infante.</p>}
      </div>

      {/* Valores por categoría × temporada */}
      <div>
        <p className={lbl}>Valores por categoría y temporada · régimen {regimen} (según el modo de cada acomodación)</p>
        <ResponsiveTableShell minWidth={860} className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-400">
                <th className="px-2 py-1">Categoría · Temporada</th>
                {camposVisibles.map((campo) => <th key={campo} className="px-2 py-1">{CAMPO_LABEL[campo]}</th>)}
              </tr>
            </thead>
            <tbody>
              {categorias.flatMap((c) => temporadas.map((t) => {
                const esPromo = promosPct.has(t);
                const aviso = esPromo ? avisoDe(t) : undefined;
                const derivada = esPromo ? derivadaDe(c, t) : undefined;
                const bloqueo = esPromo ? bloqueoDe(c, t) : undefined;
                // Valores tecleados en una promo: se muestran (editables) si bloquean la
                // derivación o si la promo no se puede calcular; nunca se ocultan.
                const tecleada = !!bloqueo?.origen.includes("calculadora") ||
                  (esPromo && !derivada && camposVisibles.some((campo) => (vals[claveMixta(c, t, campo)] ?? "") !== ""));
                return (
                  <tr key={`${c}|${t}`} className={`border-t border-gray-100 ${esPromo ? "bg-[var(--brand-accent)]/5" : ""}`}>
                    <td className="px-2 py-1 text-xs font-medium text-gray-700" data-label="Categoría · Temporada">
                      <span>{c} · {t}</span>
                      {esPromo && <span className="ml-1.5 rounded-full bg-[var(--brand-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--brand-accent)]">Promo</span>}
                      {derivada?.temporada_base && <div className="text-[10px] font-normal text-gray-400">−{aviso?.pct}% sobre {derivada.temporada_base}</div>}
                      {bloqueo && (
                        <div className="mt-1 space-y-1 text-[10px] font-normal">
                          <div className="text-amber-700">
                            Escrita a mano ({bloqueo.origen.map((o) => (o === "calculadora" ? "calculadora" : "tarifa guardada")).join(" y ")}): no se toca al generar.
                          </div>
                          <div className="text-gray-500">Calculada: doble {formatCOP(bloqueo.propuesta.neto_doble)} (−{aviso?.pct}% sobre {aviso?.base})</div>
                          <button type="button" disabled={pending} onClick={() => sustituir(c, t, bloqueo)} className="text-[var(--brand-accent)] hover:underline disabled:opacity-50">
                            Sustituir por −{aviso?.pct}% de {aviso?.base}
                          </button>
                        </div>
                      )}
                    </td>
                    {esPromo && !tecleada ? (
                      camposVisibles.map((campo) => {
                        const v = bloqueo ? valorActual(bloqueo, campo) : derivada ? valorFila(derivada, campo) : null;
                        return (
                          <td key={campo} className="px-2 py-1 text-right text-xs tabular-nums text-gray-500" data-label={CAMPO_LABEL[campo]}>
                            {v != null ? formatCOP(v) : "—"}
                          </td>
                        );
                      })
                    ) : (
                      camposVisibles.map((campo) => (
                        <td key={campo} className="px-1 py-1" data-label={CAMPO_LABEL[campo]}><Input type="number" className="w-24" value={vals[claveMixta(c, t, campo)] ?? ""} onChange={(e) => setVal(c, t, campo, e.target.value)} placeholder="0" /></td>
                      ))
                    )}
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </ResponsiveTableShell>
      </div>

      {avisosPromo.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
          {avisosPromo.map((a) => (
            <li key={a.temporada} className={a.estado === "derivada" ? "text-gray-600" : "text-amber-700"}>
              {a.mensaje}
            </li>
          ))}
        </ul>
      )}
      {vencidas.length > 0 && (
        <p className="text-[11px] text-gray-500">
          Vigencias con compra cerrada (no se regeneran; sus tarifas guardadas se conservan como histórico): {vencidas.join(", ")}.
        </p>
      )}

      {preview.length > 0 && <PreviewTabla titulo={`Vista previa — tarifa por persona resultante (${regimen})`} filas={preview} ocultarNinos={adultsOnly} />}
      <BotonesGuardar pending={pending} msg={msg} onGuardar={() => guardar("solo")} onAgregar={() => guardar("agregar")} onReemplazar={() => guardar("reemplazar")} />
    </div>
  );
}

function valorActual(b: BloqueoPromoMixta, campo: CampoMixta): number | null {
  return b.actual[`neto_${campo}` as keyof BloqueoPromoMixta["actual"]];
}

function valorFila(f: TarifaGenerada, campo: CampoMixta): number | null {
  switch (campo) {
    case "sencilla": return f.neto_sencilla;
    case "doble": return f.neto_doble;
    case "triple": return f.neto_triple;
    case "multiple": return f.neto_multiple;
    case "nino": return f.neto_nino;
    case "nino2": return f.neto_nino2;
    case "infante": return f.neto_infante;
  }
}

// ── Formulario CORPORATIVA (tarifa por habitación + suplementos) ──────────
function CorporativaForm({
  hotelId, categorias, temporadas, regimenes, inicial, adultsOnly, tarifasExistentes,
}: { hotelId: number; categorias: string[]; temporadas: string[]; regimenes: string[]; inicial: CorporativaParams | null; adultsOnly: boolean; tarifasExistentes: TarifaExistente[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const [regimenBase, setRegimenBase] = useState(inicial?.regimen_base ?? regimenes[0] ?? "");
  const [personaAdicional, setPersonaAdicional] = useState(String(inicial?.persona_adicional ?? 0));
  const [ninoAdicional, setNinoAdicional] = useState(String(inicial?.nino_adicional ?? 0));
  const [impuestoPct, setImpuestoPct] = useState(String(inicial?.impuesto_pct ?? 0));
  const [descuentoPct, setDescuentoPct] = useState(String(inicial?.descuento_pct ?? 0));
  const [infanteNota, setInfanteNota] = useState(inicial?.infante_nota ?? "");

  const supInicial: Record<string, { adulto: string; nino: string }> = {};
  for (const s of inicial?.suplementos_regimen ?? []) supInicial[s.regimen] = { adulto: String(s.adulto), nino: String(s.nino) };
  const [suplementos, setSuplementos] = useState<Record<string, { adulto: string; nino: string }>>(supInicial);
  const setSup = (r: string, patch: Partial<{ adulto: string; nino: string }>) =>
    setSuplementos((s) => ({ ...s, [r]: { adulto: s[r]?.adulto ?? "0", nino: s[r]?.nino ?? "0", ...patch } }));

  const baseInicial: Record<string, string> = {};
  for (const b of inicial?.bases ?? []) baseInicial[`${b.categoria}|${b.temporada}`] = String(b.precio);
  const [bases, setBases] = useState<Record<string, string>>(baseInicial);
  const setBase = (c: string, t: string, v: string) => setBases((s) => ({ ...s, [`${c}|${t}`]: v }));

  const params = useMemo<CorporativaParams>(() => ({
    regimen_base: regimenBase,
    persona_adicional: Number(personaAdicional) || 0,
    nino_adicional: Number(ninoAdicional) || 0,
    impuesto_pct: Number(impuestoPct) || 0,
    descuento_pct: Number(descuentoPct) || 0,
    suplementos_regimen: regimenes.filter((r) => r !== regimenBase).map((r) => ({
      regimen: r, adulto: Number(suplementos[r]?.adulto) || 0, nino: Number(suplementos[r]?.nino) || 0,
    })),
    bases: categorias.flatMap((c) => temporadas.map((t) => ({ categoria: c, temporada: t, precio: Number(bases[`${c}|${t}`]) || 0 }))).filter((b) => b.precio > 0),
    infante_nota: infanteNota,
  }), [regimenBase, personaAdicional, ninoAdicional, impuestoPct, descuentoPct, suplementos, bases, infanteNota, regimenes, categorias, temporadas]);

  const preview = useMemo(() => generarTarifasCorporativa(params).filter((f) => f.alimentacion === regimenBase), [params, regimenBase]);

  function guardar(modo: "solo" | "agregar" | "reemplazar") {
    if (modo === "reemplazar" && !confirm(CONFIRMAR_REEMPLAZO)) return;
    setMsg("");
    start(async () => {
      const r = await guardarCalculadora(hotelId, "corporativa", params);
      if (!r.ok) { setMsg(r.error); return; }
      if (modo === "solo") { setMsg("✓ Calculadora guardada."); router.refresh(); return; }
      const g = await generarTarifasCalculadora(hotelId, modo, fotoTarifas(tarifasExistentes));
      setMsg(mensajeGeneracion(g, modo));
      router.refresh();
    });
  }

  if (categorias.length === 0 || temporadas.length === 0) {
    return <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Primero define las <b>categorías</b> del hotel y sus <b>temporadas</b> (con fechas) más abajo. Luego vuelve aquí.</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Carga una tarifa <b>por habitación</b> (SGL/DBL — igual para 1 o 2 adultos) por categoría y temporada, típica de tarifarios
        corporativos de cadena. El sistema la reparte por persona: sencilla paga toda la habitación, doble la divide entre 2.
        Un 3er/4to pax o un niño no cambian el precio de la habitación — suman el cargo fijo de <b>persona/niño adicional</b>.
      </p>
      <div className={`grid grid-cols-2 gap-3 ${adultsOnly ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
        <div><label className="text-[11px] text-gray-500">Persona adicional (fijo, todas las categorías)</label><Input type="number" value={personaAdicional} onChange={(e) => setPersonaAdicional(e.target.value)} /></div>
        {!adultsOnly && (
          <div><label className="text-[11px] text-gray-500">Niño adicional (fijo, todas las categorías)</label><Input type="number" value={ninoAdicional} onChange={(e) => setNinoAdicional(e.target.value)} /></div>
        )}
        <div>
          <label className="text-[11px] text-gray-500">% Impuesto (opcional)</label>
          <Input type="number" value={impuestoPct} onChange={(e) => setImpuestoPct(e.target.value)} placeholder="0" />
          <p className="mt-0.5 text-[10px] text-gray-400">{Number(impuestoPct) > 0 ? "Se suma sobre la tarifa." : "Sin configurar: la tarifa queda neta y se marca con la nota \"no incluye impuestos\"."}</p>
        </div>
        <div>
          <label className="text-[11px] text-gray-500">% Descuento — tarifa Dinámica (opcional)</label>
          <Input type="number" value={descuentoPct} onChange={(e) => setDescuentoPct(e.target.value)} placeholder="0" />
          <p className="mt-0.5 text-[10px] text-gray-400">Solo descuenta la tarifa de habitación (rack) — nunca suplementos ni persona/niño adicional. Sin configurar, queda el rack.</p>
        </div>
      </div>
      {!adultsOnly && (
        <div>
          <label className="text-[11px] text-gray-500">Nota de infante (opcional, ej. &quot;Infantes 0-4 años cortesía, máx. 2 niños por habitación&quot;)</label>
          <Input value={infanteNota} onChange={(e) => setInfanteNota(e.target.value)} placeholder="Nota especial para la tarifa de infante (siempre cortesía / $0)" />
        </div>
      )}
      {adultsOnly && <p className="text-[11px] text-gray-400">Este hotel es Adults Only: no se piden cargos de niño/infante.</p>}
      <div>
        <p className={lbl}>Régimen</p>
        <div className="mb-2 flex items-center gap-2 text-xs text-gray-600">
          <span>Régimen base (incluido en la tarifa de habitación):</span>
          <select value={regimenBase} onChange={(e) => setRegimenBase(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm">
            {regimenes.length === 0 && <option value="">—</option>}
            {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {regimenes.filter((r) => r !== regimenBase).map((r) => (
            <div key={r} className="rounded-lg border border-gray-100 p-2">
              <p className="mb-1 text-xs font-medium text-gray-700">Suplemento {r} (por persona/noche)</p>
              <div className={`grid gap-2 ${adultsOnly ? "grid-cols-1" : "grid-cols-2"}`}>
                <div><label className="text-[10px] text-gray-400">Adulto</label><Input type="number" className="h-7 text-xs" value={suplementos[r]?.adulto ?? ""} onChange={(e) => setSup(r, { adulto: e.target.value })} placeholder="0" /></div>
                {!adultsOnly && (
                  <div><label className="text-[10px] text-gray-400">Niño</label><Input type="number" className="h-7 text-xs" value={suplementos[r]?.nino ?? ""} onChange={(e) => setSup(r, { nino: e.target.value })} placeholder="0" /></div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className={lbl}>Tarifa de habitación SGL/DBL ({regimenBase || "régimen base"}) — por categoría y temporada</p>
        <ResponsiveTableShell minWidth={420} className="overflow-x-auto">
          <table className="min-w-[420px] border-collapse text-sm">
            <thead><tr className="text-left text-xs text-gray-400"><th className="px-2 py-1">Categoría \ Temporada</th>{temporadas.map((t) => <th key={t} className="px-2 py-1">{t}</th>)}</tr></thead>
            <tbody>
              {categorias.map((c) => (
                <tr key={c} className="border-t border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-700" data-label="Categoría">{c}</td>
                  {temporadas.map((t) => (
                    <td key={t} className="px-1 py-1" data-label={t}><Input type="number" className="w-28" value={bases[`${c}|${t}`] ?? ""} onChange={(e) => setBase(c, t, e.target.value)} placeholder="0" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableShell>
      </div>
      {preview.length > 0 && <PreviewTabla titulo={`Vista previa (${regimenBase})`} filas={preview} ocultarNinos={adultsOnly} />}
      <BotonesGuardar pending={pending} msg={msg} onGuardar={() => guardar("solo")} onAgregar={() => guardar("agregar")} onReemplazar={() => guardar("reemplazar")} />
    </div>
  );
}

// ── Compartidos ────────────────────────────────────────────────────────────
type FilaPrev = {
  tipo_habitacion: string; temporada: string;
  neto_sencilla: number; neto_doble: number; neto_triple: number; neto_multiple: number;
  neto_nino: number; neto_nino2?: number | null; neto_infante?: number | null;
  precio_final_autoritativo?: boolean; temporada_base?: string | null;
};
function PreviewTabla({ titulo, filas, ocultarNinos = false }: { titulo: string; filas: FilaPrev[]; ocultarNinos?: boolean }) {
  return (
    <div>
      <p className={lbl}>{titulo}</p>
      <ResponsiveTableShell minWidth={620} className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[620px] text-xs">
          <thead><tr className="bg-gray-50 text-left text-gray-400">
            <th className="px-2 py-1">Categoría</th><th className="px-2 py-1">Temporada</th>
            <th className="px-2 py-1 text-right">Sencilla</th><th className="px-2 py-1 text-right">Doble</th>
            <th className="px-2 py-1 text-right">Triple</th><th className="px-2 py-1 text-right">Múltiple</th>
            {!ocultarNinos && (<><th className="px-2 py-1 text-right">Niño 1</th><th className="px-2 py-1 text-right">Niño 2</th><th className="px-2 py-1 text-right">Infante</th></>)}
          </tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-t border-gray-50">
                <td className="px-2 py-1 text-gray-700" data-label="Categoría">{f.tipo_habitacion}</td>
                <td className="px-2 py-1 text-gray-500" data-label="Temporada">
                  {f.temporada}
                  {f.precio_final_autoritativo && (
                    <span className="ml-1.5 rounded-full bg-[var(--brand-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--brand-accent)]" title={f.temporada_base ? `Precio final calculado desde ${f.temporada_base}` : undefined}>Promo</span>
                  )}
                </td>
                <td className="px-2 py-1 text-right tabular-nums" data-label="Sencilla">{formatCOP(f.neto_sencilla)}</td>
                <td className="px-2 py-1 text-right tabular-nums" data-label="Doble">{formatCOP(f.neto_doble)}</td>
                <td className="px-2 py-1 text-right tabular-nums" data-label="Triple">{formatCOP(f.neto_triple)}</td>
                <td className="px-2 py-1 text-right tabular-nums" data-label="Múltiple">{formatCOP(f.neto_multiple)}</td>
                {!ocultarNinos && (
                  <>
                    <td className="px-2 py-1 text-right tabular-nums" data-label="Niño 1">{formatCOP(f.neto_nino)}</td>
                    <td className="px-2 py-1 text-right tabular-nums" data-label="Niño 2">{f.neto_nino2 != null ? formatCOP(f.neto_nino2) : "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums" data-label="Infante">{f.neto_infante != null ? formatCOP(f.neto_infante) : "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTableShell>
    </div>
  );
}

function BotonesGuardar({ pending, msg, onGuardar, onAgregar, onReemplazar }: { pending: boolean; msg: string; onGuardar: () => void; onAgregar: () => void; onReemplazar: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onGuardar} disabled={pending}>{pending ? "…" : "Guardar calculadora"}</Button>
        <Button onClick={onAgregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Generando…" : "Generar (agregar/actualizar)"}</Button>
        <Button variant="outline" onClick={onReemplazar} disabled={pending}>Reemplazar TODAS las tarifas</Button>
        {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
      </div>
      <p className="text-[11px] text-gray-400">
        <b>Agregar/actualizar</b>: reemplaza solo las filas que genera ahora (misma categoría, régimen y temporada); conserva otras temporadas, regímenes y vigencias vencidas.
        Para quitar una tarifa, elimínala en la tabla de abajo. ·
        <b> Reemplazar TODAS</b>: borra las tarifas vigentes del hotel y deja solo estas (conserva las de vigencias vencidas).
        Toda fila reemplazada o borrada queda en el historial interno.
      </p>
    </div>
  );
}
