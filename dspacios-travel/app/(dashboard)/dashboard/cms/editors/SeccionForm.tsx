"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarSeccion } from "../actions";
import { SubirArchivo } from "./SubirArchivo";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const ta = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

type Datos = Record<string, unknown>;

// Convierte un array de strings ↔ textarea (una línea por ítem).
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function lineasToArr(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ── Editor de items {titulo, texto, icono?} para Experiencias ──
type Item = { titulo: string; texto: string; icono?: string };
const ICONOS = [
  "headphones",
  "shield",
  "globe",
  "lock",
  "corazon",
  "award",
  "star",
  "compass",
  "plane",
  "map",
];

export function SeccionForm({
  seccionId,
  tipo,
  datosIniciales,
  onSaved,
}: {
  seccionId: number;
  tipo: string;
  datosIniciales: Datos;
  onSaved?: () => void;
}) {
  const [datos, setDatos] = useState<Datos>(datosIniciales ?? {});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  // Re-sincroniza cuando cambia la sección seleccionada.
  useEffect(() => {
    setDatos(datosIniciales ?? {});
    setMsg("");
    setErr("");
  }, [seccionId, datosIniciales]);

  const s = (k: string) => (typeof datos[k] === "string" ? (datos[k] as string) : "");
  const set = (k: string, v: unknown) => setDatos((d) => ({ ...d, [k]: v }));

  function guardar() {
    setMsg("");
    setErr("");
    start(async () => {
      const r = await actualizarSeccion(seccionId, datos);
      if (r.ok) {
        setMsg("Sección guardada.");
        onSaved?.();
      } else setErr(r.error);
    });
  }

  return (
    <div className="space-y-3">
      {tipo === "hero" && (
        <>
          <Field label="Título">
            <Input value={s("titulo")} onChange={(e) => set("titulo", e.target.value)} />
          </Field>
          <Field label="Subtítulo">
            <textarea className={ta} rows={2} value={s("subtitulo")} onChange={(e) => set("subtitulo", e.target.value)} />
          </Field>
          <Field label="Imagen de fondo (URL)">
            <Input value={s("imagen")} onChange={(e) => set("imagen", e.target.value)} placeholder="https://…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CTA — texto del botón">
              <Input value={s("cta_texto")} onChange={(e) => set("cta_texto", e.target.value)} placeholder="Ver Tarifario" />
            </Field>
            <Field label="CTA — URL del botón">
              <Input value={s("cta_url")} onChange={(e) => set("cta_url", e.target.value)} placeholder="/tarifario" />
            </Field>
          </div>
        </>
      )}

      {tipo === "texto" && (
        <>
          <Field label="Título">
            <Input value={s("titulo")} onChange={(e) => set("titulo", e.target.value)} />
          </Field>
          <Field label="Cuerpo">
            <textarea className={ta} rows={6} value={s("cuerpo")} onChange={(e) => set("cuerpo", e.target.value)} />
          </Field>
        </>
      )}

      {tipo === "galeria" && (
        <>
          <Field label="Título (opcional)">
            <Input value={s("titulo")} onChange={(e) => set("titulo", e.target.value)} />
          </Field>
          <Field label="Imágenes (una URL por línea)">
            <textarea
              className={ta}
              rows={6}
              value={arr(datos.imagenes).join("\n")}
              onChange={(e) => set("imagenes", lineasToArr(e.target.value))}
              placeholder={"https://…\nhttps://…"}
            />
          </Field>
        </>
      )}

      {tipo === "cta" && (
        <>
          <Field label="Título">
            <Input value={s("titulo")} onChange={(e) => set("titulo", e.target.value)} />
          </Field>
          <Field label="Texto">
            <textarea className={ta} rows={3} value={s("texto")} onChange={(e) => set("texto", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Botón — texto">
              <Input value={s("boton_texto")} onChange={(e) => set("boton_texto", e.target.value)} placeholder="Ver Tarifario" />
            </Field>
            <Field label="Botón — URL">
              <Input value={s("boton_url")} onChange={(e) => set("boton_url", e.target.value)} placeholder="/tarifario" />
            </Field>
          </div>
        </>
      )}

      {tipo === "contacto" && (
        <>
          <Field label="Título">
            <Input value={s("titulo")} onChange={(e) => set("titulo", e.target.value)} />
          </Field>
          <Field label="Texto">
            <textarea className={ta} rows={3} value={s("texto")} onChange={(e) => set("texto", e.target.value)} />
          </Field>
          <p className="text-xs text-gray-400">
            Los datos de contacto (dirección, teléfono, email) salen de la Configuración global.
          </p>
        </>
      )}

      {(tipo === "destinos_grid" ||
        tipo === "testimonios" ||
        tipo === "blog_grid") && (
        <>
          <Field label="Título">
            <Input value={s("titulo")} onChange={(e) => set("titulo", e.target.value)} />
          </Field>
          <Field label="Subtítulo">
            <textarea className={ta} rows={2} value={s("subtitulo")} onChange={(e) => set("subtitulo", e.target.value)} />
          </Field>
          <p className="text-xs text-gray-400">
            {tipo === "destinos_grid"
              ? "El contenido se arma automáticamente con las subpáginas de esta página (o los destinos del sitio)."
              : tipo === "testimonios"
                ? "Las tarjetas se llenan con los testimonios (pestaña Testimonios)."
                : "Las tarjetas se llenan con los artículos del blog (pestaña Blog)."}
          </p>
        </>
      )}

      {tipo === "experiencias" && (
        <>
          <Field label="Título">
            <Input value={s("titulo")} onChange={(e) => set("titulo", e.target.value)} />
          </Field>
          <Field label="Subtítulo">
            <textarea className={ta} rows={2} value={s("subtitulo")} onChange={(e) => set("subtitulo", e.target.value)} />
          </Field>
          <ItemsEditor
            items={(Array.isArray(datos.items) ? datos.items : []) as Item[]}
            onChange={(items) => set("items", items)}
          />
        </>
      )}

      {tipo === "actividades" && (
        <>
          <Field label="Título">
            <Input
              value={s("titulo")}
              onChange={(e) => set("titulo", e.target.value)}
              placeholder="Actividades Imperdibles"
            />
          </Field>
          <Field label="Intro (opcional)">
            <textarea className={ta} rows={2} value={s("intro")} onChange={(e) => set("intro", e.target.value)} />
          </Field>
          <Field label="Imagen de fondo (opcional)">
            <SubirArchivo
              value={s("imagen_fondo")}
              onChange={(url) => set("imagen_fondo", url)}
              carpeta="img"
              accept="image/*"
            />
          </Field>
          <ActividadesItemsEditor
            items={(Array.isArray(datos.items) ? datos.items : []) as ActItem[]}
            onChange={(items) => set("items", items)}
          />
        </>
      )}

      {tipo === "plan" && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Título — incluye">
              <Input
                value={s("incluye_titulo")}
                onChange={(e) => set("incluye_titulo", e.target.value)}
                placeholder="El plan incluye:"
              />
            </Field>
            <Field label="Título — no incluye">
              <Input
                value={s("no_incluye_titulo")}
                onChange={(e) => set("no_incluye_titulo", e.target.value)}
                placeholder="El Plan no Incluye:"
              />
            </Field>
          </div>
          <Field label="Incluye (una viñeta por línea)">
            <textarea
              className={ta}
              rows={5}
              value={arr(datos.incluye).join("\n")}
              onChange={(e) => set("incluye", lineasToArr(e.target.value))}
            />
          </Field>
          <Field label="No incluye (una viñeta por línea)">
            <textarea
              className={ta}
              rows={5}
              value={arr(datos.no_incluye).join("\n")}
              onChange={(e) => set("no_incluye", lineasToArr(e.target.value))}
            />
          </Field>
        </>
      )}

      {tipo === "flyers" && (
        <>
          <Field label="Título (opcional)">
            <Input value={s("titulo")} onChange={(e) => set("titulo", e.target.value)} />
          </Field>
          <FlyersItemsEditor
            items={(Array.isArray(datos.items) ? datos.items : []) as FlyerItem[]}
            onChange={(items) => set("items", items)}
          />
        </>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)", color: "white" }}>
          {pending ? "…" : "Guardar sección"}
        </Button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={lbl}>{label}</label>
      {children}
    </div>
  );
}

function ItemsEditor({
  items,
  onChange,
}: {
  items: Item[];
  onChange: (items: Item[]) => void;
}) {
  const lista = items.map((it) => ({
    titulo: typeof it?.titulo === "string" ? it.titulo : "",
    texto: typeof it?.texto === "string" ? it.texto : "",
    icono: typeof it?.icono === "string" ? it.icono : "",
  }));

  function upd(i: number, patch: Partial<Item>) {
    const next = lista.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function add() {
    onChange([...lista, { titulo: "", texto: "", icono: "compass" }]);
  }
  function del(i: number) {
    onChange(lista.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-2">
      <label className={lbl}>Tarjetas (¿por qué elegirnos?)</label>
      {lista.length === 0 && (
        <p className="text-xs text-gray-400">
          Sin tarjetas: se mostrarán las predeterminadas. Agrega para personalizar.
        </p>
      )}
      {lista.map((it, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Input value={it.titulo} onChange={(e) => upd(i, { titulo: e.target.value })} placeholder="Título" />
            <select
              className={ta}
              value={it.icono}
              onChange={(e) => upd(i, { icono: e.target.value })}
            >
              <option value="">(ícono)</option>
              {ICONOS.map((ic) => (
                <option key={ic} value={ic}>
                  {ic}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => del(i)}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              Eliminar tarjeta
            </button>
          </div>
          <textarea
            className={`${ta} mt-2`}
            rows={2}
            value={it.texto}
            onChange={(e) => upd(i, { texto: e.target.value })}
            placeholder="Texto"
          />
        </div>
      ))}
      <Button type="button" variant="outline" onClick={add}>
        + Agregar tarjeta
      </Button>
    </div>
  );
}

// ── Editor de items {titulo, texto} para Actividades ──
type ActItem = { titulo: string; texto: string };
function ActividadesItemsEditor({
  items,
  onChange,
}: {
  items: ActItem[];
  onChange: (items: ActItem[]) => void;
}) {
  const lista = items.map((it) => ({
    titulo: typeof it?.titulo === "string" ? it.titulo : "",
    texto: typeof it?.texto === "string" ? it.texto : "",
  }));
  function upd(i: number, patch: Partial<ActItem>) {
    const next = lista.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const next = lista.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  return (
    <div className="space-y-2">
      <label className={lbl}>Actividades (numeradas)</label>
      {lista.map((it, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-500">{i + 1}.</span>
            <Input value={it.titulo} onChange={(e) => upd(i, { titulo: e.target.value })} placeholder="Título de la actividad" />
            <button type="button" onClick={() => mover(i, -1)} className="text-xs text-gray-400 hover:text-gray-700">↑</button>
            <button type="button" onClick={() => mover(i, 1)} className="text-xs text-gray-400 hover:text-gray-700">↓</button>
            <button type="button" onClick={() => onChange(lista.filter((_, j) => j !== i))} className="text-xs text-gray-400 hover:text-red-500">✕</button>
          </div>
          <textarea
            className={`${ta} mt-2`}
            rows={2}
            value={it.texto}
            onChange={(e) => upd(i, { texto: e.target.value })}
            placeholder="Descripción"
          />
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => onChange([...lista, { titulo: "", texto: "" }])}>
        + Agregar actividad
      </Button>
    </div>
  );
}

// ── Editor de items {titulo, tipo, url} para Flyers ──
type FlyerItem = { titulo: string; tipo: "imagen" | "pdf"; url: string };
function FlyersItemsEditor({
  items,
  onChange,
}: {
  items: FlyerItem[];
  onChange: (items: FlyerItem[]) => void;
}) {
  const lista = items.map((it) => ({
    titulo: typeof it?.titulo === "string" ? it.titulo : "",
    tipo: it?.tipo === "pdf" ? ("pdf" as const) : ("imagen" as const),
    url: typeof it?.url === "string" ? it.url : "",
  }));
  function upd(i: number, patch: Partial<FlyerItem>) {
    const next = lista.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const next = lista.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  return (
    <div className="space-y-2">
      <label className={lbl}>Flyers (botón + modal). URL admite link de Drive o archivo subido.</label>
      {lista.map((it, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input value={it.titulo} onChange={(e) => upd(i, { titulo: e.target.value })} placeholder="Título del botón (ej. Temporada Alta)" />
            <select className={ta} style={{ width: "auto" }} value={it.tipo} onChange={(e) => upd(i, { tipo: e.target.value as "imagen" | "pdf" })}>
              <option value="imagen">Imagen</option>
              <option value="pdf">PDF</option>
            </select>
            <button type="button" onClick={() => mover(i, -1)} className="text-xs text-gray-400 hover:text-gray-700">↑</button>
            <button type="button" onClick={() => mover(i, 1)} className="text-xs text-gray-400 hover:text-gray-700">↓</button>
            <button type="button" onClick={() => onChange(lista.filter((_, j) => j !== i))} className="text-xs text-gray-400 hover:text-red-500">✕</button>
          </div>
          <SubirArchivo
            value={it.url}
            onChange={(url) => upd(i, { url })}
            carpeta="flyers"
            accept={it.tipo === "pdf" ? "application/pdf" : "image/*"}
          />
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => onChange([...lista, { titulo: "", tipo: "imagen", url: "" }])}>
        + Agregar flyer
      </Button>
    </div>
  );
}
