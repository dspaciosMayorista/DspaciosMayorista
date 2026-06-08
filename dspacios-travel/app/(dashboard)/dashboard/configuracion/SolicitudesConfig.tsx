"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarConfigSolicitudes } from "./actions";

type Config = { whatsapp: string | null; emails: string | null; mensaje_extra: string | null };

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function SolicitudesConfig({ config }: { config: Config | null }) {
  const [whatsapp, setWhatsapp] = useState(config?.whatsapp ?? "");
  const [emails, setEmails] = useState(config?.emails ?? "");
  const [mensaje, setMensaje] = useState(config?.mensaje_extra ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarConfigSolicitudes({ whatsapp, emails, mensajeExtra: mensaje });
      setMsg(r.ok ? "✓ Guardado" : r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">Solicitudes de reserva (tarifario dinámico)</h2>
      <p className="mt-1 mb-4 text-xs text-gray-500">
        A dónde llegan las solicitudes que arma el carrito público. El cliente las envía por WhatsApp o correo desde el checkout.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>WhatsApp (con indicativo, solo números)</label>
          <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="Ej. 573001234567" />
          <p className="mt-1 text-[11px] text-gray-400">Sin +, espacios ni guiones. 57 = Colombia.</p>
        </div>
        <div>
          <label className={lbl}>Correo(s) — separa con coma</label>
          <Input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="reservas@dspacios.com, ventas@dspacios.com" />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Nota al pie del mensaje (opcional)</label>
          <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={2}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="Ej. Un asesor te contactará para confirmar disponibilidad y forma de pago." />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
      </div>
    </section>
  );
}
