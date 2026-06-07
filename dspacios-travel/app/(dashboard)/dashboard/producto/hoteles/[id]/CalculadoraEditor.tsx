"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import {
  generarTarifasDubai, type DubaiParams,
  generarTarifasMixta, type MixtaParams, type MixtaAcom, MIXTA_ACOMS, type CalcTipo,
} from "@/lib/calc/calculadoras";
import { PAX_TARIFA_DEFAULT } from "@/lib/acomodaciones";
import { guardarCalculadora, generarTarifasCalculadora } from "../actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function CalculadoraEditor({
  hotelId, categorias, temporadas, regimenes, tipoInicial, dubaiInicial, mixtaInicial,
}: {
  hotelId: number;
  categorias: string[];
  temporadas: string[];
  regimenes: string[];
  tipoInicial: CalcTipo | null;
  dubaiInicial: DubaiParams | null;
  mixtaInicial: MixtaParams | null;
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
            </select>
          </div>
          {tipoCalc === "dubai"
            ? <DubaiForm hotelId={hotelId} categorias={categorias} temporadas={temporadas} regimenes={regimenes} inicial={dubaiInicial} />
            : <MixtaForm hotelId={hotelId} categorias={categorias} temporadas={temporadas} regimenes={regimenes} inicial={mixtaInicial} />}
        </div>
      )}
    </section>
  );
}

