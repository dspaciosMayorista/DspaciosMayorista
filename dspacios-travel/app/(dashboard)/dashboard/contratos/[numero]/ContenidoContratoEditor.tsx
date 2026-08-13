"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import {
  guardarItemsContrato, guardarHotelesContrato, guardarVuelosContrato,
  guardarServiciosContrato, sincronizarPrecioVenta,
  type ItemContenido, type HotelContenido, type VueloContenido, type ServicioContenido,
} from "./contenido-actions";

const TIPOS_SERVICIO = [
  { value: "asistencia", label: "Asistencia médica" },
  { value: "traslado", label: "Traslado" },
  { value: "tour", label: "Tour" },
  { value: "otro", label: "Otro" },
];

const inputCls = "w-full";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm";
const lblCls = "mb-1 block text-[11px] font-medium text-gray-500";

type Props = {
  numero: string;
  moneda: string;
  precioVenta: number;
  items: ItemContenido[];
  hoteles: HotelContenido[];
  vuelos: VueloContenido[];
  servicios: ServicioContenido[];
};

type Seccion = "items" | "hoteles" | "vuelos" | "servicios";

// Editor del CONTENIDO del contrato, exclusivo de superadmin. Nace para los
// contratos migrados del importador de histórico, que solo traen cabecera,
// abonos y cuentas por pagar: sin esto no había forma de completarles hoteles,
// vuelos, ítems ni servicios. Sirve igual para corregir cualquier contrato.
export function ContenidoContratoEditor({ numero, moneda, precioVenta, items, hoteles, vuelos, servicios }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [seccion, setSeccion] = useState<Seccion>("items");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");

  const [fItems, setFItems] = useState<ItemContenido[]>(items);
  const [fHoteles, setFHoteles] = useState<HotelContenido[]>(hoteles);
  const [fVuelos, setFVuelos] = useState<VueloContenido[]>(vuelos);
  const [fServicios, setFServicios] = useState<ServicioContenido[]>(servicios);

  const totalItems = fItems.reduce((s, it) => s + it.adultos * it.tarifaAdulto + it.ninos * it.tarifaNino, 0);
  const descuadre = Math.abs(totalItems - precioVenta) > 0.5;

  function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) {
    setMsg(""); setOk("");
    start(async () => {
      const r = await fn();
      if (r.ok) { setOk(exito); router.refresh(); }
      else setMsg(r.error);
    });
  }

  if (!abierto) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">Editar contenido del contrato</p>
            <p className="text-xs text-gray-500">
              Hoteles, vuelos, ítems de valores y servicios. Útil sobre todo en contratos migrados, que llegaron
              sin este detalle. Solo superadmin.
            </p>
          </div>
          <Button variant="outline" onClick={() => setAbierto(true)}>Abrir editor</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-gray-700">Editar contenido del contrato</p>
        <button type="button" className="text-xs text-gray-400 hover:text-gray-700" onClick={() => setAbierto(false)}>Cerrar</button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {([["items", `Ítems (${fItems.length})`], ["hoteles", `Hoteles (${fHoteles.length})`], ["vuelos", `Vuelos (${fVuelos.length})`], ["servicios", `Servicios (${fServicios.length})`]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setSeccion(v)}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-all"
            style={seccion === v
              ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" }
              : { borderColor: "#e5e7eb", color: "#6b7280" }}>
            {l}
          </button>
        ))}
      </div>

      {msg && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</p>}
      {ok && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</p>}

      {/* ── Ítems de valores ── */}
      {seccion === "items" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Es lo que ve el cliente en el documento del contrato.</p>
          {fItems.map((it, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-6">
              <div className="md:col-span-2">
                <label className={lblCls}>Descripción</label>
                <Input className={inputCls} value={it.descripcion} onChange={(e) => setFItems((a) => a.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))} />
              </div>
              <div><label className={lblCls}>Adultos</label><Input type="number" min={0} value={it.adultos} onChange={(e) => setFItems((a) => a.map((x, j) => j === i ? { ...x, adultos: Number(e.target.value) || 0 } : x))} /></div>
              <div><label className={lblCls}>Niños</label><Input type="number" min={0} value={it.ninos} onChange={(e) => setFItems((a) => a.map((x, j) => j === i ? { ...x, ninos: Number(e.target.value) || 0 } : x))} /></div>
              <div><label className={lblCls}>Tarifa adulto</label><Input type="number" min={0} value={it.tarifaAdulto} onChange={(e) => setFItems((a) => a.map((x, j) => j === i ? { ...x, tarifaAdulto: Number(e.target.value) || 0 } : x))} /></div>
              <div><label className={lblCls}>Tarifa niño</label><Input type="number" min={0} value={it.tarifaNino} onChange={(e) => setFItems((a) => a.map((x, j) => j === i ? { ...x, tarifaNino: Number(e.target.value) || 0 } : x))} /></div>
              <div className="md:col-span-6 flex items-center justify-between">
                <span className="text-xs text-gray-500">Subtotal: {formatMoneda(it.adultos * it.tarifaAdulto + it.ninos * it.tarifaNino, moneda)}</span>
                <button type="button" className="text-xs text-gray-400 hover:text-red-500" onClick={() => setFItems((a) => a.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            </div>
          ))}
          <button type="button" className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setFItems((a) => [...a, { descripcion: "", adultos: 1, ninos: 0, tarifaAdulto: 0, tarifaNino: 0 }])}>
            + Agregar ítem
          </button>

          <div className="rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-gray-500">Suma de los ítems</span>
              <span className="font-semibold text-gray-800">{formatMoneda(totalItems, moneda)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-gray-500">Precio de venta del contrato</span>
              <span className="font-semibold text-gray-800">{formatMoneda(precioVenta, moneda)}</span>
            </div>
            {descuadre && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No cuadran. El documento muestra la suma de los ítems, pero la cartera, la rentabilidad y las
                comisiones usan el precio de venta. Se dejan separados a propósito: cambiar el precio de venta
                mueve plata ya registrada, así que tiene que ser una decisión tuya.
                <div className="mt-2">
                  <Button variant="outline" disabled={pending}
                    onClick={() => correr(() => sincronizarPrecioVenta(numero), "Precio de venta actualizado.")}>
                    Igualar el precio de venta a {formatMoneda(totalItems, moneda)}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Button disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}
            onClick={() => correr(() => guardarItemsContrato(numero, fItems), "Ítems guardados.")}>
            {pending ? "Guardando…" : "Guardar ítems"}
          </Button>
        </div>
      )}

      {/* ── Hoteles ── */}
      {seccion === "hoteles" && (
        <div className="space-y-3">
          {fHoteles.map((h, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
              <div><label className={lblCls}>Hotel</label><Input value={h.nombre} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Categoría</label><Input value={h.categoria} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, categoria: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Proveedor</label><Input value={h.proveedor} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, proveedor: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Ciudad</label><Input value={h.ciudad} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, ciudad: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Alimentación</label><Input value={h.alimentacion} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, alimentacion: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Acomodación</label><Input value={h.acomodacion} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, acomodacion: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Ingreso</label><Input type="date" value={h.fechaIngreso} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, fechaIngreso: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Salida</label><Input type="date" value={h.fechaSalida} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, fechaSalida: e.target.value } : x))} /></div>
              <div className="md:col-span-3"><label className={lblCls}>Detalle acomodación</label><Input value={h.detalleAcomodacion} onChange={(e) => setFHoteles((a) => a.map((x, j) => j === i ? { ...x, detalleAcomodacion: e.target.value } : x))} /></div>
              <div className="flex items-end">
                <button type="button" className="pb-2 text-xs text-gray-400 hover:text-red-500" onClick={() => setFHoteles((a) => a.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            </div>
          ))}
          <button type="button" className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setFHoteles((a) => [...a, { nombre: "", categoria: "", proveedor: "", ciudad: "", alimentacion: "", acomodacion: "", detalleAcomodacion: "", fechaIngreso: "", fechaSalida: "" }])}>
            + Agregar hotel
          </button>
          <Button disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}
            onClick={() => correr(() => guardarHotelesContrato(numero, fHoteles), "Hoteles guardados.")}>
            {pending ? "Guardando…" : "Guardar hoteles"}
          </Button>
        </div>
      )}

      {/* ── Vuelos ── */}
      {seccion === "vuelos" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Cada fila es UN tramo. Un viaje redondo son dos (ida y regreso).</p>
          {fVuelos.map((v, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
              <div><label className={lblCls}>Aerolínea</label><Input value={v.aerolinea} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, aerolinea: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Record (PNR)</label><Input value={v.record} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, record: e.target.value } : x))} /></div>
              <div>
                <label className={lblCls}>Tramo</label>
                <select className={selCls} value={v.direccion} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, direccion: e.target.value } : x))}>
                  <option value="">Suelto (multi-ciudad)</option>
                  <option value="ida">Ida</option>
                  <option value="regreso">Regreso</option>
                </select>
              </div>
              <div><label className={lblCls}>N.° de vuelo</label><Input value={v.numeroVuelo} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, numeroVuelo: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Origen (IATA)</label><Input value={v.origenCodigo} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, origenCodigo: e.target.value.toUpperCase() } : x))} /></div>
              <div><label className={lblCls}>Destino (IATA)</label><Input value={v.destinoCodigo} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, destinoCodigo: e.target.value.toUpperCase() } : x))} /></div>
              <div><label className={lblCls}>Fecha</label><Input type="date" value={v.fecha} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, fecha: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Hora salida</label><Input value={v.horaSalida} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, horaSalida: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Hora llegada</label><Input value={v.horaLlegada} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, horaLlegada: e.target.value } : x))} /></div>
              <div className="md:col-span-2"><label className={lblCls}>Equipaje / servicios</label><Input value={v.servicios} onChange={(e) => setFVuelos((a) => a.map((x, j) => j === i ? { ...x, servicios: e.target.value } : x))} /></div>
              <div className="flex items-end">
                <button type="button" className="pb-2 text-xs text-gray-400 hover:text-red-500" onClick={() => setFVuelos((a) => a.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            </div>
          ))}
          <button type="button" className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setFVuelos((a) => [...a, { aerolinea: "", record: "", direccion: "", origenCodigo: "", destinoCodigo: "", numeroVuelo: "", fecha: "", horaSalida: "", horaLlegada: "", servicios: "" }])}>
            + Agregar tramo
          </button>
          <Button disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}
            onClick={() => correr(() => guardarVuelosContrato(numero, fVuelos), "Vuelos guardados.")}>
            {pending ? "Guardando…" : "Guardar vuelos"}
          </Button>
        </div>
      )}

      {/* ── Servicios ── */}
      {seccion === "servicios" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Asistencia médica, traslados, tours. El costo es interno; la cuenta por pagar al proveedor se
            administra aparte, en la pestaña Proveedores.
          </p>
          {fServicios.map((s, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
              <div>
                <label className={lblCls}>Tipo</label>
                <select className={selCls} value={s.tipo} onChange={(e) => setFServicios((a) => a.map((x, j) => j === i ? { ...x, tipo: e.target.value } : x))}>
                  {TIPOS_SERVICIO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="md:col-span-2"><label className={lblCls}>Descripción</label><Input value={s.descripcion} onChange={(e) => setFServicios((a) => a.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Proveedor</label><Input value={s.proveedor} onChange={(e) => setFServicios((a) => a.map((x, j) => j === i ? { ...x, proveedor: e.target.value } : x))} /></div>
              <div><label className={lblCls}>Costo neto ({moneda})</label><Input type="number" min={0} value={s.costo} onChange={(e) => setFServicios((a) => a.map((x, j) => j === i ? { ...x, costo: Number(e.target.value) || 0 } : x))} /></div>
              <div className="flex items-end md:col-span-3">
                <button type="button" className="pb-2 text-xs text-gray-400 hover:text-red-500" onClick={() => setFServicios((a) => a.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            </div>
          ))}
          <button type="button" className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setFServicios((a) => [...a, { tipo: "asistencia", descripcion: "", proveedor: "", costo: 0 }])}>
            + Agregar servicio
          </button>
          <Button disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}
            onClick={() => correr(() => guardarServiciosContrato(numero, fServicios), "Servicios guardados.")}>
            {pending ? "Guardando…" : "Guardar servicios"}
          </Button>
        </div>
      )}
    </div>
  );
}
