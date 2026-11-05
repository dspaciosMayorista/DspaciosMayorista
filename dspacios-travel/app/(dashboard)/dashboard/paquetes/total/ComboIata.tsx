"use client";
// Selector de código IATA del vuelo manual (#82): busca en el catálogo (`lib/iata.ts`) por CÓDIGO o por CIUDAD y deja ESCRIBIR cualquier código válido de 3 letras
// aunque no esté en el catálogo. El valor del formulario es siempre el código ("" si lo escrito no resuelve a uno: nunca se adivina).
// Teclado: ↓/↑ recorren, Enter elige la resaltada o confirma lo escrito, Escape cierra la lista sin cerrar la ventana. La lista se abre con clic/toque, al escribir o con ↓.
import { useId, useRef, useState } from "react";
import { etiquetaIata } from "@/lib/iata";
import { buscarIata, normalizarIata, resolverIata } from "@/lib/paqueteDinamico/ruta";

export function ComboIata({ value, onChange, etiqueta }: { value: string; onChange: (codigo: string) => void; etiqueta: string }) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState(false);
  const [abierta, setAbierta] = useState(false);
  const [act, setAct] = useState(-1);
  // Mientras se edita (o si lo escrito no resolvió a un código) se muestra lo escrito; si no, «Ciudad (COD)» del valor guardado.
  const mostrado = editando || !value ? texto : etiquetaIata(value);
  const coincidencias = buscarIata(editando ? texto : "");
  const libre = editando ? normalizarIata(texto) : "";
  const filas = [
    ...coincidencias.map((o) => ({ codigo: o.codigo, texto: o.etiqueta, nuevo: false })),
    ...(libre && !coincidencias.some((o) => o.codigo === libre) ? [{ codigo: libre, texto: `Usar el código «${libre}»`, nuevo: true }] : []),
  ];
  const a = Math.min(act, filas.length - 1);

  const elegir = (codigo: string) => { onChange(codigo); setTexto(etiquetaIata(codigo)); setEditando(false); setAbierta(false); setAct(-1); };
  const confirmar = () => { const c = resolverIata(texto); if (texto.trim()) { onChange(c); if (c) setTexto(etiquetaIata(c)); } setEditando(false); setAbierta(false); setAct(-1); };
  const invalido = !editando && !!texto.trim() && !value;

  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) { if (editando) confirmar(); else setAbierta(false); } }}>
      <input
        role="combobox" aria-label={etiqueta} aria-expanded={abierta} aria-autocomplete="list" aria-controls={`${uid}-lista`} aria-invalid={invalido || undefined}
        aria-activedescendant={abierta && a >= 0 ? `${uid}-f${a}` : undefined}
        autoComplete="off" autoCapitalize="characters" enterKeyHint="done" maxLength={40} placeholder="Ciudad o código (ej. CTG)"
        className={`h-9 w-full rounded-md border bg-white px-2 text-sm ${invalido ? "border-red-400" : "border-gray-200"}`}
        value={mostrado}
        onClick={() => { if (!abierta) { setAbierta(true); if (!editando) { setTexto(""); setEditando(true); } } }}
        onChange={(x) => { setTexto(x.target.value); setEditando(true); setAbierta(true); setAct(-1); const c = resolverIata(x.target.value); if (c !== value) onChange(c); }}
        onKeyDown={(x) => {
          if (x.key === "ArrowDown") { x.preventDefault(); if (!editando) { setTexto(""); setEditando(true); } setAbierta(true); setAct(filas.length ? (a + 1) % filas.length : -1); }
          else if (x.key === "ArrowUp") { x.preventDefault(); setAbierta(true); setAct(filas.length ? (a <= 0 ? filas.length - 1 : a - 1) : -1); }
          else if (x.key === "Enter") { if (abierta || editando) { x.preventDefault(); if (a >= 0 && abierta) elegir(filas[a].codigo); else confirmar(); } }
          else if (x.key === "Escape" && abierta) { x.preventDefault(); x.stopPropagation(); setAbierta(false); setAct(-1); if (editando) confirmar(); }
        }}
      />
      {invalido && <p role="alert" className="mt-1 text-xs text-red-600">Elige una ciudad de la lista o escribe un código IATA de 3 letras.</p>}
      {abierta && filas.length > 0 && (
        <ul id={`${uid}-lista`} role="listbox" aria-label={etiqueta} className="absolute z-30 mt-1 max-h-52 w-full min-w-48 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {filas.map((f, i) => (
            <li key={f.codigo} id={`${uid}-f${i}`} role="option" aria-selected={f.codigo === value} data-codigo={f.codigo}
              className={`flex min-h-11 cursor-pointer items-center px-3 text-sm [overflow-wrap:anywhere] ${i === a ? "bg-gray-100" : "hover:bg-gray-50"} ${f.nuevo ? "font-medium text-[var(--brand-primary)]" : "text-gray-700"}`}
              onMouseDown={(x) => { x.preventDefault(); elegir(f.codigo); }}>
              {f.texto}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
