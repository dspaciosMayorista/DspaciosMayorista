"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/utils";
import { parseUtilidades, parsePagos } from "@/lib/minorista/importMinorista";
import { importarHistorico } from "./actions";

type Estado = { ok: boolean; msg: string; notas?: string[] } | null;

export function ImportarClient({ habilitado }: { habilitado: boolean }) {
  const router = useRouter();
  const [rel, setRel] = useState("");
  const [pag, setPag] = useState("");
  const [estado, setEstado] = useState<Estado>(null);
  const [pending, start] = useTransition();

  // Vista previa: cruza en el navegador para mostrar qué se importará y qué se omite.
  const previa = useMemo(() => {
    if (!rel.trim() || !pag.trim()) return null;
    const r = parseUtilidades(rel);
    const p = parsePagos(pag);
    const relNums = new Map(r.filas.map((f) => [f.numero, f]));
    const pagNums = new Map(p.filas.map((f) => [f.numero, f]));
    const enAmbos: string[] = [];
    const soloRel: string[] = [];
    const soloPag: string[] = [];
    for (const n of relNums.keys()) (pagNums.has(n) ? enAmbos : soloRel).push(n);
    for (const n of pagNums.keys()) if (!relNums.has(n)) soloPag.push(n);
    const filas = enAmbos.slice(0, 200).map((n) => {
      const rf = relNums.get(n)!;
      const pf = pagNums.get(n)!;
      const tot = pf.abonos.reduce((a, b) => a + b.valor, 0);
      return {
        num: n,
        titular: pf.cliente ?? "—",
        asesor: pf.asesor ?? "—",
        valor: rf.moneda === "USD" ? `USD ${rf.precio_venta.toLocaleString("es-CO")}` : formatCOP(rf.precio_venta),
        abonos: pf.abonos.length,
        totalAbon: formatCOP(tot),
      };
    });
    return { enAmbos: enAmbos.length, soloRel, soloPag, filas, avisos: [...r.notas, ...p.notas] };
  }, [rel, pag]);

  function importar() {
    setEstado(null);
    start(async () => {
      const res = await importarHistorico(rel, pag);
      if (res.ok) { setEstado({ ok: true, msg: res.resumen, notas: res.notas }); router.refresh(); }
      else setEstado({ ok: false, msg: res.error });
    });
  }

  const ta = "w-full rounded-lg border border-gray-300 p-3 font-mono text-xs";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-600">
          Pega las <b>dos hojas</b>. Un contrato se importa <b>solo si aparece en ambas</b>
          (Relación de utilidades <b>y</b> Resumen de pagos); si está en una sola, se omite.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">1 · Relación de utilidades <span className="font-normal text-gray-400">(costos)</span></label>
            <textarea value={rel} onChange={(e) => setRel(e.target.value)} rows={7} placeholder="Pega aquí las filas de la hoja “RELACIÓN DE UTILIDADES”…" className={ta} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">2 · Resumen de pagos <span className="font-normal text-gray-400">(titular, asesor, abonos)</span></label>
            <textarea value={pag} onChange={(e) => setPag(e.target.value)} rows={7} placeholder="Pega aquí las filas de la hoja “RESUMEN DE PAGOS”…" className={ta} />
          </div>
        </div>

        {previa && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-[#66B596]/15 px-3 py-1 font-medium text-[#2f6b54]">✓ {previa.enAmbos} en ambas → se importan</span>
              {previa.soloRel.length > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">{previa.soloRel.length} solo en Relación → se omiten</span>}
              {previa.soloPag.length > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">{previa.soloPag.length} solo en Resumen → se omiten</span>}
            </div>

            <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">N° reserva</th>
                    <th className="px-3 py-2 font-medium">Titular</th>
                    <th className="px-3 py-2 font-medium">Asesor</th>
                    <th className="px-3 py-2 font-medium">Valor</th>
                    <th className="px-3 py-2 font-medium"># Abonos</th>
                    <th className="px-3 py-2 font-medium">Total abonado</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.filas.map((f) => (
                    <tr key={f.num} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 font-mono text-gray-700">{f.num}</td>
                      <td className="px-3 py-1.5 text-gray-700">{f.titular}</td>
                      <td className="px-3 py-1.5 text-gray-500">{f.asesor}</td>
                      <td className="px-3 py-1.5 text-gray-700">{f.valor}</td>
                      <td className="px-3 py-1.5 text-gray-500">{f.abonos}</td>
                      <td className="px-3 py-1.5 text-gray-700">{f.totalAbon}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(previa.avisos.length > 0 || previa.soloRel.length > 0 || previa.soloPag.length > 0) && (
              <details className="mt-2 text-xs text-amber-700">
                <summary className="cursor-pointer">Ver detalle de omitidos y avisos</summary>
                <ul className="mt-1 list-disc pl-5">
                  {previa.soloRel.length > 0 && <li>Solo en Relación (se omiten): {previa.soloRel.slice(0, 60).join(", ")}{previa.soloRel.length > 60 ? "…" : ""}</li>}
                  {previa.soloPag.length > 0 && <li>Solo en Resumen (se omiten): {previa.soloPag.slice(0, 60).join(", ")}{previa.soloPag.length > 60 ? "…" : ""}</li>}
                  {previa.avisos.slice(0, 50).map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={importar}
            disabled={!habilitado || pending || !previa || previa.enAmbos === 0}
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            {pending ? "Importando…" : "Importar contratos en ambas hojas"}
          </Button>
          {!habilitado && <span className="text-xs text-red-600">Cambia a la agencia Minorista para habilitar.</span>}
          {estado && (
            <span className={`text-xs ${estado.ok ? "text-[#2f6b54]" : "text-red-600"}`}>
              {estado.ok ? "✓ " : ""}{estado.msg}
            </span>
          )}
        </div>

        {estado?.ok && estado.notas && estado.notas.length > 0 && (
          <details className="mt-2 text-xs text-amber-700">
            <summary className="cursor-pointer">{estado.notas.length} aviso(s) de la importación</summary>
            <ul className="mt-1 list-disc pl-5">
              {estado.notas.slice(0, 80).map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
