"use client";
// Selector con búsqueda y escritura libre (#82): se escoge una opción existente o se escribe una nueva que vale solo para este paquete.
// El texto del campo ES el valor (lo escrito ya queda aplicado); al salir se normaliza (espacios, y la escritura de una opción conocida si coincide).
// Teclado: ↓/↑ recorren, Enter elige la resaltada (o deja lo escrito si no hay ninguna), Escape cierra la lista sin cerrar la ventana. Móvil: filas de 44 px.
import { useId, useRef, useState } from "react";
import { filtrarOpciones, MAX_OPCION_HOTEL, normalizarOpcionHotel } from "@/lib/paqueteDinamico/opcionesHotel";

export function ComboCreable({ opciones, value, onChange, etiqueta, placeholder = "Busca o escribe…" }: {
  opciones: readonly string[]; value: string; onChange: (v: string) => void; etiqueta: string; placeholder?: string;
}) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [abierta, setAbierta] = useState(false);
  const [act, setAct] = useState(-1);
  // Al abrir se ven TODAS las opciones; recién al escribir se filtra por lo escrito.
  const [tecleado, setTecleado] = useState(false);
  const filtradas = tecleado ? filtrarOpciones(opciones, value) : [...opciones];
  const texto = value.replace(/\s+/g, " ").trim();
  const exacta = !tecleado || !!texto && opciones.some((o) => normalizarOpcionHotel(texto, [o]) === o);
  // Filas: las coincidencias y, si lo escrito no existe, «Usar … (nuevo)».
  const filas = [...filtradas.map((o) => ({ tipo: "op" as const, v: o })), ...(tecleado && texto && !exacta ? [{ tipo: "nuevo" as const, v: texto }] : [])];
  const a = Math.min(act, filas.length - 1);

  const elegir = (v: string) => { onChange(v); setAbierta(false); setAct(-1); setTecleado(false); };
  const cerrarNormalizando = () => { onChange(normalizarOpcionHotel(value, opciones)); setAbierta(false); setAct(-1); setTecleado(false); };

  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) cerrarNormalizando(); }}>
      <input
        role="combobox" aria-label={etiqueta} aria-expanded={abierta} aria-autocomplete="list" aria-controls={`${uid}-lista`}
        aria-activedescendant={abierta && a >= 0 ? `${uid}-f${a}` : undefined}
        autoComplete="off" enterKeyHint="done" maxLength={MAX_OPCION_HOTEL + 20}
        className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm"
        value={value} placeholder={placeholder}
        // Abrir por el foco NO: el diálogo enfoca este campo al abrirse y su lista taparía los demás. Se abre con clic/toque, al escribir o con ↓.
        onFocus={() => setTecleado(false)}
        // El diálogo enfoca este campo al abrirse: un clic debe poder abrir la lista aunque ya tenga el foco.
        onClick={() => { if (!abierta) { setAbierta(true); setTecleado(false); } }}
        onChange={(x) => { onChange(x.target.value); setAbierta(true); setAct(-1); setTecleado(true); }}
        onKeyDown={(x) => {
          if (x.key === "ArrowDown") { x.preventDefault(); setAbierta(true); setAct(filas.length ? (a + 1) % filas.length : -1); }
          else if (x.key === "ArrowUp") { x.preventDefault(); setAbierta(true); setAct(filas.length ? (a <= 0 ? filas.length - 1 : a - 1) : -1); }
          else if (x.key === "Enter") { if (abierta) { x.preventDefault(); if (a >= 0) elegir(filas[a].v); else cerrarNormalizando(); } }
          else if (x.key === "Escape" && abierta) { x.preventDefault(); x.stopPropagation(); setAbierta(false); setAct(-1); setTecleado(false); }
        }}
      />
      {abierta && filas.length > 0 && (
        <ul id={`${uid}-lista`} role="listbox" aria-label={etiqueta} className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {filas.map((f, i) => (
            <li key={`${f.tipo}-${f.v}`} id={`${uid}-f${i}`} role="option" aria-selected={f.v === value} data-nuevo={f.tipo === "nuevo" ? "1" : undefined}
              className={`flex min-h-11 cursor-pointer items-center px-3 text-sm [overflow-wrap:anywhere] ${i === a ? "bg-gray-100" : "hover:bg-gray-50"} ${f.tipo === "nuevo" ? "font-medium text-[var(--brand-primary)]" : "text-gray-700"}`}
              onMouseDown={(x) => { x.preventDefault(); elegir(f.v); }}>
              {f.tipo === "nuevo" ? `Usar «${f.v}» (nuevo, solo en este paquete)` : f.v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
