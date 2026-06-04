"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { renderEmailHtml } from "@/lib/crm/plantilla-email";
import { enviarCampana, enviarFelicitacionCumple, type EnvioCampanaResult } from "./actions";

export type Campana = {
  id: number; asunto: string; categoria: string | null; tipo: string;
  total: number; enviados: number; fallidos: number; created_at: string;
};

const CATS = [
  { value: "todos", label: "Todos" },
  { value: "cliente_final", label: "Clientes finales" },
  { value: "agencia", label: "Agencias" },
  { value: "freelance", label: "Freelance" },
  { value: "empresa", label: "Empresas" },
  { value: "pasajero", label: "Pasajeros" },
];
const TIPOS_SUGERIDOS = ["Promoción", "Informativa", "Novedad", "Temporada", "Lanzamiento", "Última hora"];
const card = "rounded-xl border border-gray-200 bg-white/90 p-5 backdrop-blur";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

function Resultado({ r }: { r: EnvioCampanaResult | null }) {
  if (!r) return null;
  if (!r.ok) return <span className="text-sm text-red-600">{r.error}</span>;
  return <span className="text-sm text-green-600">✓ Enviados {r.enviados}/{r.total}{r.fallidos ? ` · ${r.fallidos} fallidos` : ""}{r.nota ? ` · ${r.nota}` : ""}</span>;
}

