"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/types/database";
import { guardarConfig, type WebConfigInput } from "../actions";

type Config = Database["public"]["Tables"]["web_config"]["Row"];

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const ta = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

function youtubeDe(config: Config | null): string {
  const e = config?.extra;
  if (e && typeof e === "object" && !Array.isArray(e)) {
    const v = (e as Record<string, unknown>).youtube_url;
    return typeof v === "string" ? v : "";
  }
  return "";
}

function fromRow(config: Config | null): WebConfigInput {
  return {
    contacto_email: config?.contacto_email ?? "",
    contacto_telefono: config?.contacto_telefono ?? "",
    whatsapp_numero: config?.whatsapp_numero ?? "",
    whatsapp_mensaje: config?.whatsapp_mensaje ?? "",
    direccion: config?.direccion ?? "",
    instagram_url: config?.instagram_url ?? "",
    facebook_url: config?.facebook_url ?? "",
    tiktok_url: config?.tiktok_url ?? "",
    youtube_url: youtubeDe(config),
  };
}

export function ConfigEditor({ config }: { config: Config | null }) {
  const [form, setForm] = useState<WebConfigInput>(fromRow(config));
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function set<K extends keyof WebConfigInput>(k: K, v: WebConfigInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function guardar() {
    setMsg("");
    setErr("");
    start(async () => {
      const r = await guardarConfig(form);
      if (r.ok) setMsg("Configuración guardada.");
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Datos globales del sitio (pie de página, contacto, redes). Las páginas y sus
        secciones se editan en la pestaña <strong>Páginas</strong>.
      </p>

      <Section title="Contacto y canales">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={lbl}>Email de contacto</label>
            <Input value={form.contacto_email} onChange={(e) => set("contacto_email", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Teléfono / línea de atención</label>
            <Input value={form.contacto_telefono} onChange={(e) => set("contacto_telefono", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>WhatsApp — número (con indicativo, sin +)</label>
            <Input value={form.whatsapp_numero} onChange={(e) => set("whatsapp_numero", e.target.value)} placeholder="573212150582" />
          </div>
          <div>
            <label className={lbl}>WhatsApp — mensaje por defecto</label>
            <Input value={form.whatsapp_mensaje} onChange={(e) => set("whatsapp_mensaje", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={lbl}>Dirección</label>
            <textarea className={ta} rows={2} value={form.direccion} onChange={(e) => set("direccion", e.target.value)} />
          </div>
        </div>
      </Section>

      <Section title="Redes sociales">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={lbl}>Instagram (URL)</label>
            <Input value={form.instagram_url} onChange={(e) => set("instagram_url", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Facebook (URL)</label>
            <Input value={form.facebook_url} onChange={(e) => set("facebook_url", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>TikTok (URL)</label>
            <Input value={form.tiktok_url} onChange={(e) => set("tiktok_url", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>YouTube (URL)</label>
            <Input value={form.youtube_url} onChange={(e) => set("youtube_url", e.target.value)} />
          </div>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)", color: "white" }}>
          {pending ? "…" : "Guardar configuración"}
        </Button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-700">{title}</p>
      {children}
    </div>
  );
}
