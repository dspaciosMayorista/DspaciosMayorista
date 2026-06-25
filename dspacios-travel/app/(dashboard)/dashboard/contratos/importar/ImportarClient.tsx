"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/utils";
import { parseUtilidades, parsePagos } from "@/lib/minorista/importMinorista";
import { importarUtilidades, importarPagos } from "./actions";

type Estado = { ok: boolean; msg: string; notas?: string[] } | null;

export function ImportarClient({ habilitado }: { habilitado: boolean }) {
  const router = useRouter();

  return (
    <div className="space-y-8">
      <Bloque
        titulo="1 · Relación de utilidades → contratos y costos"
        ayuda="Copia desde la hoja “RELACIÓN DE UTILIDADES” (incluye N° reserva, fechas, valor de venta y costos). Pega aquí todo el bloque de filas."
        habilitado={habilitado}
        previa={(t) => {
          const { filas, notas } = parseUtilidades(t);
          return {
            cols: ["N° reserva", "Moneda", "Valor", "Hotel", "Costo hotel", "Costo aéreo"],
            rows: filas.slice(0, 200).map((f) => [
              f.numero,
              f.moneda,
              f.moneda === "USD" ? `USD ${f.precio_venta.toLocaleString("es-CO")}` : formatCOP(f.precio_venta),
              f.hotel ?? "—",
              formatCOP(f.costo_hotel),
              formatCOP(f.costo_aereo),
            ]),
            total: filas.length,
            notas,
          };
        }}
        accion={importarUtilidades}
        onDone={() => router.refresh()}
      />

      <Bloque
        titulo="2 · Resumen de pagos → titular, asesor y abonos"
        ayuda="Copia desde la hoja “RESUMEN DE PAGOS” (titular, documento, valor y cada cuota). Importa esto DESPUÉS de la relación de utilidades para no perder los costos."
        habilitado={habilitado}
        previa={(t) => {
          const { filas, notas } = parsePagos(t);
          return {
            cols: ["N° reserva", "Titular", "Asesor", "Valor", "# Abonos", "Total abonado"],
            rows: filas.slice(0, 200).map((f) => {
              const tot = f.abonos.reduce((a, b) => a + b.valor, 0);
              return [
                f.numero,
                f.cliente ?? "—",
                f.asesor ?? "—",
                f.precio_venta != null ? formatCOP(f.precio_venta) : "—",
                String(f.abonos.length),
                formatCOP(tot),
              ];
            }),
            total: filas.length,
            notas,
          };
        }}
        accion={importarPagos}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

function Bloque({
  titulo,
  ayuda,
  habilitado,
  previa,
  accion,
  onDone,
}: {
  titulo: string;
  ayuda: string;
  habilitado: boolean;
  previa: (t: string) => { cols: string[]; rows: string[][]; total: number; notas: string[] };
  accion: (texto: string) => Promise<{ ok: true; resumen: string; notas: string[] } | { ok: false; error: string }>;
  onDone: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<Estado>(null);
  const [pending, start] = useTransition();

  const vista = useMemo(() => (texto.trim() ? previa(texto) : null), [texto, previa]);

  function importar() {
    setEstado(null);
    start(async () => {
      const r = await accion(texto);
      if (r.ok) {
        setEstado({ ok: true, msg: r.resumen, notas: r.notas });
        onDone();
      } else {
        setEstado({ ok: false, msg: r.error });
      }
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
      <p className="mt-1 text-sm text-gray-500">{ayuda}</p>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={6}
        placeholder="Pega aquí las filas copiadas de la hoja (incluye los encabezados si quieres, se ignoran)…"
        className="mt-3 w-full rounded-lg border border-gray-300 p-3 font-mono text-xs"
      />

      {vista && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-gray-700">
            Vista previa — {vista.total} fila{vista.total === 1 ? "" : "s"} detectada{vista.total === 1 ? "" : "s"}
            {vista.total > vista.rows.length ? ` (se muestran ${vista.rows.length})` : ""}
          </p>
          <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
                <tr>{vista.cols.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr>
              </thead>
              <tbody>
                {vista.rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {r.map((cell, j) => <td key={j} className="px-3 py-1.5 text-gray-700">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {vista.notas.length > 0 && (
            <details className="mt-2 text-xs text-amber-700">
              <summary className="cursor-pointer">{vista.notas.length} aviso(s) — filas/cuotas omitidas</summary>
              <ul className="mt-1 list-disc pl-5">
                {vista.notas.slice(0, 50).map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={importar}
          disabled={!habilitado || pending || !vista || vista.total === 0}
          style={{ backgroundColor: "var(--brand-primary)" }}
        >
          {pending ? "Importando…" : "Importar"}
        </Button>
        {!habilitado && <span className="text-xs text-red-600">Cambia a la agencia Minorista para habilitar.</span>}
        {estado && (
          <span className={`text-xs ${estado.ok ? "text-[#2f6b54]" : "text-red-600"}`}>
            {estado.ok ? "✓ " : ""}
            {estado.msg}
          </span>
        )}
      </div>

      {estado?.ok && estado.notas && estado.notas.length > 0 && (
        <details className="mt-2 text-xs text-amber-700">
          <summary className="cursor-pointer">{estado.notas.length} aviso(s) durante la importación</summary>
          <ul className="mt-1 list-disc pl-5">
            {estado.notas.slice(0, 50).map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
