"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { EmpresaConfig } from "@/lib/empresa";
import { guardarEmpresa } from "./actions";

const card = "rounded-xl border border-gray-200 bg-white p-5";
const lbl = "mb-1 block text-xs font-medium text-gray-600";

type LogoKey = "logo_url" | "logo_white_url" | "logo_icon_url";

export function EmpresaForm({ inicial }: { inicial: EmpresaConfig }) {
  const [v, setV] = useState<EmpresaConfig>(inicial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const set =
    (k: keyof EmpresaConfig) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV((s) => ({ ...s, [k]: e.target.value }));

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await guardarEmpresa(v);
      setMsg(r.ok ? "✓ Guardado" : r.error);
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Identidad ───────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Identidad</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Campo label="Nombre comercial" value={v.nombre_comercial} onChange={set("nombre_comercial")} placeholder="Tu Agencia de Viajes" />
          <Campo label="Bajante / lema (tagline)" value={v.tagline} onChange={set("tagline")} placeholder="Mayorista de Turismo" />
          <Campo label="Color primario (HEX)" value={v.color_primary} onChange={set("color_primary")} placeholder="#1D7C9A" />
          <Campo label="Color de acento (HEX)" value={v.color_accent} onChange={set("color_accent")} placeholder="#26BBD9" />
        </div>
      </section>

      {/* ── Logos ───────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Logos</h2>
        <p className="mb-4 text-xs text-gray-500">
          PNG o SVG con <b>fondo transparente</b>. Logo horizontal ideal <b>600×170 px</b> (proporción ~3.5:1);
          ícono cuadrado <b>512×512 px</b>. Máx. ~300 KB. Sube el archivo o pega una URL.
        </p>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <LogoUploader campo="logo_url" titulo="Logo color (fondos claros)" url={v.logo_url} onChange={(u) => setV((s) => ({ ...s, logo_url: u }))} fondo="claro" />
          <LogoUploader campo="logo_white_url" titulo="Logo blanco (fondos de color)" url={v.logo_white_url} onChange={(u) => setV((s) => ({ ...s, logo_white_url: u }))} fondo="oscuro" />
          <LogoUploader campo="logo_icon_url" titulo="Ícono cuadrado (app/favicon)" url={v.logo_icon_url} onChange={(u) => setV((s) => ({ ...s, logo_icon_url: u }))} fondo="claro" />
        </div>
      </section>

      {/* ── Tributario / cabecera del contrato ──────────────────── */}
      <section className={card}>
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Datos tributarios (cabecera del contrato)</h2>
        <p className="mb-4 text-xs text-gray-500">Tal como vienen en el RUT. Aparecen en el encabezado y pie del contrato.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Campo label="Razón social" value={v.razon_social} onChange={set("razon_social")} />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Campo label="NIT" value={v.nit} onChange={set("nit")} /></div>
            <Campo label="DV" value={v.dv} onChange={set("dv")} />
          </div>
          <Campo label="Régimen" value={v.regimen} onChange={set("regimen")} placeholder="Responsable de IVA…" />
          <Campo label="RNT (Registro Nacional de Turismo)" value={v.rnt} onChange={set("rnt")} />
          <Campo label="Dirección" value={v.direccion} onChange={set("direccion")} />
          <Campo label="Ciudad" value={v.ciudad} onChange={set("ciudad")} />
          <Campo label="Teléfono" value={v.telefono} onChange={set("telefono")} />
          <Campo label="Email" value={v.email} onChange={set("email")} />
          <Campo label="Sitio web" value={v.sitio_web} onChange={set("sitio_web")} />
        </div>
      </section>

      {/* ── Bancario ────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Datos de pago (cuenta bancaria)</h2>
        <p className="mb-4 text-xs text-gray-500">Aparece en la cláusula de pagos y en el pie del contrato.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Campo label="Banco" value={v.banco} onChange={set("banco")} placeholder="Bancolombia" />
          <Campo label="Tipo de cuenta" value={v.cuenta_tipo} onChange={set("cuenta_tipo")} placeholder="cuenta corriente / ahorros" />
          <Campo label="Número de cuenta" value={v.cuenta_numero} onChange={set("cuenta_numero")} />
          <Campo label="Titular de la cuenta" value={v.cuenta_titular} onChange={set("cuenta_titular")} />
        </div>
      </section>

      {/* ── Legal / políticas (editables) ───────────────────────── */}
      <section className={card}>
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Condiciones y políticas</h2>
        <p className="mb-4 text-xs text-gray-500">
          Texto propio de cada agencia. Se muestra como &quot;Condiciones adicionales&quot; en el contrato.
          Déjalo en blanco si no aplica.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Campo label="Ciudad de emisión del contrato" value={v.ciudad_emision} onChange={set("ciudad_emision")} />
          <Campo label="Jurisdicción (controversias)" value={v.jurisdiccion} onChange={set("jurisdiccion")} />
        </div>
        <div className="mt-4 space-y-4">
          <Area label="Política de pago" value={v.politica_pago} onChange={set("politica_pago")} />
          <Area label="Política de cancelación" value={v.politica_cancelacion} onChange={set("politica_cancelacion")} />
          <Area label="Términos y condiciones" value={v.terminos_condiciones} onChange={set("terminos_condiciones")} />
          <Area label="Notas del contrato" value={v.nota_contrato} onChange={set("nota_contrato")} />
        </div>
      </section>

      {/* ── Guardar ─────────────────────────────────────────────── */}
      <div className="sticky bottom-0 flex items-center gap-3 border-t border-gray-200 bg-white/90 py-3 backdrop-blur">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar información de la empresa"}
        </Button>
        {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
      </div>
    </div>
  );
}

function Campo({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) {
  return (
    <div>
      <label className={lbl}>{label}</label>
      <Input value={value ?? ""} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void }) {
  return (
    <div>
      <label className={lbl}>{label}</label>
      <textarea
        value={value ?? ""}
        onChange={onChange}
        rows={3}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)]"
      />
    </div>
  );
}

function LogoUploader({ campo, titulo, url, onChange, fondo }: { campo: LogoKey; titulo: string; url: string | null; onChange: (u: string) => void; fondo: "claro" | "oscuro" }) {
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState("");

  async function subir(file: File) {
    setErr("");
    setSubiendo(true);
    try {
      const sb = createClient();
      const ext = file.name.split(".").pop() || "png";
      const path = `${campo}-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("empresa").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = sb.storage.from("empresa").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir el logo.");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div>
      <label className={lbl}>{titulo}</label>
      <div className={`mb-2 flex h-24 items-center justify-center rounded-lg border border-dashed border-gray-300 p-2 ${fondo === "oscuro" ? "bg-[var(--brand-primary)]" : "bg-gray-50"}`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={titulo} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className={`text-xs ${fondo === "oscuro" ? "text-white/70" : "text-gray-400"}`}>Sin logo</span>
        )}
      </div>
      <input
        type="file"
        accept="image/png,image/svg+xml,image/jpeg,image/webp"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }}
        className="block w-full text-xs text-gray-500 file:mr-2 file:rounded-md file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs file:text-gray-700"
        disabled={subiendo}
      />
      <Input value={url ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="…o pega una URL" className="mt-2 text-xs" />
      {subiendo && <p className="mt-1 text-xs text-gray-400">Subiendo…</p>}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
