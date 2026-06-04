"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
const card = "rounded-xl border border-gray-200 bg-white/90 p-5 backdrop-blur";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

function Resultado({ r }: { r: EnvioCampanaResult | null }) {
  if (!r) return null;
  if (!r.ok) return <span className="text-sm text-red-600">{r.error}</span>;
  return <span className="text-sm text-green-600">✓ Enviados {r.enviados}/{r.total}{r.fallidos ? ` · ${r.fallidos} fallidos` : ""}{r.nota ? ` · ${r.nota}` : ""}</span>;
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
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("<p>Hola {{nombre}},</p>\n<p>…</p>");
  const [categoria, setCategoria] = useState("todos");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<EnvioCampanaResult | null>(null);

  const conteo = categoria === "todos" ? total : (porCat[categoria] ?? 0);

  function enviar() {
    setRes(null);
    if (!confirm(`¿Enviar a ${conteo} contacto(s) elegibles de "${categoria}"?`)) return;
    start(async () => setRes(await enviarCampana({ asunto, cuerpoHtml: cuerpo, categoria })));
  }

  return (
    <section className={card}>
      <p className="mb-3 text-sm font-semibold text-gray-700">Nueva campaña</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2"><label className={lbl}>Asunto</label><Input value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="¡Promoción de temporada!" /></div>
        <div>
          <label className={lbl}>Destinatarios (elegibles)</label>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {CATS.map((c) => <option key={c.value} value={c.value}>{c.label} ({c.value === "todos" ? total : (porCat[c.value] ?? 0)})</option>)}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <label className={lbl}>Cuerpo (HTML · usa {"{{nombre}}"} para personalizar)</label>
        <textarea value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} rows={7} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
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
  const [cuerpo, setCuerpo] = useState("<p>Hola {{nombre}}, ¡te deseamos un feliz cumpleaños! 🎂</p>");
  const [soloHoy, setSoloHoy] = useState(true);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<EnvioCampanaResult | null>(null);

  const conteo = soloHoy ? cumpleHoy : cumpleMes;

  function enviar() {
    setRes(null);
    if (!confirm(`¿Enviar felicitación a ${conteo} contacto(s)?`)) return;
    start(async () => setRes(await enviarFelicitacionCumple({ asunto, cuerpoHtml: cuerpo, soloHoy })));
  }

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-gray-700">Felicitaciones de cumpleaños</p>
        <span className="rounded-full bg-[var(--brand-highlight)]/30 px-2 py-0.5 text-xs text-gray-700">Hoy: {cumpleHoy}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Este mes: {cumpleMes}</span>
      </div>
      <p className="mb-3 text-xs text-gray-400">Informativo (no venta): respeta &quot;no contactar&quot; pero no exige aceptar publicidad.</p>
      <div className="grid grid-cols-1 gap-3">
        <div><label className={lbl}>Asunto</label><Input value={asunto} onChange={(e) => setAsunto(e.target.value)} /></div>
        <div><label className={lbl}>Mensaje (HTML)</label><textarea value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} rows={3} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs" /></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={soloHoy} onChange={(e) => setSoloHoy(e.target.checked)} /> Solo los de hoy
        </label>
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
