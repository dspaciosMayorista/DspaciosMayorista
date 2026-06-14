"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { enviarSolicitudB2B } from "./actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function RegistroForm() {
  const [f, setF] = useState({
    tipo: "agencia", nombre: "", nit: "", contacto: "", email: "", telefono: "", ciudad: "", notas: "", aceptaNotificaciones: true,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  function enviar() {
    setMsg("");
    start(async () => {
      const r = await enviarSolicitudB2B(f);
      if (r.ok) setOk(true);
      else setMsg(r.error);
    });
  }

  if (ok) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <div className="text-2xl">✅</div>
        <h2 className="mt-2 text-lg font-semibold text-gray-800">¡Solicitud enviada!</h2>
        <p className="mt-1 text-sm text-gray-600">
          Revisaremos tu registro y te avisaremos cuando se apruebe. Luego podrás iniciar sesión en el Portal B2B.
        </p>
        <Link href="/portal/b2b" className="mt-4 inline-block text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>← Volver al Portal B2B</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>Tipo de aliado</label>
          <select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} className={sel}>
            <option value="agencia">Agencia de viajes</option>
            <option value="freelance">Freelance</option>
          </select>
        </div>
        <div><label className={lbl}>Nombre / Razón social *</label><Input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} /></div>
        <div><label className={lbl}>NIT / Documento</label><Input value={f.nit} onChange={(e) => set("nit", e.target.value)} /></div>
        <div><label className={lbl}>Persona de contacto</label><Input value={f.contacto} onChange={(e) => set("contacto", e.target.value)} /></div>
        <div><label className={lbl}>Correo *</label><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
        <div><label className={lbl}>Teléfono</label><Input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} /></div>
        <div><label className={lbl}>Ciudad</label><Input value={f.ciudad} onChange={(e) => set("ciudad", e.target.value)} /></div>
      </div>
      <div><label className={lbl}>Notas</label><textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} rows={2} className={sel} /></div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={f.aceptaNotificaciones} onChange={(e) => set("aceptaNotificaciones", e.target.checked)} />
        Acepto recibir notificaciones (tarifas, confirmaciones, novedades).
      </label>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <Button onClick={enviar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
        {pending ? "Enviando…" : "Enviar solicitud de registro"}
      </Button>
    </div>
  );
}