// ── Formulario DUBAI (sin cambios de lógica) ───────────────────────────────
function DubaiForm({
  hotelId, categorias, temporadas, regimenes, inicial,
}: { hotelId: number; categorias: string[]; temporadas: string[]; regimenes: string[]; inicial: DubaiParams | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const [sencillaPct, setSencillaPct] = useState(String(inicial?.modificadores?.sencilla_pct ?? 50));
  const [pax3Pct, setPax3Pct] = useState(String(inicial?.modificadores?.pax3_pct ?? -20));
  const [pax4Pct, setPax4Pct] = useState(String(inicial?.modificadores?.pax4_pct ?? -20));
  const [ninoPct, setNinoPct] = useState(String(inicial?.modificadores?.nino_pct ?? -50));

  const [regimenBase, setRegimenBase] = useState(inicial?.regimen_base ?? regimenes[0] ?? "PC");
  const supInicial: Record<string, string> = {};
  for (const s of inicial?.suplementos ?? []) supInicial[s.regimen] = String(s.monto);
  const [suplementos, setSuplementos] = useState<Record<string, string>>(supInicial);

  const baseInicial: Record<string, string> = {};
  for (const b of inicial?.bases ?? []) baseInicial[`${b.categoria}|${b.temporada}`] = String(b.precio);
  const [bases, setBases] = useState<Record<string, string>>(baseInicial);

  const setSup = (r: string, v: string) => setSuplementos((s) => ({ ...s, [r]: v }));
  const setBase = (c: string, t: string, v: string) => setBases((s) => ({ ...s, [`${c}|${t}`]: v }));

  const params = useMemo<DubaiParams>(() => ({
    regimen_base: regimenBase,
    modificadores: {
      sencilla_pct: Number(sencillaPct) || 0,
      pax3_pct: Number(pax3Pct) || 0,
      pax4_pct: Number(pax4Pct) || 0,
      nino_pct: Number(ninoPct) || 0,
    },
    suplementos: regimenes.filter((r) => r !== regimenBase).map((r) => ({ regimen: r, monto: Number(suplementos[r]) || 0 })),
    bases: categorias.flatMap((c) => temporadas.map((t) => ({ categoria: c, temporada: t, precio: Number(bases[`${c}|${t}`]) || 0 }))).filter((b) => b.precio > 0),
  }), [regimenBase, sencillaPct, pax3Pct, pax4Pct, ninoPct, suplementos, bases, regimenes, categorias, temporadas]);

  const preview = useMemo(() => generarTarifasDubai(params).filter((f) => f.alimentacion === regimenBase), [params, regimenBase]);

  function guardar(luegoGenerar: boolean) {
    setMsg("");
    start(async () => {
      const r = await guardarCalculadora(hotelId, "dubai", params);
      if (!r.ok) { setMsg(r.error); return; }
      if (!luegoGenerar) { setMsg("✓ Calculadora guardada."); router.refresh(); return; }
      const g = await generarTarifasCalculadora(hotelId);
      setMsg(g.ok ? `✓ Generadas ${g.generadas} tarifas (reemplazaron las anteriores).` : g.error);
      router.refresh();
    });
  }

  if (categorias.length === 0 || temporadas.length === 0) {
    return <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Primero define las <b>categorías</b> del hotel y sus <b>temporadas</b> (con fechas) más abajo. Luego vuelve aquí.</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">Carga una <b>base por persona/noche</b> (en doble, con el régimen base) por categoría y temporada; el sistema deriva sencilla/triple/múltiple/niño con los modificadores y suma los suplementos de régimen. <b>&quot;Generar tarifas&quot;</b> reemplaza las tarifas de este hotel.</p>
      <div>
        <p className={lbl}>Modificadores (% sobre la base)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className="text-[11px] text-gray-500">Sencilla</label><Input type="number" value={sencillaPct} onChange={(e) => setSencillaPct(e.target.value)} /></div>
          <div><label className="text-[11px] text-gray-500">3er pax</label><Input type="number" value={pax3Pct} onChange={(e) => setPax3Pct(e.target.value)} /></div>
          <div><label className="text-[11px] text-gray-500">4to pax</label><Input type="number" value={pax4Pct} onChange={(e) => setPax4Pct(e.target.value)} /></div>
          <div><label className="text-[11px] text-gray-500">Niño</label><Input type="number" value={ninoPct} onChange={(e) => setNinoPct(e.target.value)} /></div>
        </div>
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
        <div className="overflow-x-auto">
          <table className="min-w-[420px] border-collapse text-sm">
            <thead><tr className="text-left text-xs text-gray-400"><th className="px-2 py-1">Categoría \ Temporada</th>{temporadas.map((t) => <th key={t} className="px-2 py-1">{t}</th>)}</tr></thead>
            <tbody>
              {categorias.map((c) => (
                <tr key={c} className="border-t border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-700">{c}</td>
                  {temporadas.map((t) => (
                    <td key={t} className="px-1 py-1"><Input type="number" className="w-28" value={bases[`${c}|${t}`] ?? ""} onChange={(e) => setBase(c, t, e.target.value)} placeholder="0" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {preview.length > 0 && <PreviewTabla titulo={`Vista previa (${regimenBase})`} filas={preview} />}
      <BotonesGuardar pending={pending} msg={msg} onGuardar={() => guardar(false)} onGenerar={() => guardar(true)} />
    </div>
  );
}

// ── Formulario MIXTA (por hab/pax + IVA) ───────────────────────────────────
type AcomCfg = Record<MixtaAcom, { modo: "hab" | "pax"; iva: boolean }>;
const ACOM_LABEL: Record<MixtaAcom, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple" };
const CAMPOS = ["sencilla", "doble", "triple", "multiple", "nino", "nino2"] as const;
type Campo = (typeof CAMPOS)[number];

function MixtaForm({
  hotelId, categorias, temporadas, regimenes, inicial,
}: { hotelId: number; categorias: string[]; temporadas: string[]; regimenes: string[]; inicial: MixtaParams | null }) {
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
  const [pax, setPax] = useState<Record<MixtaAcom, string>>(() => {
    const def: Record<MixtaAcom, string> = {
      sencilla: String(inicial?.pax?.sencilla ?? PAX_TARIFA_DEFAULT.sencilla),
      doble: String(inicial?.pax?.doble ?? PAX_TARIFA_DEFAULT.doble),
      triple: String(inicial?.pax?.triple ?? PAX_TARIFA_DEFAULT.triple),
      multiple: String(inicial?.pax?.multiple ?? PAX_TARIFA_DEFAULT.multiple),
    };
    return def;
  });

  const valInicial: Record<string, string> = {};
  for (const b of inicial?.bases ?? []) {
    valInicial[`${b.categoria}|${b.temporada}|sencilla`] = String(b.sencilla ?? "");
    valInicial[`${b.categoria}|${b.temporada}|doble`] = String(b.doble ?? "");
    valInicial[`${b.categoria}|${b.temporada}|triple`] = String(b.triple ?? "");
    valInicial[`${b.categoria}|${b.temporada}|multiple`] = String(b.multiple ?? "");
    valInicial[`${b.categoria}|${b.temporada}|nino`] = String(b.nino ?? "");
    if (b.nino2 != null) valInicial[`${b.categoria}|${b.temporada}|nino2`] = String(b.nino2);
  }
  const [vals, setVals] = useState<Record<string, string>>(valInicial);
  const setVal = (c: string, t: string, campo: Campo, v: string) => setVals((s) => ({ ...s, [`${c}|${t}|${campo}`]: v }));
  const num = (c: string, t: string, campo: Campo) => Number(vals[`${c}|${t}|${campo}`]) || 0;

  const setAcomCfg = (a: MixtaAcom, patch: Partial<{ modo: "hab" | "pax"; iva: boolean }>) =>
    setAcom((s) => ({ ...s, [a]: { ...s[a], ...patch } }));

  const params = useMemo<MixtaParams>(() => ({
    regimen,
    iva_pct: 19,
    acom,
    nino: { iva: ninoIva },
    pax: { sencilla: Number(pax.sencilla) || 1, doble: Number(pax.doble) || 2, triple: Number(pax.triple) || 3, multiple: Number(pax.multiple) || 4 },
    bases: categorias.flatMap((c) => temporadas.map((t) => ({
      categoria: c, temporada: t,
      sencilla: num(c, t, "sencilla"), doble: num(c, t, "doble"), triple: num(c, t, "triple"), multiple: num(c, t, "multiple"),
      nino: num(c, t, "nino"), nino2: vals[`${c}|${t}|nino2`] ? Number(vals[`${c}|${t}|nino2`]) : null,
    }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [regimen, acom, ninoIva, pax, vals, categorias, temporadas]);

  const preview = useMemo(() => generarTarifasMixta(params), [params]);

  function guardar(luegoGenerar: boolean) {
    setMsg("");
    start(async () => {
      const r = await guardarCalculadora(hotelId, "mixta", params);
      if (!r.ok) { setMsg(r.error); return; }
      if (!luegoGenerar) { setMsg("✓ Calculadora guardada."); router.refresh(); return; }
      const g = await generarTarifasCalculadora(hotelId);
      setMsg(g.ok ? `✓ Generadas ${g.generadas} tarifas (reemplazaron las anteriores).` : g.error);
      router.refresh();
    });
  }

  if (categorias.length === 0 || temporadas.length === 0) {
    return <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Primero define las <b>categorías</b> del hotel y sus <b>temporadas</b> (con fechas) más abajo. Luego vuelve aquí.</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Por cada acomodación eliges si la tarifa es <b>por habitación</b> o <b>por persona</b> y si lleva <b>IVA (19%)</b>.
        Las tarifas por habitación se dividen entre los pax para guardarlas por persona. Carga los valores por categoría y temporada.
        <b> &quot;Generar tarifas&quot;</b> reemplaza las tarifas de este hotel.
      </p>

      <div className="flex items-center gap-2 text-xs text-gray-600">
        <span>Régimen:</span>
        <select value={regimen} onChange={(e) => setRegimen(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm">
          {regimenes.length === 0 && <option value="PC">PC</option>}
          {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
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
        <label className="mt-2 flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" checked={ninoIva} onChange={(e) => setNinoIva(e.target.checked)} /> Niño + IVA 19% (el niño siempre es por persona)
        </label>
      </div>

      {/* Valores por categoría × temporada */}
      <div>
        <p className={lbl}>Valores por categoría y temporada (según el modo de cada acomodación)</p>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-400">
                <th className="px-2 py-1">Categoría · Temporada</th>
                <th className="px-2 py-1">Sencilla</th><th className="px-2 py-1">Doble</th><th className="px-2 py-1">Triple</th><th className="px-2 py-1">Múltiple</th>
                <th className="px-2 py-1">Niño 1</th><th className="px-2 py-1">Niño 2</th>
              </tr>
            </thead>
            <tbody>
              {categorias.flatMap((c) => temporadas.map((t) => (
                <tr key={`${c}|${t}`} className="border-t border-gray-100">
                  <td className="px-2 py-1 text-xs font-medium text-gray-700">{c} · {t}</td>
                  {CAMPOS.map((campo) => (
                    <td key={campo} className="px-1 py-1"><Input type="number" className="w-24" value={vals[`${c}|${t}|${campo}`] ?? ""} onChange={(e) => setVal(c, t, campo, e.target.value)} placeholder="0" /></td>
                  ))}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>

      {preview.length > 0 && <PreviewTabla titulo="Vista previa — tarifa por persona resultante" filas={preview} />}
      <BotonesGuardar pending={pending} msg={msg} onGuardar={() => guardar(false)} onGenerar={() => guardar(true)} />
    </div>
  );
}

// ── Compartidos ────────────────────────────────────────────────────────────
type FilaPrev = { tipo_habitacion: string; temporada: string; neto_sencilla: number; neto_doble: number; neto_triple: number; neto_multiple: number; neto_nino: number };
function PreviewTabla({ titulo, filas }: { titulo: string; filas: FilaPrev[] }) {
  return (
    <div>
      <p className={lbl}>{titulo}</p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[560px] text-xs">
          <thead><tr className="bg-gray-50 text-left text-gray-400">
            <th className="px-2 py-1">Categoría</th><th className="px-2 py-1">Temporada</th>
            <th className="px-2 py-1 text-right">Sencilla</th><th className="px-2 py-1 text-right">Doble</th>
            <th className="px-2 py-1 text-right">Triple</th><th className="px-2 py-1 text-right">Múltiple</th><th className="px-2 py-1 text-right">Niño</th>
          </tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-t border-gray-50">
                <td className="px-2 py-1 text-gray-700">{f.tipo_habitacion}</td>
                <td className="px-2 py-1 text-gray-500">{f.temporada}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatCOP(f.neto_sencilla)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatCOP(f.neto_doble)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatCOP(f.neto_triple)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatCOP(f.neto_multiple)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatCOP(f.neto_nino)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BotonesGuardar({ pending, msg, onGuardar, onGenerar }: { pending: boolean; msg: string; onGuardar: () => void; onGenerar: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={onGuardar} disabled={pending}>{pending ? "…" : "Guardar calculadora"}</Button>
      <Button onClick={onGenerar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Generando…" : "Generar tarifas"}</Button>
      {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
    </div>
  );
}
