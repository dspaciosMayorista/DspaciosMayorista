"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";
import { ComboDestino, type DestinoOpt } from "@/components/ComboDestino";
import { ComboProveedor, type ProveedorOpt } from "@/components/ComboProveedor";
import { origenIdDesdeGuardado, resolverOrigenRutaEdicion } from "@/lib/vuelos/rutaBloqueo";
import { actualizarBloqueo } from "../actions";

// Mismas clases que NuevoBloqueoForm: las tres secciones se ven igual al crear y al editar.
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const card = "rounded-xl border border-gray-200 bg-white p-5 space-y-4";

export function EditarBloqueoForm({
  bloqueoId, inicial, proveedores, destinos, rangos,
}: {
  bloqueoId: number;
  inicial: {
    record: string; aerolinea: string; proveedorId: number | null; destinoId: number | null; ruta: string; origen: string;
    vueloIda: string; fechaIda: string; horaSalidaIda: string; horaLlegadaIda: string;
    vueloRegreso: string; fechaRegreso: string; horaSalidaReg: string; horaLlegadaReg: string;
    tarifaNeta: number; tarifaParaEmpaquetar: number; fechaDevolucion: string; fechaEmision: string; notas: string; rangosEdad: number[];
  };
  proveedores: ProveedorOpt[]; destinos: DestinoOpt[]; rangos: RangoEdad[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ ...inicial, tarifaParaEmpaquetar: String(inicial.tarifaParaEmpaquetar), tarifaNeta: String(inicial.tarifaNeta) });
  const [proveedorId, setProveedorId] = useState<number | "">(inicial.proveedorId ?? "");
  // Valores con los que arrancan los combos: sirven para saber si el usuario
  // cambió origen/destino (ver resolverOrigenRutaEdicion).
  const [origenIdInicial] = useState<number | "">(() => origenIdDesdeGuardado(destinos, inicial.origen));
  const destinoIdInicial: number | "" = inicial.destinoId ?? "";
  const [destinoId, setDestinoId] = useState<number | "">(destinoIdInicial);
  const [origenId, setOrigenId] = useState<number | "">(origenIdInicial);
  const [rangosSel, setRangosSel] = useState<number[]>(inicial.rangosEdad);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  // Sin tocar origen ni destino se conservan origen y ruta guardados; si se
  // cambian, la ruta se recalcula (IATA_ORIGEN - IATA_DESTINO - IATA_ORIGEN)
  // y, si no se puede armar, el guardado queda bloqueado con un mensaje.
  const origenRuta = resolverOrigenRutaEdicion({
    destinos,
    origenGuardado: inicial.origen,
    rutaGuardada: inicial.ruta,
    origenIdInicial,
    destinoIdInicial,
    origenId,
    destinoId,
  });
  const origenFueraDeCatalogo = origenIdInicial === "" && inicial.origen.trim() !== "";

  function guardar() {
    setMsg("");
    if (!origenRuta.ok) { setMsg(origenRuta.error); return; }
    const { origen, ruta } = origenRuta;
    start(async () => {
      const r = await actualizarBloqueo(bloqueoId, {
        record: f.record, aerolinea: f.aerolinea, proveedorId: proveedorId === "" ? null : Number(proveedorId),
        destinoId: destinoId === "" ? null : Number(destinoId), ruta, origen,
        vueloIda: f.vueloIda, fechaIda: f.fechaIda, horaSalidaIda: f.horaSalidaIda, horaLlegadaIda: f.horaLlegadaIda,
        vueloRegreso: f.vueloRegreso, fechaRegreso: f.fechaRegreso, horaSalidaReg: f.horaSalidaReg, horaLlegadaReg: f.horaLlegadaReg,
        tarifaNeta: Number(f.tarifaNeta) || 0, tarifaParaEmpaquetar: Number(f.tarifaParaEmpaquetar) || 0, fechaDevolucion: f.fechaDevolucion, fechaEmision: f.fechaEmision,
        notas: f.notas, rangosEdad: rangosSel,
      });
      if (r.ok) { setMsg("Guardado."); setOpen(false); router.refresh(); } else setMsg(r.error);
    });
  }

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="editar-bloqueo-panel"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-gray-700">Editar bloqueo (no cambia cupos)</span>
        <Chevron className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </button>
      {open && (
        <div id="editar-bloqueo-panel" className="space-y-5 border-t border-gray-100 p-4">
          <section className={card}>
            <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Datos del bloqueo</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div><label className={lbl}>Record (PNR)</label><Input value={f.record} onChange={set("record")} /></div>
              <div><label className={lbl}>Aerolínea</label><Input value={f.aerolinea} onChange={set("aerolinea")} /></div>
              <div>
                <label className={lbl}>Proveedor aéreo</label>
                <ComboProveedor proveedores={proveedores} value={proveedorId} onChange={setProveedorId} placeholder="Selecciona proveedor…" />
              </div>
              <div>
                <label className={lbl}>Origen</label>
                <ComboDestino destinos={destinos} value={origenId} onChange={setOrigenId} placeholder="Ciudad de origen…" />
                {origenFueraDeCatalogo && origenRuta.ok && origenRuta.modo === "conservado" && (
                  <p className="mt-1 text-xs text-gray-500">
                    Origen guardado «{inicial.origen}» no está en el catálogo de destinos: se conserva junto con la ruta mientras no cambies origen ni destino.
                  </p>
                )}
                {!origenRuta.ok && origenRuta.campo === "origen" && (
                  <p role="alert" className="mt-1 text-xs text-red-600">{origenRuta.error}</p>
                )}
              </div>
              <div>
                <label className={lbl}>Destino</label>
                <ComboDestino destinos={destinos} value={destinoId} onChange={setDestinoId} placeholder="Ciudad de destino…" />
                {!origenRuta.ok && origenRuta.campo === "destino" && (
                  <p role="alert" className="mt-1 text-xs text-red-600">{origenRuta.error}</p>
                )}
              </div>
              <div>
                <label className={lbl}>Ruta (automática)</label>
                <Input value={origenRuta.ok ? origenRuta.ruta : ""} readOnly disabled placeholder="Se arma con Origen y Destino" className="bg-gray-50 text-gray-600" />
              </div>
              <div><label className={lbl}>Tarifa neta (pago aerolínea)</label><Input type="number" min={0} value={f.tarifaNeta} onChange={set("tarifaNeta")} /></div>
              <div><label className={lbl}>Tarifa empaquetar (reventa)</label><Input type="number" min={0} value={f.tarifaParaEmpaquetar} onChange={set("tarifaParaEmpaquetar")} /></div>
              <div><label className={lbl}>Fecha devolución</label><DateInput aria-label="Fecha devolución" type="date" value={f.fechaDevolucion} onValueChange={(dateValue) => setF({ ...f, ["fechaDevolucion"]: dateValue })} /></div>
            </div>
            <RangosEdadPicker rangos={rangos} seleccionados={rangosSel} onChange={setRangosSel} label="Rangos de edad del vuelo (infante/niño)" />
          </section>

          <section className={card}>
            <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Vuelo de ida</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><label className={lbl}># Vuelo</label><Input value={f.vueloIda} onChange={set("vueloIda")} /></div>
              <div><label className={lbl}>Fecha ida</label><DateInput aria-label="Fecha ida" type="date" value={f.fechaIda} onValueChange={(dateValue) => setF({ ...f, ["fechaIda"]: dateValue })} /></div>
              <div><label className={lbl}>Hora salida</label><Input type="time" aria-label="Hora salida ida" value={f.horaSalidaIda} onChange={set("horaSalidaIda")} /></div>
              <div><label className={lbl}>Hora llegada</label><Input type="time" aria-label="Hora llegada ida" value={f.horaLlegadaIda} onChange={set("horaLlegadaIda")} /></div>
            </div>
          </section>

          <section className={card}>
            <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Vuelo de regreso</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><label className={lbl}># Vuelo</label><Input value={f.vueloRegreso} onChange={set("vueloRegreso")} /></div>
              <div><label className={lbl}>Fecha regreso</label><DateInput aria-label="Fecha regreso" type="date" value={f.fechaRegreso} onValueChange={(dateValue) => setF({ ...f, ["fechaRegreso"]: dateValue })} /></div>
              <div><label className={lbl}>Hora salida</label><Input type="time" aria-label="Hora salida regreso" value={f.horaSalidaReg} onChange={set("horaSalidaReg")} /></div>
              <div><label className={lbl}>Hora llegada</label><Input type="time" aria-label="Hora llegada regreso" value={f.horaLlegadaReg} onChange={set("horaLlegadaReg")} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Fecha límite de emisión</label><DateInput aria-label="Fecha límite de emisión" type="date" value={f.fechaEmision} onValueChange={(dateValue) => setF({ ...f, ["fechaEmision"]: dateValue })} /></div>
              <div><label className={lbl}>Notas</label><Input value={f.notas} onChange={set("notas")} /></div>
            </div>
          </section>

          <div className="flex items-center gap-3">
            <Button type="button" onClick={guardar} disabled={pending || !origenRuta.ok} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Guardando…" : "Guardar cambios"}
            </Button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
