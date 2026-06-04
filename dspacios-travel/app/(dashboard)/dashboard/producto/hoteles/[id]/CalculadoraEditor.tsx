"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { generarTarifasDubai, type DubaiParams } from "@/lib/calc/calculadoras";
import { guardarCalculadora, generarTarifasCalculadora } from "../actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function CalculadoraEditor({
  hotelId, categorias, temporadas, regimenes, inicial,
}: {
  hotelId: number;
  categorias: string[];
  temporadas: string[];
  regimenes: string[];
  inicial: DubaiParams | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  // Modificadores
  const [sencillaPct, setSencillaPct] = useState(String(inicial?.modificadores?.sencilla_pct ?? 50));
  const [pax3Pct, setPax3Pct] = useState(String(inicial?.modificadores?.pax3_pct ?? -20));
  const [pax4Pct, setPax4Pct] = useState(String(inicial?.modificadores?.pax4_pct ?? -20));
  const [ninoPct, setNinoPct] = useState(String(inicial?.modificadores?.nino_pct ?? -50));

  // Régimen base + suplementos por régimen
  const [regimenBase, setRegimenBase] = useState(inicial?.regimen_base ?? regimenes[0] ?? "PC");
  const supInicial: Record<string, string> = {};
  for (const s of inicial?.suplementos ?? []) supInicial[s.regimen] = String(s.monto);
  const [suplementos, setSuplementos] = useState<Record<string, string>>(supInicial);

  // Bases por categoría × temporada
  const baseInicial: Record<string, string> = {};
  for (const b of inicial?.bases ?? []) baseInicial[`${b.categoria}|${b.temporada}`] = String(b.precio);
  const [bases, setBases] = useState<Record<string, string>>(baseInicial);

  const setSup = (r: string, v: string) => setSuplementos((s) => ({ ...s, [r]: v }));
  const setBase = (c: string, t: string, v: string) => setBases((s) => ({ ...s, [`${c}|${t}`]: v }));

  // Arma los parámetros desde el formulario.
  const params = useMemo<DubaiParams>(() => ({
    regimen_base: regimenBase,
    modificadores: {
      sencilla_pct: Number(sencillaPct) || 0,
      pax3_pct: Number(pax3Pct) || 0,
      pax4_pct: Number(pax4Pct) || 0,
      nino_pct: Number(ninoPct) || 0,
    },
    suplementos: regimenes
      .filter((r) => r !== regimenBase)
      .map((r) => ({ regimen: r, monto: Number(suplementos[r]) || 0 })),
    bases: categorias.flatMap((c) =>
      temporadas.map((t) => ({ categoria: c, temporada: t, precio: Number(bases[`${c}|${t}`]) || 0 }))
    ).filter((b) => b.precio > 0),
  }), [regimenBase, sencillaPct, pax3Pct, pax4Pct, ninoPct, suplementos, bases, regimenes, categorias, temporadas]);

  // Vista previa (solo el régimen base, para validar la fórmula).
  const preview = useMemo(
    () => generarTarifasDubai(params).filter((f) => f.alimentacion === regimenBase),
    [params, regimenBase]
  );

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

  const faltaConfig = categorias.length === 0 || temporadas.length === 0;

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">
          Tarifa por fórmula (calculadora)
          {inicial && <span className="ml-2 rounded-full bg-[var(--brand-success)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--brand-success)]">configurada</span>}
        </span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-gray-100 p-4">
          <p className="text-xs text-gray-500">
            Carga una <b>base por persona/noche</b> (en doble, con el régimen base) por categoría y temporada;
            el sistema deriva sencilla/triple/múltiple/niño con los modificadores y suma los suplementos de régimen.
            <b> &quot;Generar tarifas&quot;</b> reemplaza las tarifas de este hotel con el resultado.
          </p>

          {faltaConfig ? (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
              Primero define las <b>categorías</b> del hotel y sus <b>temporadas</b> (con fechas) más abajo. Luego vuelve aquí.
            </div>
          ) : (
            <>
              {/* Modificadores */}
              <div>
                <p className={lbl}>Modificadores (% sobre la base)</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><label className="text-[11px] text-gray-500">Sencilla</label><Input type="number" value={sencillaPct} onChange={(e) => setSencillaPct(e.target.value)} /></div>
                  <div><label className="text-[11px] text-gray-500">3er pax</label><Input type="number" value={pax3Pct} onChange={(e) => setPax3Pct(e.target.value)} /></div>
                  <div><label className="text-[11px] text-gray-500">4to pax</label><Input type="number" value={pax4Pct} onChange={(e) => setPax4Pct(e.target.value)} /></div>
                  <div><label className="text-[11px] text-gray-500">Niño</label><Input type="number" value={ninoPct} onChange={(e) => setNinoPct(e.target.value)} /></div>
                </div>
                <p className="mt-1 text-[11px] text-gray-400">Ej. sencilla 50 = +50% · 3er pax -20 = −20% · niño -50 = −50%.</p>
              </div>

              {/* Régimen base + suplementos */}
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
                    <div key={r}>
                      <label className="text-[11px] text-gray-500">Suplemento {r} (por pax)</label>
                      <Input type="number" value={suplementos[r] ?? ""} onChange={(e) => setSup(r, e.target.value)} placeholder="0" />
                    </div>
                  ))}
                  {regimenes.filter((r) => r !== regimenBase).length === 0 && (
                    <p className="text-[11px] text-gray-400">Este hotel no tiene otros regímenes. Agrégalos en sus categorías/regímenes si aplica.</p>
                  )}
                </div>
              </div>

              {/* Bases por categoría × temporada */}
              <div>
                <p className={lbl}>Base por persona (doble, {regimenBase}) — por categoría y temporada</p>
                <div className="overflow-x-auto">
                  <table className="min-w-[420px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400">
                        <th className="px-2 py-1">Categoría \ Temporada</th>
                        {temporadas.map((t) => <th key={t} className="px-2 py-1">{t}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {categorias.map((c) => (
                        <tr key={c} className="border-t border-gray-100">
                          <td className="px-2 py-1 font-medium text-gray-700">{c}</td>
                          {temporadas.map((t) => (
                            <td key={t} className="px-1 py-1">
                              <Input type="number" className="w-28" value={bases[`${c}|${t}`] ?? ""} onChange={(e) => setBase(c, t, e.target.value)} placeholder="0" />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Vista previa */}
              {preview.length > 0 && (
                <div>
                  <p className={lbl}>Vista previa ({regimenBase}) — así quedará la tarifa por persona</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full min-w-[560px] text-xs">
                      <thead><tr className="bg-gray-50 text-left text-gray-400">
                        <th className="px-2 py-1">Categoría</th><th className="px-2 py-1">Temporada</th>
                        <th className="px-2 py-1 text-right">Sencilla</th><th className="px-2 py-1 text-right">Doble</th>
                        <th className="px-2 py-1 text-right">Triple</th><th className="px-2 py-1 text-right">Múltiple</th><th className="px-2 py-1 text-right">Niño</th>
                      </tr></thead>
                      <tbody>
                        {preview.map((f, i) => (
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
                  <p className="mt-1 text-[11px] text-gray-400">Los suplementos de régimen se suman aparte al generar.</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={() => guardar(false)} disabled={pending}>
                  {pending ? "…" : "Guardar calculadora"}
                </Button>
                <Button onClick={() => guardar(true)} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
                  {pending ? "Generando…" : "Generar tarifas"}
                </Button>
                {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
