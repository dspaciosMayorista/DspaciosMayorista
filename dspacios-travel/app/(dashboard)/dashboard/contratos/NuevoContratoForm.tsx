"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import {
  crearContrato,
  type PasajeroInput,
  type HotelInput,
  type VueloInput,
  type ItemInput,
  type TipoPaquete,
} from "./actions";

const hoy = new Date().toISOString().slice(0, 10);

export type PaqueteOpt = {
  id: number;
  categoria: "bloqueo" | "porcion_terrestre";
  nombre: string;
  plan_alimentacion: string | null;
  impuesto_no_comisionable: number;
  paquete_hoteles: { nombre: string; ciudad: string | null; alimentacion: string | null; acomodacion_detalle: string | null }[];
  paquete_precios: { acomodacion: string; precio: number }[];
};
export type BloqueoOpt = { id: number; record: string; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null; aerolinea: string | null };

const TIPOS: { value: TipoPaquete; label: string }[] = [
  { value: "bloqueo", label: "Bloqueo (negociado + vuelo)" },
  { value: "porcion_terrestre", label: "Porción terrestre negociada" },
  { value: "empaquetado", label: "Empaquetado (tiquetes por sistema)" },
  { value: "dinamico", label: "Dinámico (todo manual)" },
];

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const sectionCls = "rounded-xl border border-gray-200 bg-white p-5 space-y-4";
const titleCls = "text-sm font-semibold";

