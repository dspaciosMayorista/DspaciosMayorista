"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guardarEmailConfig } from "../actions";

type Config = {
  proveedor: string; remitente_email: string | null; remitente_nombre: string | null;
  responder_a: string | null; api_key: string | null; firma_html: string | null; activo: boolean;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function EmailConfigForm({ inicial }: { inicial: Config }) {
  const [proveedor, setProveedor] = useState(inicial.proveedor || "brevo");
  const [remitenteEmail, setRemitenteEmail] = useState(inicial.remitente_email ?? "");
  const [remitenteNombre, setRemitenteNombre] = useState(inicial.remitente_nombre ?? "");
  const [responderA, setResponderA] = useState(inicial.responder_a ?? "");
  const [apiKey, setApiKey] = useState(inicial.api_key ?? "");
  const [firmaHtml, setFirmaHtml] = useState(inicial.firma_html ?? "");
  const [activo, setActivo] = useState(inicial.activo);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await guardarEmailConfig({ proveedor, remitenteEmail, remitenteNombre, responderA, apiKey, firmaHtml, activo });
      setMsg(r.ok ? "✓ Guardado" : r.error);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className={lbl}>Proveedor de envío</label>
          <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="brevo">Brevo (Sendinblue) — tier gratis</option>
            <option value="resend">Resend — tier gratis</option>
            <option value="smtp">SMTP propio</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Envío activo
          </label>
        </div>
        <div><label className={lbl}>Correo remitente (verificado en el proveedor)</label><Input type="email" value={remitenteEmail} onChange={(e) => setRemitenteEmail(e.target.value)} placeholder="campanas@dspaciostravel.com" /></div>
        <div><label className={lbl}>Nombre remitente</label><Input value={remitenteNombre} onChange={(e) => setRemitenteNombre(e.target.value)} placeholder="D'spacios Travel" /></div>
        <div><label className={lbl}>Responder a (reply-to)</label><Input type="email" value={responderA} onChange={(e) => setResponderA(e.target.value)} placeholder="contacto@dspaciostravel.com" /></div>
        <div><label className={lbl}>API Key del proveedor</label><Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="••••••••" /></div>
      </div>
      <div>
        <label className={lbl}>Firma / pie de los correos (HTML)</label>
        <textarea value={firmaHtml} onChange={(e) => setFirmaHtml(e.target.value)} rows={4}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="<p>D'spacios Travel · …</p>" />
      </div>
      <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
        ⚠️ Para envío masivo legal, solo a contactos con <b>acepta_publicidad</b> y sin <b>no contactar</b>. Verifica el dominio
        del remitente en el proveedor (SPF/DKIM) para que no caiga en spam. La API key es sensible.
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar configuración"}</Button>
        {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
      </div>
    </div>
  );
}
