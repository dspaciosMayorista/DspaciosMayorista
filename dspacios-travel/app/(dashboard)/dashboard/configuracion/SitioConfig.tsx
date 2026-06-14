"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarConfigSitio } from "./actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

export function SitioConfig({ config }: { config: { video_fondo_url: string | null; link_pago: string | null } | null }) {
  const [url, setUrl] = useState(config?.video_fondo_url ?? "");
  const [linkPago, setLinkPago] = useState(config?.link_pago ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarConfigSitio({ videoFondoUrl: url, linkPago });
      setMsg(r.ok ? "✓ Guardado" : r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">Video de fondo del tarifario</h2>
      <p className="mt-1 mb-4 text-xs text-gray-500">
        URL de un video de YouTube que se muestra de fondo en la cabecera del tarifario público. Déjalo vacío
        para usar el degradado de marca. El video lo sirve YouTube (no consume tu base de datos).
      </p>
      <div>
        <label className={lbl}>URL de YouTube</label>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/… o https://www.youtube.com/watch?v=…" />
      </div>
      <div className="mt-4">
        <label className={lbl}>Link de pago (Wompi / Bold / Nequi / PayU…)</label>
        <Input value={linkPago} onChange={(e) => setLinkPago(e.target.value)} placeholder="https://checkout.wompi.co/l/..." />
        <p className="mt-1 text-[11px] text-gray-400">Pega el enlace de cobro de tu pasarela. Aparecerá como “Pagar en línea” en /pagar y en el Portal B2B.</p>
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
