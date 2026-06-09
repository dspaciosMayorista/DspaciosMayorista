"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generarVouchersServicios, actualizarVoucher, eliminarVoucher, type VoucherContenido } from "./voucher-actions";

export type VoucherRow = { id: number; proveedor: string | null; share_token: string; contenido: VoucherContenido };

const lbl = "mb-1 block text-[11px] font-medium text-gray-500";
const inp = "w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

export function VouchersPanel({ numero, vouchers }: { numero: string; vouchers: VoucherRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function generar() {
    setMsg("");
    start(async () => {
      const r = await generarVouchersServicios(numero);
      if (r.ok) { setMsg(`✓ ${r.creados} voucher(s) generado(s)`); router.refresh(); }
      else setMsg(r.error);
    });
  }

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Vouchers de servicios</h2>
          <p className="text-xs text-gray-400">Uno por proveedor. Auto-armado desde el contrato; editable antes de imprimir.</p>
        </div>
        <Button onClick={generar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Generando…" : vouchers.length ? "Regenerar vouchers" : "Generar vouchers de servicios"}
        </Button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}

      {vouchers.length > 0 && (
        <div className="mt-4 space-y-3">
          {vouchers.map((v) => <VoucherCard key={v.id} numero={numero} v={v} />)}
        </div>
      )}
    </section>
  );
}

function VoucherCard({ numero, v }: { numero: string; v: VoucherRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<VoucherContenido>(v.contenido);
  const [incluyeText, setIncluyeText] = useState((v.contenido.incluye ?? []).join("\n"));
  const [pending, start] = useTransition();

  const set = (k: keyof VoucherContenido, val: string) => setC((p) => ({ ...p, [k]: val }));

  function guardar() {
    const contenido: VoucherContenido = { ...c, incluye: incluyeText.split("\n").map((s) => s.trim()).filter(Boolean) };
    start(async () => {
      const r = await actualizarVoucher(v.id, contenido, numero);
      if (r.ok) { setOpen(false); router.refresh(); } else alert(r.error);
    });
  }

  function borrar() {
    if (!confirm("¿Eliminar este voucher?")) return;
    start(async () => { await eliminarVoucher(v.id, numero); router.refresh(); });
  }

  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="font-medium text-gray-800">{v.proveedor ?? "Proveedor"}</div>
        <div className="flex items-center gap-3 text-sm">
          <a href={`/voucher/${v.share_token}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>Ver / imprimir →</a>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs" style={{ color: "var(--brand-accent)" }}>{open ? "Cerrar" : "Editar"}</button>
          <button type="button" onClick={borrar} disabled={pending} className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><label className={lbl}>Hotel</label><Input value={c.hotel} onChange={(e) => set("hotel", e.target.value)} /></div>
            <div><label className={lbl}>Destino</label><Input value={c.destino} onChange={(e) => set("destino", e.target.value)} /></div>
            <div><label className={lbl}>Fecha ingreso</label><Input value={c.fechaIngreso} onChange={(e) => set("fechaIngreso", e.target.value)} /></div>
            <div><label className={lbl}>Tipo de pax</label><Input value={c.tipoPax} onChange={(e) => set("tipoPax", e.target.value)} /></div>
            <div><label className={lbl}>Noches</label><Input value={c.noches} onChange={(e) => set("noches", e.target.value)} /></div>
            <div><label className={lbl}>Tipo de plan</label><Input value={c.tipoPlan} onChange={(e) => set("tipoPlan", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className={lbl}>Titular</label><Input value={c.titular} onChange={(e) => set("titular", e.target.value)} /></div>
            <div><label className={lbl}>Vendedor</label><Input value={c.vendedor} onChange={(e) => set("vendedor", e.target.value)} /></div>
            <div><label className={lbl}>Adultos</label><Input value={c.adultos} onChange={(e) => set("adultos", e.target.value)} /></div>
            <div><label className={lbl}>Niños / Infantes</label><Input value={c.ninos} onChange={(e) => set("ninos", e.target.value)} /></div>
            <div><label className={lbl}>Check-in</label><Input value={c.checkIn} onChange={(e) => set("checkIn", e.target.value)} placeholder="08:00 AM" /></div>
            <div><label className={lbl}>Check-out</label><Input value={c.checkOut} onChange={(e) => set("checkOut", e.target.value)} placeholder="03:00 PM" /></div>
          </div>
          <div>
            <label className={lbl}>Incluye (uno por línea)</label>
            <textarea value={incluyeText} onChange={(e) => setIncluyeText(e.target.value)} rows={3} className={inp} />
          </div>
          <div>
            <label className={lbl}>Información importante</label>
            <textarea value={c.infoImportante} onChange={(e) => set("infoImportante", e.target.value)} rows={2} className={inp} />
          </div>
          <div>
            <label className={lbl}>No incluye</label>
            <Input value={c.noIncluye} onChange={(e) => set("noIncluye", e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
