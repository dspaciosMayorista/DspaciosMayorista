"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { generarVouchersServicios, generarVoucherHotel, generarVoucherVuelo, actualizarVoucher, eliminarVoucher, type VoucherContenido } from "./voucher-actions";
import { ComboCiudad } from "@/components/ComboCiudad";
import { Info } from "lucide-react";
import type { DestinoOpt } from "@/components/ComboDestino";
import type { VoucherVueloContenido } from "@/lib/voucher/vuelo";

export type VoucherRow = { id: number; tipo?: string; proveedor: string | null; share_token: string; contenido: VoucherContenido | VoucherVueloContenido; /** 338: cambios reales de contenido tras generarlo (voucher aéreo regenerado en el mismo enlace). */ revision?: number; actualizado_en?: string | null; /** 338 (ADL-042): vigente | revisar (los tramos del servicio cambiaron) | retirado (el servicio ya no existe). */ estado?: string };

const lbl = "mb-1 block text-[11px] font-medium text-gray-500";
const inp = "w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

export function VouchersPanel({ numero, vouchers, puedeGenerar, motivoBloqueo, destinos = [], puedeEditar = true, identidad, pagoCompleto = null }: { identidad: IdentidadContrato; numero: string; vouchers: VoucherRow[]; puedeGenerar: boolean; motivoBloqueo?: string; destinos?: DestinoOpt[]; puedeEditar?: boolean; /** #53: ¿contrato 100 % pagado según la base? null = no se pudo verificar (el aliado no accede). */ pagoCompleto?: boolean | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function generar() {
    setMsg("");
    start(async () => {
      const r = await generarVouchersServicios(numero, identidad);
      if (r.ok) { setMsg(`✓ ${r.creados} voucher(s) de servicios`); router.refresh(); }
      else setMsg(r.error);
    });
  }
  function generarHotel() {
    setMsg("");
    start(async () => {
      const r = await generarVoucherHotel(numero, identidad);
      if (r.ok) { setMsg("✓ Voucher de hotel generado"); router.refresh(); }
      else setMsg(r.error);
    });
  }

  function generarVuelo() {
    setMsg("");
    start(async () => {
      const r = await generarVoucherVuelo(numero, identidad);
      if (r.ok) {
        const nuevos = r.creados ?? 0, cambiados = r.actualizados ?? 0;
        const base = nuevos + cambiados === 0 && !(r.retirados ?? 0) ? "✓ Voucher(s) de vuelo sin cambios (mismo contenido y mismo enlace)" : `✓ Voucher(s) de vuelo: ${nuevos} nuevo(s), ${cambiados} actualizado(s) en el mismo enlace`;
        setMsg([base, ...(r.avisos ?? [])].join(" · "));
        router.refresh();
      }
      else setMsg(r.error);
    });
  }

  // Solo lectura: el asesor que cubre a un colega no genera ni edita vouchers.
  // Del lado del servidor la migración 148 limita `vouchers` a contratos
  // propios —la tabla guarda `share_token`, que abre la página pública
  // /voucher/[token]—, así que aquí la lista llegaría vacía de todos modos.
  if (!puedeEditar) {
    return (
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700">Vouchers</h2>
        <p className="mt-2 text-xs text-gray-400">
          Los vouchers los genera y comparte el asesor que gestiona el contrato.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Vouchers</h2>
          <p className="text-xs text-gray-400">Servicios (uno por proveedor), hotel y vuelo (uno por servicio aéreo guardado). Auto-armados; los de servicios y hotel son editables antes de imprimir.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={generar} disabled={pending || !puedeGenerar} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : "Vouchers de servicios"}
          </Button>
          <Button onClick={generarHotel} disabled={pending || !puedeGenerar} variant="outline">
            Voucher de hotel
          </Button>
          <Button onClick={generarVuelo} disabled={pending || !puedeGenerar} variant="outline" data-testid="generar-voucher-vuelo">
            Voucher de vuelo
          </Button>
        </div>
      </div>
      {!puedeGenerar && motivoBloqueo && <p className="mt-2 text-xs text-amber-600">{motivoBloqueo}</p>}
      {vouchers.length > 0 && (
        <p className={`mt-2 flex items-start gap-1.5 text-xs ${pagoCompleto === true ? "text-green-700" : "text-amber-700"}`} role="note">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {pagoCompleto === true
            ? "Contrato 100 % pagado: el aliado ya puede abrir estos vouchers desde su portal."
            : pagoCompleto === false
              ? "Vista previa interna: el aliado solo podrá abrir estos vouchers cuando el contrato esté 100 % pagado. Si el saldo vuelve a subir, el acceso se bloquea de nuevo (el voucher no se borra)."
              : "No se pudo verificar el pago del contrato: por seguridad el aliado no accede a los vouchers hasta confirmarlo."}
        </p>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}

      {vouchers.length > 0 && (
        <div className="mt-4 space-y-3">
          {vouchers.map((v) => <VoucherCard key={v.id} numero={numero} identidad={identidad} v={v} destinos={destinos} />)}
        </div>
      )}
    </section>
  );
}

function VoucherCard({ numero, v, destinos, identidad }: { identidad: IdentidadContrato; numero: string; v: VoucherRow; destinos: DestinoOpt[] }) {
  // El voucher de vuelo se arma solo con datos guardados: no tiene formulario de edición, se vuelve a generar para refrescarlo.
  if (v.tipo === "vuelo") return <VoucherVueloCard numero={numero} identidad={identidad} v={v} />;
  return <VoucherServiciosCard numero={numero} identidad={identidad} v={{ ...v, contenido: v.contenido as VoucherContenido }} destinos={destinos} />;
}

function VoucherVueloCard({ numero, v, identidad }: { identidad: IdentidadContrato; numero: string; v: VoucherRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cont = v.contenido as VoucherVueloContenido;
  const faltan = cont.datosFaltantes?.length ?? 0;
  const ruta = (cont.tramos ?? []).map((t) => `${t.origen} → ${t.destino}`).join(" · ");
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500">Vuelo</span>
          <span className="font-medium text-gray-800">{v.proveedor ?? "Servicio aéreo"}</span>
          {ruta && <span className="text-xs text-gray-500" data-testid="voucher-vuelo-ruta">{ruta}</span>}
          {faltan > 0 && <span className="text-xs text-amber-700" data-testid="voucher-vuelo-faltantes">{faltan} dato(s) sin registrar</span>}
          {v.estado === "revisar" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700" data-testid="voucher-vuelo-desactualizado" title="Los tramos de este servicio cambiaron después de generar el voucher: su enlace no muestra el itinerario anterior. Vuelve a generar los vouchers de vuelo.">Desactualizado: volver a generar</span>}
          {v.estado === "retirado" && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700" data-testid="voucher-vuelo-retirado" title="El servicio aéreo de este voucher ya no existe en el contrato. Se conserva como historial; su enlace ya no muestra el itinerario.">Retirado (servicio ya no existe)</span>}
          {(v.revision ?? 0) > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700" data-testid="voucher-vuelo-actualizado" title="Se regeneró con cambios en el mismo enlace. Señal interna: no indica que el cliente lo haya recibido ni visto.">Actualizado ({v.revision})</span>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <a href={`/voucher/${v.share_token}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>Ver / imprimir →</a>
          <button type="button" onClick={() => { if (!confirm("¿Eliminar este voucher?")) return; start(async () => { await eliminarVoucher(v.id, numero, identidad); router.refresh(); }); }} disabled={pending} className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
        </div>
      </div>
    </div>
  );
}

function VoucherServiciosCard({ numero, v, destinos, identidad }: { identidad: IdentidadContrato; numero: string; v: VoucherRow & { contenido: VoucherContenido }; destinos: DestinoOpt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<VoucherContenido>(v.contenido);
  const [incluyeText, setIncluyeText] = useState((v.contenido.incluye ?? []).join("\n"));
  const [pending, start] = useTransition();

  const set = (k: keyof VoucherContenido, val: string) => setC((p) => ({ ...p, [k]: val }));

  function guardar() {
    const contenido: VoucherContenido = { ...c, incluye: incluyeText.split("\n").map((s) => s.trim()).filter(Boolean) };
    start(async () => {
      const r = await actualizarVoucher(v.id, contenido, numero, identidad);
      if (r.ok) { setOpen(false); router.refresh(); } else alert(r.error);
    });
  }

  function borrar() {
    if (!confirm("¿Eliminar este voucher?")) return;
    start(async () => { await eliminarVoucher(v.id, numero, identidad); router.refresh(); });
  }

  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500">{v.tipo === "hotel" ? "Hotel" : "Servicios"}</span>
          <span className="font-medium text-gray-800">{v.proveedor ?? "Proveedor"}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <a href={`/voucher/${v.share_token}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>Ver / imprimir →</a>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs" style={{ color: "var(--brand-accent)" }}>{open ? "Cerrar" : "Editar"}</button>
          <button type="button" onClick={borrar} disabled={pending} className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          {c.codigoReserva !== undefined && (
            <div><label className={lbl}>Código de reserva del hotel</label><Input value={c.codigoReserva} onChange={(e) => set("codigoReserva", e.target.value)} placeholder="Ej. ABC123 / confirmación del hotel" /></div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><label className={lbl}>Hotel / Proveedor</label><Input value={c.hotel} onChange={(e) => set("hotel", e.target.value)} /></div>
            <div><label className={lbl}>Destino</label><ComboCiudad destinos={destinos} value={c.destino} onChange={(val) => set("destino", val)} modo="nombre" permitirLibre placeholder="Destino…" /></div>

            {/* Fecha: para servicios = date-picker de un día del viaje;
                para hotel = rango de texto (tarifario) o date (dinámico) */}
            {v.tipo === "servicios" ? (
              <div>
                <label className={lbl}>Fecha del servicio</label>
                <DateInput aria-label="Fecha del servicio"
                  type="date"
                  value={c.fechaIngreso?.slice(0, 10) ?? ""}
                  min={c.fechaSalidaViaje ?? undefined}
                  max={c.fechaRegresoViaje ?? undefined}
                  onValueChange={(dateValue) => set("fechaIngreso", dateValue)}
                />
              </div>
            ) : (
              <div><label className={lbl}>Fecha ingreso</label><Input value={c.fechaIngreso} onChange={(e) => set("fechaIngreso", e.target.value)} /></div>
            )}

            <div><label className={lbl}>Tipo de pax</label><Input value={c.tipoPax} onChange={(e) => set("tipoPax", e.target.value)} /></div>
            <div><label className={lbl}>Noches</label><Input value={c.noches} onChange={(e) => set("noches", e.target.value)} /></div>
            <div><label className={lbl}>Régimen / Tipo de plan</label><Input value={c.tipoPlan} onChange={(e) => set("tipoPlan", e.target.value)} placeholder="Ej. PC, PAM, Solo alojamiento…" /></div>

            {/* Categoría de habitación — solo hotel (dinámico muestra el campo vacío; tarifario puede tenerlo) */}
            {v.tipo === "hotel" && (
              <div><label className={lbl}>Categoría de habitación</label><Input value={c.categoriaHabitacion ?? ""} onChange={(e) => set("categoriaHabitacion", e.target.value)} placeholder="Ej. Doble estándar, Suite…" /></div>
            )}

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
            <label className={lbl}>Condiciones de reserva / Información importante</label>
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
