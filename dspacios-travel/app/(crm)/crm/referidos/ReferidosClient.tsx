"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Hourglass, Link2, Plus, Unlink, UserPlus } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { ETIQUETA_ESTADO, PCT_REFERIDO, esEstadoReferido, formatPct } from "@/lib/referidos/reglas";
import type { Asignacion, ContratoReferido, Referidor, Resultado } from "@/lib/referidos/servidor";
import { aplicarCodigoAction, asignarReferidoAction, definirCodigoAction, guardarReferidorAction, quitarReferidoAction } from "./actions";

type AliadoOpt = { id: number; nombre: string; tipo: string | null };
const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const boton = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", year: "numeric" }) : "—");
const TONO: Record<string, string> = { ok: "bg-emerald-50 text-emerald-700", espera: "bg-amber-50 text-amber-700", neutro: "bg-gray-100 text-gray-600", aviso: "bg-sky-50 text-sky-700" };

function EstadoBadge({ estado }: { estado: string }) {
  const e = esEstadoReferido(estado) ? ETIQUETA_ESTADO[estado] : null;
  if (!e) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{estado}</span>;
  const Icono = estado === "elegible" ? Check : Hourglass;
  return <span title={e.ayuda} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONO[e.tono]}`}><Icono size={12} aria-hidden /> {e.texto}</span>;
}

export function ReferidosClient({ gestiona, referidores, asignaciones, contratos, aliados, hayMas, error }: {
  gestiona: boolean; referidores: Referidor[]; asignaciones: Asignacion[]; contratos: ContratoReferido[]; aliados: AliadoOpt[]; hayMas: boolean; error: string | null;
}) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const correr = (fn: () => Promise<Resultado>, bien: (estado: string) => string, limpiar?: () => void) => start(async () => {
    setMsg(null);
    const r = await fn();
    if (r.ok) { setMsg({ ok: true, texto: bien(r.estado) }); limpiar?.(); router.refresh(); } else setMsg({ ok: false, texto: r.error });
  });
  const activos = referidores.filter((r) => r.activo);
  const vigentes = asignaciones.filter((a) => !a.vigente_hasta);
  const historial = asignaciones.filter((a) => a.vigente_hasta);

  // Totales por moneda de lo CARGADO (nunca se mezclan monedas).
  const totales = contratos.reduce<Record<string, { pagable: number; pendiente: number }>>((acc, c) => {
    if (c.comision === null) return acc;   // sin evidencia de la base: no suma nada ni abre un total en cero
    const t = (acc[c.moneda] ??= { pagable: 0, pendiente: 0 });
    if (c.estado === "elegible") t.pagable += c.comision; else if (c.estado === "pendiente_pago") t.pendiente += c.comision;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {msg && <p role="status" className={`rounded-lg px-4 py-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}

      <section aria-labelledby="ref-contratos">
        <h2 id="ref-contratos" className="text-lg font-semibold text-gray-900">Contratos con participación de referido</h2>
        <p className="mt-1 text-sm text-gray-500">Cada contrato guarda el referidor y el porcentaje que regían cuando se creó. La participación se calcula sobre EXACTAMENTE la misma base con la que se calculó la comisión del aliado (en un contrato NETO, la base original antes de descontar esa comisión) y solo es pagable con el contrato 100 % pagado; no se paga automáticamente.</p>
        {Object.keys(totales).length > 0 && (
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(totales).map(([moneda, t]) => (
              <div key={moneda} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{moneda}</dt>
                <dd className="mt-1 text-sm text-gray-700"><span className="font-semibold text-emerald-700">{formatMoneda(t.pagable, moneda)}</span> pagable · <span className="font-semibold text-amber-700">{formatMoneda(t.pendiente, moneda)}</span> pendiente del pago del contrato</dd>
              </div>
            ))}
          </dl>
        )}
        {contratos.length === 0 ? (
          <p className="mt-3 rounded-lg bg-white px-4 py-6 text-center text-sm text-gray-500">Aún no hay contratos con referido: solo las compras posteriores a una asignación se atribuyen.</p>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr>
                  <th className="px-3 py-2">Contrato</th><th className="px-3 py-2">Referidor</th><th className="px-3 py-2">Aliado referido</th><th className="px-3 py-2">%</th><th className="px-3 py-2 text-right">Base</th><th className="px-3 py-2 text-right">Participación</th><th className="px-3 py-2">Estado</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {contratos.map((c) => (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium"><a href={`/dashboard/contratos/${encodeURIComponent(c.numero_contrato)}`} className="text-[var(--brand-primary)] hover:underline">{c.numero_contrato}</a><div className="text-[11px] font-normal text-gray-400">{c.tenant}</div></td>
                      <td className="px-3 py-2">{c.referidor_nombre}</td>
                      <td className="px-3 py-2">{c.aliado_nombre}<div className="text-[11px] text-gray-400">{c.origen === "codigo" ? `por código ${c.codigo}` : "asignación manual"}</div></td>
                      <td className="px-3 py-2 tabular-nums">{formatPct(c.pct)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{c.base === null ? "—" : formatMoneda(c.base, c.moneda)}{c.neto && <div className="text-[11px] font-normal text-sky-700">NETO · base original</div>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{c.comision === null ? <span className="text-xs font-normal text-sky-700">Sin evidencia</span> : formatMoneda(c.comision, c.moneda)}</td>
                      <td className="px-3 py-2"><EstadoBadge estado={c.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-3 space-y-2 md:hidden">
              {contratos.map((c) => (
                <li key={c.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <a href={`/dashboard/contratos/${encodeURIComponent(c.numero_contrato)}`} className="font-semibold text-[var(--brand-primary)]">{c.numero_contrato}</a>
                    <EstadoBadge estado={c.estado} />
                  </div>
                  <p className="mt-1 text-gray-700">{c.referidor_nombre} <span className="text-gray-400">→</span> {c.aliado_nombre}</p>
                  <p className="text-xs text-gray-500">{formatPct(c.pct)} de {c.base === null ? "—" : formatMoneda(c.base, c.moneda)}{c.neto ? " (NETO · base original)" : ""} · {c.origen === "codigo" ? `código ${c.codigo}` : "asignación manual"}</p>
                  <p className="mt-1 text-base font-semibold tabular-nums text-gray-900">{c.comision === null ? <span className="text-sm font-normal text-sky-700">Sin evidencia de la base</span> : formatMoneda(c.comision, c.moneda)}</p>
                </li>
              ))}
            </ul>
            {hayMas && <p className="mt-2 text-xs text-gray-500">Se muestran los contratos más recientes; hay más. Filtra por referidor o estado para acotar.</p>}
          </>
        )}
      </section>

      <section aria-labelledby="ref-asig">
        <h2 id="ref-asig" className="text-lg font-semibold text-gray-900">Asignaciones vigentes</h2>
        <p className="mt-1 text-sm text-gray-500">Rigen para las compras futuras del aliado hasta que se cambien o terminen. Cambiarlas no modifica contratos ya atribuidos.</p>
        {vigentes.length === 0 ? <p className="mt-3 rounded-lg bg-white px-4 py-6 text-center text-sm text-gray-500">Ningún aliado tiene referidor asignado.</p> : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {vigentes.map((a) => (
              <li key={a.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold text-gray-900">{a.aliado_nombre}</div><div className="text-gray-600">referido por {a.referidor_nombre}</div></div>
                  <span className="shrink-0 rounded-full bg-[var(--brand-primary)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--brand-primary)]">{formatPct(a.pct)}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{a.tenant} · desde {fecha(a.vigente_desde)} · {a.origen === "codigo" ? `código ${a.codigo}` : "asignación manual"}</p>
                {gestiona && (
                  <button type="button" disabled={pend} onClick={() => correr(() => quitarReferidoAction({ aliadoId: a.aliado_id, tenant: a.tenant }), () => "Asignación terminada: las compras futuras ya no generan participación.")}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline disabled:opacity-50"><Unlink size={13} aria-hidden /> Terminar asignación</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {historial.length > 0 && (
          <details className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-sm">
            <summary className="cursor-pointer font-medium text-gray-700">Historial de asignaciones ({historial.length})</summary>
            <ul className="mt-2 divide-y divide-gray-100">
              {historial.map((a) => <li key={a.id} className="py-1.5 text-xs text-gray-600">{a.aliado_nombre} · {a.referidor_nombre} · {formatPct(a.pct)} · {fecha(a.vigente_desde)} → {fecha(a.vigente_hasta)}</li>)}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="ref-ref">
        <h2 id="ref-ref" className="text-lg font-semibold text-gray-900">Referidores y códigos</h2>
        {referidores.length === 0 ? <p className="mt-3 rounded-lg bg-white px-4 py-6 text-center text-sm text-gray-500">Aún no hay referidores.</p> : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {referidores.map((r) => (
              <li key={r.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold text-gray-900">{r.nombre}</div>
                    <div className="text-xs text-gray-500">{r.tenant}{r.documento ? ` · ${r.tipo_documento} ${r.documento}` : ""}</div></div>
                  {!r.activo && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Inactivo</span>}
                </div>
                {(r.email || r.telefono) && <p className="mt-1 break-all text-xs text-gray-500">{[r.email, r.telefono].filter(Boolean).join(" · ")}</p>}
                <p className="mt-1 text-xs text-gray-600">{r.aliados_vigentes} aliado(s) con asignación vigente</p>
                {r.codigos.length > 0 && <p className="mt-1 flex flex-wrap gap-1.5">{r.codigos.map((c) => <span key={c.codigo} className={`rounded-md px-2 py-0.5 font-mono text-xs ${c.activo ? "bg-gray-100 text-gray-800" : "bg-gray-50 text-gray-400 line-through"}`}>{c.codigo} · {formatPct(c.pct)}</span>)}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {gestiona ? (
        <section aria-labelledby="ref-gestion" className="grid gap-4 lg:grid-cols-2">
          <h2 id="ref-gestion" className="sr-only">Gestionar referidos</h2>
          <Tarjeta titulo="Nuevo referidor" icono={<UserPlus size={16} aria-hidden />}>
            <FormReferidor pend={pend} onGuardar={(d) => correr(() => guardarReferidorAction(d), () => "Referidor guardado.")} />
          </Tarjeta>
          <Tarjeta titulo="Código de referido" icono={<Plus size={16} aria-hidden />}>
            <FormCodigo pend={pend} activos={activos} onGuardar={(d) => correr(() => definirCodigoAction(d), () => "Código guardado. Solo aplica a asignaciones futuras.")} />
          </Tarjeta>
          <Tarjeta titulo="Asignar un aliado a un referidor" icono={<Link2 size={16} aria-hidden />}>
            <FormAsignar pend={pend} activos={activos} aliados={aliados} onAsignar={(d) => correr(() => asignarReferidoAction(d), (e) => e === "sin_cambio" ? "Ya estaba asignado así: no hubo cambios." : e === "cambiada" ? "Asignación cambiada: rige para compras futuras; el historial se conserva." : "Asignación creada: rige para compras futuras.")} />
          </Tarjeta>
          <Tarjeta titulo="Asignar por código de referido" icono={<Link2 size={16} aria-hidden />}>
            <FormAplicarCodigo pend={pend} aliados={aliados} onAplicar={(d) => correr(() => aplicarCodigoAction(d), (e) => e === "sin_cambio" ? "El aliado ya tenía ese referidor y porcentaje." : e === "cambiada" ? "Asignación cambiada por el código." : "Asignación creada por el código.")} />
          </Tarjeta>
        </section>
      ) : (
        <p className="rounded-lg bg-white px-4 py-3 text-sm text-gray-500">Tu rol puede consultar los referidos. Solo superadmin y gerencia pueden asignarlos o cambiarlos.</p>
      )}
    </div>
  );
}

function Tarjeta({ titulo, icono, children }: { titulo: string; icono: ReactNode; children: ReactNode }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">{icono}{titulo}</h3>{children}</div>;
}
function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return <label className="block text-xs font-medium text-gray-600">{etiqueta}<div className="mt-1 font-normal">{children}</div></label>;
}
const SelPct = ({ valor, cambia }: { valor: string; cambia: (v: string) => void }) => (
  <select value={valor} onChange={(e) => cambia(e.target.value)} className={input} aria-label="Porcentaje">
    {PCT_REFERIDO.map((p) => <option key={p} value={String(p)}>{formatPct(p)}</option>)}
  </select>
);

function FormReferidor({ pend, onGuardar }: { pend: boolean; onGuardar: (d: { tenant: string; nombre: string; tipoDocumento: string; documento: string; email: string; telefono: string; notas: string }) => void }) {
  const [d, setD] = useState({ tenant: "mayorista", nombre: "", tipoDocumento: "", documento: "", email: "", telefono: "", notas: "" });
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onGuardar(d); }} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Campo etiqueta="Nombre"><input value={d.nombre} onChange={set("nombre")} className={input} maxLength={120} required /></Campo></div>
      <Campo etiqueta="Agencia"><select value={d.tenant} onChange={set("tenant")} className={input}><option value="mayorista">Mayorista</option><option value="minorista">Minorista</option></select></Campo>
      <Campo etiqueta="Tipo de documento"><select value={d.tipoDocumento} onChange={set("tipoDocumento")} className={input}><option value="">Sin documento</option>{["CC", "CE", "NIT", "PAS"].map((t) => <option key={t}>{t}</option>)}</select></Campo>
      <Campo etiqueta="Número de documento"><input value={d.documento} onChange={set("documento")} className={input} maxLength={30} /></Campo>
      <Campo etiqueta="Correo"><input type="email" value={d.email} onChange={set("email")} className={input} maxLength={120} /></Campo>
      <Campo etiqueta="Teléfono"><input value={d.telefono} onChange={set("telefono")} className={input} maxLength={30} /></Campo>
      <div className="sm:col-span-2"><button disabled={pend} className={boton}><UserPlus size={15} aria-hidden /> Guardar referidor</button></div>
    </form>
  );
}
function FormCodigo({ pend, activos, onGuardar }: { pend: boolean; activos: Referidor[]; onGuardar: (d: { referidorId: number; codigo: string; pct: string }) => void }) {
  const [d, setD] = useState({ referidorId: "", codigo: "", pct: "0.01" });
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onGuardar({ referidorId: Number(d.referidorId), codigo: d.codigo, pct: d.pct }); }} className="grid gap-3 sm:grid-cols-2">
      <Campo etiqueta="Referidor"><select value={d.referidorId} onChange={(e) => setD((p) => ({ ...p, referidorId: e.target.value }))} className={input} required><option value="">Elige…</option>{activos.map((r) => <option key={r.id} value={r.id}>{r.nombre} · {r.tenant}</option>)}</select></Campo>
      <Campo etiqueta="Código (4 a 20: letras, números, guiones)"><input value={d.codigo} onChange={(e) => setD((p) => ({ ...p, codigo: e.target.value }))} className={`${input} font-mono uppercase`} maxLength={20} required /></Campo>
      <Campo etiqueta="Porcentaje que otorga"><SelPct valor={d.pct} cambia={(v) => setD((p) => ({ ...p, pct: v }))} /></Campo>
      <div className="flex items-end"><button disabled={pend} className={boton}><Plus size={15} aria-hidden /> Guardar código</button></div>
    </form>
  );
}
function FormAsignar({ pend, activos, aliados, onAsignar }: { pend: boolean; activos: Referidor[]; aliados: AliadoOpt[]; onAsignar: (d: { aliadoId: number; referidorId: number; pct: string; motivo: string }) => void }) {
  const [d, setD] = useState({ aliadoId: "", referidorId: "", pct: "0.01", motivo: "" });
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onAsignar({ aliadoId: Number(d.aliadoId), referidorId: Number(d.referidorId), pct: d.pct, motivo: d.motivo }); }} className="grid gap-3 sm:grid-cols-2">
      <Campo etiqueta="Agencia o freelance referido"><select value={d.aliadoId} onChange={(e) => setD((p) => ({ ...p, aliadoId: e.target.value }))} className={input} required><option value="">Elige…</option>{aliados.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.tipo ? ` · ${a.tipo}` : ""}</option>)}</select></Campo>
      <Campo etiqueta="Referidor"><select value={d.referidorId} onChange={(e) => setD((p) => ({ ...p, referidorId: e.target.value }))} className={input} required><option value="">Elige…</option>{activos.map((r) => <option key={r.id} value={r.id}>{r.nombre} · {r.tenant}</option>)}</select></Campo>
      <Campo etiqueta="Porcentaje"><SelPct valor={d.pct} cambia={(v) => setD((p) => ({ ...p, pct: v }))} /></Campo>
      <Campo etiqueta="Motivo (opcional)"><input value={d.motivo} onChange={(e) => setD((p) => ({ ...p, motivo: e.target.value }))} className={input} maxLength={300} /></Campo>
      <div className="sm:col-span-2"><button disabled={pend} className={boton}><Link2 size={15} aria-hidden /> Asignar</button></div>
    </form>
  );
}
function FormAplicarCodigo({ pend, aliados, onAplicar }: { pend: boolean; aliados: AliadoOpt[]; onAplicar: (d: { aliadoId: number; codigo: string }) => void }) {
  const [d, setD] = useState({ aliadoId: "", codigo: "" });
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onAplicar({ aliadoId: Number(d.aliadoId), codigo: d.codigo }); }} className="grid gap-3 sm:grid-cols-2">
      <Campo etiqueta="Agencia o freelance referido"><select value={d.aliadoId} onChange={(e) => setD((p) => ({ ...p, aliadoId: e.target.value }))} className={input} required><option value="">Elige…</option>{aliados.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.tipo ? ` · ${a.tipo}` : ""}</option>)}</select></Campo>
      <Campo etiqueta="Código de referido"><input value={d.codigo} onChange={(e) => setD((p) => ({ ...p, codigo: e.target.value }))} className={`${input} font-mono uppercase`} maxLength={20} required /></Campo>
      <p className="text-xs text-gray-500 sm:col-span-2">El referidor y el porcentaje salen de la regla guardada para ese código; no se escriben aquí.</p>
      <div className="sm:col-span-2"><button disabled={pend} className={boton}><Link2 size={15} aria-hidden /> Aplicar código</button></div>
    </form>
  );
}
