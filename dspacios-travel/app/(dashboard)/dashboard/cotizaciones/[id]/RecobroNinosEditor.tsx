"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { actualizarRecobroNinosCotizacionManual } from "../manual-actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

// Editor posterior de NIÑOS y RECOBRO de una cotización dinámica (antes de
// generar el contrato). El recobro va oculto al cliente (dentro de la tarifa de
// adulto) y, en B2B, se reparte entre empresa y aliado.
export function RecobroNinosEditor({
  id, moneda, esB2B, pctAliadoB2B, inicial,
}: {
  id: number;
  moneda: string;
  esB2B: boolean;
  pctAliadoB2B: number;
  inicial: { ninos: number; tarifaNino: number; recobro: number; recobroAliado: number };
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [ninos, setNinos] = useState(String(inicial.ninos));
  const [tarifaNino, setTarifaNino] = useState(String(inicial.tarifaNino));
  const [recobro, setRecobro] = useState(String(inicial.recobro));
  const [recobroAliado, setRecobroAliado] = useState(String(inicial.recobroAliado));
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  const nNinos = Math.max(Math.trunc(Number(ninos) || 0), 0);
  const valorNino = Math.max(Number(tarifaNino) || 0, 0);
  const totalNinos = nNinos * valorNino;
  const recobroN = Math.max(Number(recobro) || 0, 0);
  const recobroAliadoN = esB2B ? Math.min(Math.max(Number(recobroAliado) || 0, 0), recobroN) : 0;
  const recobroEmpresaN = recobroN - recobroAliadoN;

  function reset() {
    setNinos(String(inicial.ninos));
    setTarifaNino(String(inicial.tarifaNino));
    setRecobro(String(inicial.recobro));
    setRecobroAliado(String(inicial.recobroAliado));
    setErr("");
  }

  function guardar() {
    setErr(""); setOk(false);
    start(async () => {
      const r = await actualizarRecobroNinosCotizacionManual(id, {
        ninos: nNinos, tarifaNino: valorNino, recobro: recobroN, recobroAliado: recobroAliadoN,
      });
      if (r.ok) { setOk(true); setEditando(false); router.refresh(); }
      else setErr(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Niños y recobro</h2>
        {!editando && (
          <button type="button" onClick={() => { setOk(false); setEditando(true); }} className="text-xs font-medium text-[#1D7C9A] hover:underline">Editar</button>
        )}
      </div>

      {!editando ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Dato label="Niños" value={String(inicial.ninos)} />
          <Dato label="Tarifa por niño" value={inicial.tarifaNino > 0 ? formatMoneda(inicial.tarifaNino, moneda) : "—"} />
          <Dato label="Recobro" value={inicial.recobro > 0 ? formatMoneda(inicial.recobro, moneda) : "—"} />
          <Dato
            label={esB2B ? "Reparto (empresa / aliado)" : "Recobro empresa"}
            value={inicial.recobro > 0
              ? (esB2B
                ? `${formatMoneda(inicial.recobro - inicial.recobroAliado, moneda)} / ${formatMoneda(inicial.recobroAliado, moneda)}`
                : formatMoneda(inicial.recobro, moneda))
              : "—"}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><label className={lbl}>Niños</label><Input type="number" min={0} value={ninos} onChange={(e) => setNinos(e.target.value)} /></div>
            <div><label className={lbl}>Tarifa por niño</label><Input type="number" min={0} value={tarifaNino} onChange={(e) => setTarifaNino(e.target.value)} /></div>
            <div><label className={lbl}>Valor del recobro</label><Input type="number" min={0} value={recobro} onChange={(e) => setRecobro(e.target.value)} /></div>
            {esB2B ? (
              <div>
                <div className="flex items-center justify-between">
                  <label className={lbl}>Para el aliado</label>
                  <button type="button" onClick={() => setRecobroAliado(String(Math.round(recobroN * pctAliadoB2B)))}
                    className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Sugerir {Math.round(pctAliadoB2B * 100)}%</button>
                </div>
                <Input type="number" min={0} max={recobroN} value={recobroAliado} onChange={(e) => setRecobroAliado(e.target.value)} />
              </div>
            ) : (
              <div className="flex items-end pb-1 text-xs text-gray-500">Cliente final → recobro <b className="ml-1">100% empresa</b>.</div>
            )}
          </div>

          <div className="mt-3 space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
            {nNinos > 0 && <div className="flex items-center justify-between"><span>Niños ({nNinos} × {formatMoneda(valorNino, moneda)})</span><span className="tabular-nums">{formatMoneda(totalNinos, moneda)}</span></div>}
            {recobroN > 0 && (
              <div className="flex items-center justify-between text-amber-700">
                <span>Recobro <span className="text-[11px] text-amber-600">(oculto · empresa {formatMoneda(recobroEmpresaN, moneda)}{esB2B ? ` · aliado ${formatMoneda(recobroAliadoN, moneda)}` : ""})</span></span>
                <span className="tabular-nums">{formatMoneda(recobroN, moneda)}</span>
              </div>
            )}
            {nNinos === 0 && recobroN === 0 && <span className="text-gray-400">Sin niños ni recobro.</span>}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
            <button type="button" onClick={() => { setEditando(false); reset(); }} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
          </div>
        </>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {ok && <p className="mt-2 text-xs text-green-600">Actualizado.</p>}
    </section>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800">{value || "—"}</div>
    </div>
  );
}