// Subir imagen/flyer al bucket 'crm' → devuelve URL pública.
function ImagenUploader({ url, onChange }: { url: string; onChange: (u: string) => void }) {
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState("");
  async function subir(file: File) {
    setErr(""); setSubiendo(true);
    try {
      const sb = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `campana-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("crm").upload(path, file, { upsert: true });
      if (error) throw error;
      onChange(sb.storage.from("crm").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir.");
    } finally { setSubiendo(false); }
  }
  return (
    <div>
      <label className={lbl}>Imagen / flyer (opcional)</label>
      {url ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="flyer" className="h-24 w-auto rounded-lg border border-gray-200 object-contain" />
          <button type="button" onClick={() => onChange("")} className="text-xs text-gray-400 hover:text-red-500">Quitar</button>
        </div>
      ) : (
        <input type="file" accept="image/*" disabled={subiendo}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }}
          className="block w-full text-xs text-gray-500 file:mr-2 file:rounded-md file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs file:text-gray-700" />
      )}
      {subiendo && <p className="mt-1 text-xs text-gray-400">Subiendo…</p>}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

// Vista previa real (iframe) de cómo llega el correo.
function Preview({ mensaje, imagenUrl, botonTexto, botonUrl }: { mensaje: string; imagenUrl: string; botonTexto?: string; botonUrl?: string }) {
  const html = useMemo(() => renderEmailHtml({
    mensaje: (mensaje || "").replaceAll("{{nombre}}", "Juan"),
    imagenUrl: imagenUrl || null,
    botonTexto: botonTexto || null,
    botonUrl: botonUrl || null,
    remitenteNombre: "D'spacios Travel",
  }, "<i>Aquí va tu firma (Config email)</i>"), [mensaje, imagenUrl, botonTexto, botonUrl]);
  return (
    <div>
      <p className={lbl}>Vista previa (así le llega)</p>
      <iframe title="preview" srcDoc={html} className="h-[420px] w-full rounded-lg border border-gray-200 bg-white" />
    </div>
  );
}

export function CampanaClient({
  porCat, total, cumpleHoy, cumpleMes, campanas,
}: { porCat: Record<string, number>; total: number; cumpleHoy: number; cumpleMes: number; campanas: Campana[] }) {
  return (
    <div className="space-y-6">
      <CampanaForm porCat={porCat} total={total} />
      <CumpleForm cumpleHoy={cumpleHoy} cumpleMes={cumpleMes} />
      <Historial campanas={campanas} />
    </div>
  );
}

function CampanaForm({ porCat, total }: { porCat: Record<string, number>; total: number }) {
  const [tipo, setTipo] = useState("Promoción");
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("Hola {{nombre}},\n\n");
  const [imagenUrl, setImagenUrl] = useState("");
  const [botonTexto, setBotonTexto] = useState("");
  const [botonUrl, setBotonUrl] = useState("");
  const [categoria, setCategoria] = useState("todos");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<EnvioCampanaResult | null>(null);

  const conteo = categoria === "todos" ? total : (porCat[categoria] ?? 0);

  function enviar() {
    setRes(null);
    if (!confirm(`¿Enviar a ${conteo} contacto(s) elegibles de "${categoria}"?`)) return;
    start(async () => setRes(await enviarCampana({ tipo, asunto, mensaje, imagenUrl, botonTexto, botonUrl, categoria })));
  }

  return (
    <section className={card}>
      <p className="mb-3 text-sm font-semibold text-gray-700">Nueva campaña</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Editor */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Tipo de campaña</label>
              <Input list="tipos-campana" value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Promoción, Informativa…" />
              <datalist id="tipos-campana">{TIPOS_SUGERIDOS.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <label className={lbl}>Enviar a (elegibles)</label>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                {CATS.map((c) => <option key={c.value} value={c.value}>{c.label} ({c.value === "todos" ? total : (porCat[c.value] ?? 0)})</option>)}
              </select>
            </div>
          </div>
          <div><label className={lbl}>Asunto</label><Input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="¡Promoción de temporada!" /></div>
          <div>
            <label className={lbl}>Mensaje (escríbelo normal · {"{{nombre}}"} pone el nombre)</label>
            <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={5} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="Hola {{nombre}}, tenemos una promo para ti…" />
          </div>
          <ImagenUploader url={imagenUrl} onChange={setImagenUrl} />
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Botón (texto, opcional)</label><Input value={botonTexto} onChange={(e) => setBotonTexto(e.target.value)} placeholder="Ver promoción" /></div>
            <div><label className={lbl}>Botón (enlace)</label><Input value={botonUrl} onChange={(e) => setBotonUrl(e.target.value)} placeholder="https://…" /></div>
          </div>
        </div>
        {/* Preview */}
        <Preview mensaje={mensaje} imagenUrl={imagenUrl} botonTexto={botonTexto} botonUrl={botonUrl} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={enviar} disabled={pending || conteo === 0} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Enviando…" : `Enviar a ${conteo}`}
        </Button>
        <Resultado r={res} />
      </div>
    </section>
  );
}

function CumpleForm({ cumpleHoy, cumpleMes }: { cumpleHoy: number; cumpleMes: number }) {
  const [asunto, setAsunto] = useState("¡Feliz cumpleaños, {{nombre}}! 🎉");
  const [mensaje, setMensaje] = useState("Hola {{nombre}}, ¡te deseamos un feliz cumpleaños! 🎂\n\nQue tengas un día increíble.");
  const [imagenUrl, setImagenUrl] = useState("");
  const [soloHoy, setSoloHoy] = useState(true);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<EnvioCampanaResult | null>(null);

  const conteo = soloHoy ? cumpleHoy : cumpleMes;

  function enviar() {
    setRes(null);
    if (!confirm(`¿Enviar felicitación a ${conteo} contacto(s)?`)) return;
    start(async () => setRes(await enviarFelicitacionCumple({ asunto, mensaje, imagenUrl, soloHoy })));
  }

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-gray-700">Felicitaciones de cumpleaños</p>
        <span className="rounded-full bg-[var(--brand-highlight)]/30 px-2 py-0.5 text-xs text-gray-700">Hoy: {cumpleHoy}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Este mes: {cumpleMes}</span>
      </div>
      <p className="mb-3 text-xs text-gray-400">Informativo (no venta): respeta &quot;no contactar&quot; pero no exige aceptar publicidad.</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div><label className={lbl}>Asunto</label><Input value={asunto} onChange={(e) => setAsunto(e.target.value)} /></div>
          <div><label className={lbl}>Mensaje</label><textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={3} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" /></div>
          <ImagenUploader url={imagenUrl} onChange={setImagenUrl} />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={soloHoy} onChange={(e) => setSoloHoy(e.target.checked)} /> Solo los de hoy
          </label>
        </div>
        <Preview mensaje={mensaje} imagenUrl={imagenUrl} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={enviar} disabled={pending || conteo === 0} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Enviando…" : `Felicitar a ${conteo}`}
        </Button>
        <Resultado r={res} />
      </div>
    </section>
  );
}

function Historial({ campanas }: { campanas: Campana[] }) {
  if (!campanas.length) return null;
  return (
    <section className={card}>
      <p className="mb-3 text-sm font-semibold text-gray-700">Historial</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="text-left text-xs uppercase text-gray-400">
            <th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Asunto</th><th className="px-2 py-1">Tipo</th>
            <th className="px-2 py-1 text-right">Enviados</th><th className="px-2 py-1 text-right">Fallidos</th>
          </tr></thead>
          <tbody>
            {campanas.map((c) => (
              <tr key={c.id} className="border-t border-gray-50">
                <td className="px-2 py-1 text-gray-500">{c.created_at.slice(0, 10)}</td>
                <td className="px-2 py-1 text-gray-700">{c.asunto}</td>
                <td className="px-2 py-1 text-gray-500">{c.tipo}{c.categoria ? ` · ${c.categoria}` : ""}</td>
                <td className="px-2 py-1 text-right tabular-nums text-green-600">{c.enviados}</td>
                <td className="px-2 py-1 text-right tabular-nums text-red-500">{c.fallidos || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
