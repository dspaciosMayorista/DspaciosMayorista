"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarConfigNotificaciones, enviarNotificacionPrueba } from "./actions";

type Cfg = {
  remitente: string | null; destinatarios: string | null; dias_anticipacion: number;
  alerta_cxp: boolean; alerta_cuotas: boolean; alerta_bloqueos: boolean; activo: boolean;
} | null;

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function NotificacionesConfig({ config }: { config: Cfg }) {
  const [remitente, setRemitente] = useState(config?.remitente ?? "D'spacios Travel <info@dspaciostravel.com>");
  const [destinatarios, setDestinatarios] = useState(config?.destinatarios ?? "");
  const [dias, setDias] = useState(String(config?.dias_anticipacion ?? 5));
  const [cxp, setCxp] = useState(config?.alerta_cxp ?? true);
  const [cuotas, setCuotas] = useState(config?.alerta_cuotas ?? true);
  const [bloqueos, setBloqueos] = useState(config?.alerta_bloqueos ?? true);
  const [activo, setActivo] = useState(config?.activo ?? true);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarConfigNotificaciones({
        remitente, destinatarios, diasAnticipacion: Number(dias) || 5,
        alertaCxp: cxp, alertaCuotas: cuotas, alertaBloqueos: bloqueos, activo,
      });
      setMsg(r.ok ? "✓ Guardado" : r.error);
    });
  }
  function probar() {
    setMsg("");
    start(async () => {
      const r = await enviarNotificacionPrueba();
      setMsg(r.ok ? "✓ Correo de prueba enviado" : r.error);
    });
  }

  const chk = "flex items-center gap-2 text-sm text-gray-600";

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">Notificaciones por correo (Resend)</h2>
      <p className="mt-1 mb-4 text-xs text-gray-500">
        Un correo diario avisa las fechas límite próximas. Requiere <code>RESEND_API_KEY</code> en el servidor y el dominio verificado en Resend.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={lbl}>Remitente (from)</label><Input value={remitente} onChange={(e) => setRemitente(e.target.value)} /></div>
        <div><label className={lbl}>Días de anticipación</label><Input type="number" value={dias} onChange={(e) => setDias(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className={lbl}>Destinatarios (correos separados por coma)</label><Input value={destinatarios} onChange={(e) => setDestinatarios(e.target.value)} placeholder="contabilidad@dspacios.com, operaciones@dspacios.com" /></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <label className={chk}><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo</label>
        <label className={chk}><input type="checkbox" checked={cxp} onChange={(e) => setCxp(e.target.checked)} /> Pagos a proveedores</label>
        <label className={chk}><input type="checkbox" checked={cuotas} onChange={(e) => setCuotas(e.target.checked)} /> Cobros a clientes</label>
        <label className={chk}><input type="checkbox" checked={bloqueos} onChange={(e) => setBloqueos(e.target.checked)} /> Bloqueos (devolución/emisión)</label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar"}</Button>
        <Button onClick={probar} disabled={pending} variant="outline">Enviar prueba</Button>
        {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
      </div>
    </section>
  );
}
