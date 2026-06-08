"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatCOP } from "@/lib/utils";
import { ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { useCart, type CartItem } from "@/lib/cart/CartContext";
import { crearSolicitudReserva, type SolicitudResult } from "./actions";

function resumenHab(it: CartItem): string {
  const partes = Object.entries(it.habitaciones).filter(([, n]) => n > 0).map(([a, n]) => `${n} ${ACOM_ROOM_LABEL[a as AcomRoom] ?? a}`);
  if (it.ninos > 0) partes.push(`${it.ninos} Niño 1`);
  if (it.ninos2 > 0) partes.push(`${it.ninos2} Niño 2`);
  return partes.join(", ");
}

export default function CheckoutPage() {
  const { items, total, remove, clear } = useCart();
  const [c, setC] = useState({ nombres: "", apellidos: "", numeroDoc: "", telefono: "", email: "" });
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Extract<SolicitudResult, { ok: true }> | null>(null);

  const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const lbl = "mb-1 block text-xs font-medium text-gray-600";

  function enviar() {
    setErr("");
    start(async () => {
      const r = await crearSolicitudReserva({
        items: items.map((it) => ({
          modulo: it.modulo, paqueteId: it.paqueteId, hotelId: it.hotelId, bloqueoId: it.bloqueoId,
          hotelNombre: it.hotelNombre, destino: it.destino, categoria: it.categoria, regimen: it.regimen,
          fechaIda: it.fechaIda, fechaRegreso: it.fechaRegreso, noches: it.noches,
          habitaciones: it.habitaciones, ninos: it.ninos, ninos2: it.ninos2, pax: it.pax, precio: it.precio,
        })),
        cliente: c,
      });
      if (r.ok) { setRes(r); clear(); }
      else setErr(r.error);
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-gradient px-6 py-6 text-white">
        <div className="mx-auto max-w-3xl">
          <Link href="/tarifario" className="text-sm text-white/80 hover:text-white">← Volver al tarifario</Link>
          <h1 className="mt-1 text-xl font-semibold">Finalizar solicitud</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {res ? (
          <Exito res={res} />
        ) : !items.length ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
            <p>Tu carrito está vacío.</p>
            <Link href="/tarifario" className="mt-2 inline-block text-sm font-medium" style={{ color: "var(--brand-primary)" }}>Ver alojamientos →</Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Resumen del carrito */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Tu selección</h2>
              <ul className="space-y-3">
                {items.map((it) => (
                  <li key={it.id} className="flex gap-3 border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                    <div className="relative flex h-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-lg text-gray-300" style={{ width: 72 }}>
                      {it.fotoUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={it.fotoUrl} alt={it.hotelNombre} className="absolute inset-0 h-full w-full object-cover" />
                        : <span aria-hidden>🏨</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-800">{it.hotelNombre}</div>
                      <div className="text-xs text-gray-500">
                        {it.destino ?? ""}{it.fechaIda ? ` · ${it.fechaIda} → ${it.fechaRegreso ?? ""}` : ""}
                      </div>
                      <div className="text-xs text-gray-400">{it.categoria} / {it.regimen} · {resumenHab(it)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>{formatCOP(it.precio)}</div>
                      <button type="button" onClick={() => remove(it.id)} className="text-xs text-gray-400 hover:text-red-500">Quitar</button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-sm text-gray-500">Total estimado</span>
                <span className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(total)}</span>
              </div>
            </section>

            {/* Datos del cliente */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Tus datos</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className={lbl}>Nombres *</label><input className={inp} value={c.nombres} onChange={(e) => setC({ ...c, nombres: e.target.value })} /></div>
                <div><label className={lbl}>Apellidos *</label><input className={inp} value={c.apellidos} onChange={(e) => setC({ ...c, apellidos: e.target.value })} /></div>
                <div><label className={lbl}>Documento</label><input className={inp} value={c.numeroDoc} onChange={(e) => setC({ ...c, numeroDoc: e.target.value })} /></div>
                <div><label className={lbl}>Teléfono / WhatsApp</label><input className={inp} value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} /></div>
                <div className="sm:col-span-2"><label className={lbl}>Correo</label><input type="email" className={inp} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
              </div>
              {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
              <button type="button" onClick={enviar} disabled={pending}
                className="mt-4 w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
                {pending ? "Generando…" : "Generar cotización y enviar solicitud"}
              </button>
              <p className="mt-2 text-center text-[11px] text-gray-400">Generamos tu cotización y preparamos la solicitud para enviarla por WhatsApp o correo.</p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Exito({ res }: { res: Extract<SolicitudResult, { ok: true }> }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
        <div className="text-2xl">✓</div>
        <h2 className="mt-1 text-lg font-semibold text-green-800">¡Cotización generada!</h2>
        <p className="mt-1 text-sm text-green-700">
          {res.cotizaciones.length === 1 ? "Tu cotización" : "Tus cotizaciones"}:{" "}
          {res.cotizaciones.map((c) => c.codigo).join(", ")}
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Envía tu solicitud</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          {res.waUrl ? (
            <a href={res.waUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 rounded-lg px-4 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: "#25D366" }}>
              Enviar por WhatsApp
            </a>
          ) : null}
          {res.mailtoUrl ? (
            <a href={res.mailtoUrl}
              className="flex-1 rounded-lg px-4 py-3 text-center text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
              Enviar por correo
            </a>
          ) : null}
        </div>
        {!res.waUrl && !res.mailtoUrl && (
          <p className="text-xs text-amber-600">No hay destinatarios configurados. Comparte el detalle de abajo con tu asesor.</p>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-500">Ver / copiar el mensaje</summary>
          <textarea readOnly value={res.mensaje} rows={10} className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700" />
        </details>
      </div>

      <Link href="/tarifario" className="block text-center text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
        ← Volver al tarifario
      </Link>
    </div>
  );
}