export function NuevoContratoForm({
  asesorDefault,
  paquetes = [],
  bloqueos = [],
}: {
  asesorDefault: string;
  paquetes?: PaqueteOpt[];
  bloqueos?: BloqueoOpt[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Tipo de paquete y producto negociado
  const [tipoPaquete, setTipoPaquete] = useState<TipoPaquete>("dinamico");
  const [paqueteId, setPaqueteId] = useState<number | "">("");
  const [bloqueoId, setBloqueoId] = useState<number | "">("");
  const esNegociado = tipoPaquete === "bloqueo" || tipoPaquete === "porcion_terrestre";
  const paquetesFiltrados = paquetes.filter((p) => p.categoria === tipoPaquete);

  // Cliente
  const [cliente, setCliente] = useState("");
  const [doc, setDoc] = useState("");
  const [tel, setTel] = useState("");
  const [dir, setDir] = useState("");

  // Generales
  const [destino, setDestino] = useState("");
  const [fechaSalida, setFechaSalida] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [fechaEmision, setFechaEmision] = useState(hoy);
  const [planNombre, setPlanNombre] = useState("");
  const [tours, setTours] = useState("");
  const [asistencia, setAsistencia] = useState(false);

  // Firma
  const [asesorNombre, setAsesorNombre] = useState(asesorDefault);
  const [asesorCargo, setAsesorCargo] = useState("Asesor/a");
  const [asesorCc, setAsesorCc] = useState("");
  const [asesorTel, setAsesorTel] = useState("");

  // Listas dinámicas
  const [pasajeros, setPasajeros] = useState<PasajeroInput[]>([
    { nombre: "", tipoId: "CC", identificacion: "", fechaNacimiento: "", esInfante: false },
  ]);
  const [hoteles, setHoteles] = useState<HotelInput[]>([]);
  const [vuelos, setVuelos] = useState<VueloInput[]>([]);
  const [items, setItems] = useState<ItemInput[]>([
    { descripcion: "Plan turístico", adultos: 1, ninos: 0, tarifaAdulto: 0, tarifaNino: 0 },
  ]);

  const total = items.reduce(
    (s, it) => s + it.adultos * it.tarifaAdulto + it.ninos * it.tarifaNino,
    0
  );

  function setItem(i: number, patch: Partial<ItemInput>) {
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }
  function setPasajero(i: number, patch: Partial<PasajeroInput>) {
    setPasajeros((arr) => arr.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }
  function setHotel(i: number, patch: Partial<HotelInput>) {
    setHoteles((arr) => arr.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  }
  function setVuelo(i: number, patch: Partial<VueloInput>) {
    setVuelos((arr) => arr.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  }

  function aplicarPaquete(idStr: string) {
    const id = Number(idStr) || "";
    setPaqueteId(id);
    const pk = paquetes.find((p) => p.id === id);
    if (!pk) return;
    setPlanNombre(pk.plan_alimentacion ?? "");
    setHoteles(
      pk.paquete_hoteles.map((h) => ({
        nombre: h.nombre, ciudad: h.ciudad ?? "", alimentacion: h.alimentacion ?? "",
        acomodacion: "", detalleAcomodacion: h.acomodacion_detalle ?? "", fechaIngreso: "", fechaSalida: "",
      }))
    );
    const precioDoble = pk.paquete_precios.find((x) => x.acomodacion === "doble")?.precio
      ?? pk.paquete_precios[0]?.precio ?? 0;
    const precioNino = pk.paquete_precios.find((x) => x.acomodacion === "nino")?.precio ?? 0;
    setItems([{ descripcion: pk.nombre, adultos: 1, ninos: 0, tarifaAdulto: precioDoble, tarifaNino: precioNino }]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!cliente.trim()) {
      setError("El nombre del cliente es obligatorio.");
      return;
    }
    const pasajerosOk = pasajeros.filter((p) => p.nombre.trim() !== "");
    const hotelesOk = hoteles.filter((h) => h.nombre.trim() !== "");
    const vuelosOk = vuelos.filter((v) => v.aerolinea.trim() !== "");
    const itemsOk = items.filter((it) => it.descripcion.trim() !== "");

    startTransition(async () => {
      try {
        const res = await crearContrato({
          tipoPaquete,
          paqueteId: paqueteId === "" ? null : Number(paqueteId),
          bloqueoId: bloqueoId === "" ? null : Number(bloqueoId),
          cliente,
          clienteDocumento: doc,
          clienteTelefono: tel,
          clienteDireccion: dir,
          destino,
          fechaSalida,
          fechaRegreso,
          fechaEmision,
          asistenciaMedica: asistencia,
          planNombre,
          toursTraslados: tours,
          asesorNombre,
          asesorCargo,
          asesorCc,
          asesorTel,
          pasajeros: pasajerosOk,
          hoteles: hotelesOk,
          vuelos: vuelosOk,
          items: itemsOk,
        });
        if (res.ok) {
          router.push(`/dashboard/contratos/${encodeURIComponent(res.numero)}`);
        } else {
          setError(res.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al crear el contrato.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Tipo de paquete */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>Tipo de paquete</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls}>Tipo *</label>
            <select
              value={tipoPaquete}
              onChange={(e) => { setTipoPaquete(e.target.value as TipoPaquete); setPaqueteId(""); setBloqueoId(""); }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {esNegociado && (
            <div>
              <label className={labelCls}>Producto del tarifario</label>
              <select value={paqueteId} onChange={(e) => aplicarPaquete(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona un paquete</option>
                {paquetesFiltrados.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          )}
          {tipoPaquete === "bloqueo" && (
            <div>
              <label className={labelCls}>Record (descuenta cupos)</label>
              <select value={bloqueoId} onChange={(e) => setBloqueoId(Number(e.target.value) || "")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona record</option>
                {bloqueos.map((b) => <option key={b.id} value={b.id}>{b.record} · {b.ruta} · {b.fecha_ida}</option>)}
              </select>
            </div>
          )}
        </div>
        {esNegociado && (
          <p className="text-xs text-gray-400">
            Los hoteles, el plan y los precios se cargan del producto (no edites el precio).
            Los costos quedan de uso interno y no se muestran al asesor.
          </p>
        )}
      </section>

      {/* Cliente */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
          Cliente
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={labelCls}>Nombre completo *</label>
            <Input value={cliente} onChange={(e) => setCliente(e.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>N° Documento</label>
            <Input value={doc} onChange={(e) => setDoc(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Teléfono</label>
            <Input value={tel} onChange={(e) => setTel(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Dirección</label>
            <Input value={dir} onChange={(e) => setDir(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Datos generales */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
          Datos del viaje
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={labelCls}>Destino</label>
            <Input value={destino} onChange={(e) => setDestino(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Fecha de salida (viaje)</label>
            <Input type="date" value={fechaSalida} onChange={(e) => setFechaSalida(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Fecha de regreso</label>
            <Input type="date" value={fechaRegreso} onChange={(e) => setFechaRegreso(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Fecha de emisión</label>
            <Input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Plan / Servicio</label>
            <Input value={planNombre} onChange={(e) => setPlanNombre(e.target.value)} placeholder="PLAN COMBINADO 8D-7N…" />
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={asistencia} onChange={(e) => setAsistencia(e.target.checked)} className="rounded" />
              Incluye asistencia médica
            </label>
          </div>
        </div>
        <div>
          <label className={labelCls}>Tours y traslados</label>
          <Input value={tours} onChange={(e) => setTours(e.target.value)} placeholder="Traslados aeropuerto-hotel, city tour…" />
        </div>
      </section>

      {/* Vuelos */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Vuelos (trayectos)
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() =>
              setVuelos((a) => [...a, { aerolinea: "", origenCodigo: "", origenCiudad: "", destinoCodigo: "", destinoCiudad: "", servicios: "", fechaSalida: "" }])
            }
          >
            + Agregar trayecto
          </button>
        </div>
        {vuelos.length === 0 && (
          <p className="text-xs text-gray-400">Sin vuelos (porción terrestre).</p>
        )}
        {vuelos.map((v, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
            <Input placeholder="Aerolínea" value={v.aerolinea} onChange={(e) => setVuelo(i, { aerolinea: e.target.value })} />
            <Input placeholder="Origen (cód)" value={v.origenCodigo} onChange={(e) => setVuelo(i, { origenCodigo: e.target.value })} />
            <Input placeholder="Origen (ciudad)" value={v.origenCiudad} onChange={(e) => setVuelo(i, { origenCiudad: e.target.value })} />
            <Input type="date" value={v.fechaSalida} onChange={(e) => setVuelo(i, { fechaSalida: e.target.value })} />
            <Input placeholder="Destino (cód)" value={v.destinoCodigo} onChange={(e) => setVuelo(i, { destinoCodigo: e.target.value })} />
            <Input placeholder="Destino (ciudad)" value={v.destinoCiudad} onChange={(e) => setVuelo(i, { destinoCiudad: e.target.value })} />
            <Input className="md:col-span-2" placeholder="Servicios (equipaje…)" value={v.servicios} onChange={(e) => setVuelo(i, { servicios: e.target.value })} />
            <button type="button" className="text-xs text-gray-400 hover:text-red-500" onClick={() => setVuelos((a) => a.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
      </section>

      {/* Hoteles */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Hoteles
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() =>
              setHoteles((a) => [...a, { nombre: "", ciudad: "", alimentacion: "", acomodacion: "", detalleAcomodacion: "", fechaIngreso: "", fechaSalida: "" }])
            }
          >
            + Agregar hotel
          </button>
        </div>
        {hoteles.length === 0 && <p className="text-xs text-gray-400">Sin hoteles cargados.</p>}
        {hoteles.map((h, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
            <Input placeholder="Hotel" value={h.nombre} onChange={(e) => setHotel(i, { nombre: e.target.value })} />
            <Input placeholder="Ciudad" value={h.ciudad} onChange={(e) => setHotel(i, { ciudad: e.target.value })} />
            <Input placeholder="Alimentación (P.A, PAM…)" value={h.alimentacion} onChange={(e) => setHotel(i, { alimentacion: e.target.value })} />
            <Input placeholder="Acomodación (Doble…)" value={h.acomodacion} onChange={(e) => setHotel(i, { acomodacion: e.target.value })} />
            <Input className="md:col-span-2" placeholder="Detalle acomodación" value={h.detalleAcomodacion} onChange={(e) => setHotel(i, { detalleAcomodacion: e.target.value })} />
            <Input type="date" value={h.fechaIngreso} onChange={(e) => setHotel(i, { fechaIngreso: e.target.value })} />
            <Input type="date" value={h.fechaSalida} onChange={(e) => setHotel(i, { fechaSalida: e.target.value })} />
            <button type="button" className="text-xs text-gray-400 hover:text-red-500 md:col-span-4 md:text-right" onClick={() => setHoteles((a) => a.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
      </section>

      {/* Pasajeros */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Pasajeros
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setPasajeros((a) => [...a, { nombre: "", tipoId: "CC", identificacion: "", fechaNacimiento: "", esInfante: false }])}
          >
            + Agregar pasajero
          </button>
        </div>
        {pasajeros.map((p, i) => (
          <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-5">
            <Input placeholder="Nombre completo" value={p.nombre} onChange={(e) => setPasajero(i, { nombre: e.target.value })} />
            <Input placeholder="Tipo ID" value={p.tipoId} onChange={(e) => setPasajero(i, { tipoId: e.target.value })} />
            <Input placeholder="Identificación" value={p.identificacion} onChange={(e) => setPasajero(i, { identificacion: e.target.value })} />
            <Input type="date" value={p.fechaNacimiento} onChange={(e) => setPasajero(i, { fechaNacimiento: e.target.value })} />
            <div className="flex items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={p.esInfante} onChange={(e) => setPasajero(i, { esInfante: e.target.checked })} />
                Infante
              </label>
              <button type="button" className="text-xs text-gray-400 hover:text-red-500" onClick={() => setPasajeros((a) => a.filter((_, j) => j !== i))}>
                Quitar
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* Valores */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
            Detalle de valores
          </p>
          <button
            type="button"
            className="text-xs font-medium text-[#1D7C9A] hover:underline"
            onClick={() => setItems((a) => [...a, { descripcion: "", adultos: 0, ninos: 0, tarifaAdulto: 0, tarifaNino: 0 }])}
          >
            + Agregar ítem
          </button>
        </div>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-6">
              <div className="md:col-span-2">
                <label className={labelCls}>Ítem</label>
                <Input value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Adultos</label>
                <Input type="number" min={0} value={it.adultos} onChange={(e) => setItem(i, { adultos: Number(e.target.value) })} />
              </div>
              <div>
                <label className={labelCls}>Niños</label>
                <Input type="number" min={0} value={it.ninos} onChange={(e) => setItem(i, { ninos: Number(e.target.value) })} />
              </div>
              <div>
                <label className={labelCls}>Tarifa adulto {esNegociado && <span className="text-gray-400">🔒</span>}</label>
                <Input type="number" min={0} value={it.tarifaAdulto} disabled={esNegociado}
                  className={esNegociado ? "bg-gray-100" : ""}
                  onChange={(e) => setItem(i, { tarifaAdulto: Number(e.target.value) })} />
              </div>
              <div>
                <label className={labelCls}>Tarifa niño {esNegociado && <span className="text-gray-400">🔒</span>}</label>
                <Input type="number" min={0} value={it.tarifaNino} disabled={esNegociado}
                  className={esNegociado ? "bg-gray-100" : ""}
                  onChange={(e) => setItem(i, { tarifaNino: Number(e.target.value) })} />
              </div>
              {items.length > 1 && (
                <button type="button" className="text-xs text-gray-400 hover:text-red-500 md:col-span-6 md:text-right" onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>
                  Quitar ítem
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <span className="text-sm text-gray-500">Total del contrato:</span>
          <span className="text-xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>
            {formatCOP(total)}
          </span>
        </div>
      </section>

      {/* Firma asesor */}
      <section className={sectionCls}>
        <p className={titleCls} style={{ color: "var(--brand-primary)" }}>
          Asesor que firma
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className={labelCls}>Nombre</label>
            <Input value={asesorNombre} onChange={(e) => setAsesorNombre(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Cargo</label>
            <Input value={asesorCargo} onChange={(e) => setAsesorCargo(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>CC</label>
            <Input value={asesorCc} onChange={(e) => setAsesorCc(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Teléfono</label>
            <Input value={asesorTel} onChange={(e) => setAsesorTel(e.target.value)} />
          </div>
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Generando contrato…" : "Generar contrato"}
        </Button>
        <span className="text-xs text-gray-400">
          Se asignará automáticamente un número de contrato (00-NNNN).
        </span>
      </div>
    </form>
  );
}
