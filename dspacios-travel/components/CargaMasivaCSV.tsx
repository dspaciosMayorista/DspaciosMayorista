"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export type Columna = { key: string; label: string; ejemplo: string };
export type ResultadoCarga = { ok: boolean; insertados: number; errores: string[] };

// Parser CSV mínimo: soporta comillas, comas/punto y coma, y saltos de línea dentro de comillas.
function parseCSV(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = ""; rows.push(row); row = [];
    } else if (c === "\r") {
      // ignora
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");

export function CargaMasivaCSV({
  titulo, descripcion, columnas, onSubmit, nombreArchivo,
}: {
  titulo: string;
  descripcion?: string;
  columnas: Columna[];
  onSubmit: (rows: Record<string, string>[]) => Promise<ResultadoCarga>;
  nombreArchivo: string;
}) {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [filas, setFilas] = useState<Record<string, string>[]>([]);
  const [errParse, setErrParse] = useState("");
  const [res, setRes] = useState<ResultadoCarga | null>(null);
  const [pending, start] = useTransition();

  function descargarPlantilla() {
    const SEP = ";";
    const header = columnas.map((c) => c.key).join(SEP);
    const ejemplo = columnas.map((c) => c.ejemplo).join(SEP);
    // "sep=;" obliga a Excel a abrir el archivo separado por columnas (cualquier locale).
    const contenido = "﻿sep=;\n" + header + "\n" + ejemplo + "\n";
    const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${nombreArchivo}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function procesar(raw: string) {
    setRes(null); setErrParse("");
    const text = raw.replace(/^﻿/, "").trim();
    if (!text) { setFilas([]); return; }
    let lineas = text.split("\n");
    let delim = "";
    // Soporta la línea "sep=;" (Excel) al inicio
    if (lineas[0].trim().toLowerCase().startsWith("sep=")) {
      delim = lineas[0].trim().slice(4).charAt(0) || ";";
      lineas = lineas.slice(1);
    }
    if (!delim) {
      const primera = lineas[0] ?? "";
      delim = primera.split(";").length > primera.split(",").length ? ";" : ",";
    }
    const matriz = parseCSV(lineas.join("\n"), delim);
    if (matriz.length < 2) { setErrParse("El archivo necesita una fila de encabezados y al menos una fila de datos."); setFilas([]); return; }
    const header = matriz[0].map(norm);
    // Mapea cada columna esperada a su índice (por key o por label)
    const idx: Record<string, number> = {};
    for (const c of columnas) {
      let pos = header.indexOf(norm(c.key));
      if (pos < 0) pos = header.indexOf(norm(c.label));
      idx[c.key] = pos;
    }
    const out: Record<string, string>[] = [];
    for (let r = 1; r < matriz.length; r++) {
      const obj: Record<string, string> = {};
      for (const c of columnas) obj[c.key] = idx[c.key] >= 0 ? (matriz[r][idx[c.key]] ?? "").trim() : "";
      out.push(obj);
    }
    setFilas(out);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const t = String(reader.result ?? ""); setTexto(t); procesar(t); };
    reader.readAsText(file, "UTF-8");
  }

  function subir() {
    setRes(null);
    start(async () => {
      const r = await onSubmit(filas);
      setRes(r);
      if (r.ok) { setFilas([]); setTexto(""); }
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">{titulo}</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          {descripcion && <p className="text-xs text-gray-500">{descripcion}</p>}
          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            <p className="mb-1 font-medium">Columnas (en este orden, con encabezado en la 1ª fila):</p>
            <code className="block break-words">{columnas.map((c) => c.key).join(" · ")}</code>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={descargarPlantilla}>Descargar plantilla CSV</Button>
            <label className="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Subir archivo CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
          </div>
          <div>
            <p className="mb-1 text-xs text-gray-500">…o pega el contenido del CSV aquí:</p>
            <textarea
              value={texto}
              onChange={(e) => { setTexto(e.target.value); procesar(e.target.value); }}
              rows={4}
              className="w-full rounded-lg border border-gray-300 p-2 font-mono text-xs"
              placeholder={columnas.map((c) => c.key).join(";")}
            />
          </div>
          {errParse && <p className="text-sm text-red-600">{errParse}</p>}
          {filas.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">{filas.length} fila(s) listas</span>
              <Button onClick={subir} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
                {pending ? "Subiendo…" : `Subir ${filas.length} fila(s)`}
              </Button>
            </div>
          )}
          {res && (
            <div className={`rounded-lg p-3 text-sm ${res.ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
              <p><b>{res.insertados}</b> registro(s) cargado(s).</p>
              {res.errores.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {res.errores.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  {res.errores.length > 20 && <li>… y {res.errores.length - 20} más</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
