"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP, calcularEdad } from "@/lib/utils";
import { reservarDesdeTarifario, cotizarPorFechas, type PasajeroReserva } from "../actions";
import { precioServicio } from "@/lib/calc/paquetes";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, paxTarifaDe, clasificarPorEdad, validarReservaHabitaciones, type AcomConfig, type AcomRoom } from "@/lib/acomodaciones";

export type ServicioDisp = {
  servicioId: number;
  nombre: string;
  modo: "persona" | "grupo";
  personaPvp: number | null;
  grupos: { pax_desde: number; pax_hasta: number; precio: number }[];
};

export type Meta = {
  paqueteId: number;
  hotelId: number;
  bloqueoId: number | null;
  modulo: "bloqueo" | "porcion_terrestre" | "servicios";
  hotelNombre: string;
  destino: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  bloqueoLabel: string | null;
  edadInfanteMax: number;
  edadNinoMax: number;
  paxMinHotel: number | null;
  paxMaxHotel: number | null;
};
export type Combo = { categoria: string; regimen: string; precios: Record<string, number> };

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function ReservaForm({
  meta, combos, serviciosDisp = [], acomConfigs = [],
}: { meta: Meta; combos: Combo[]; serviciosDisp?: ServicioDisp[]; acomConfigs?: AcomConfig[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const esServicios = meta.modulo === "servicios";
  // Motor por fechas: en porción/dinámico el asesor elige las fechas y se
  // re-liquida; en bloqueo las fechas son fijas (del record).
  const esPorFechas = meta.modulo === "porcion_terrestre";

  // Combos (categoría/régimen → precios) pueden recargarse al cotizar por fechas.
  const [combosState, setCombosState] = useState<Combo[]>(combos);
  const [fIda, setFIda] = useState(meta.fechaIda ?? "");
  const [fReg, setFReg] = useState(meta.fechaRegreso ?? "");
  const [nochesCot, setNochesCot] = useState<number | null>(meta.noches);
  const [cotPend, startCot] = useTransition();
  const [cotErr, setCotErr] = useState("");

  function cotizar() {
    setCotErr("");
    startCot(async () => {
      const r = await cotizarPorFechas({ paqueteId: meta.paqueteId, hotelId: meta.hotelId, fechaIda: fIda, fechaRegreso: fReg });
      if (r.ok) { setCombosState(r.combos); setNochesCot(r.noches); }
      else setCotErr(r.error);
    });
  }

  const categorias = useMemo(() => [...new Set(combosState.map((c) => c.categoria))], [combosState]);
  const [cat, setCat] = useState(categorias[0] ?? "");
  const catSel = categorias.includes(cat) ? cat : (categorias[0] ?? "");
  const regimenes = useMemo(() => combosState.filter((c) => c.categoria === catSel).map((c) => c.regimen), [combosState, catSel]);
  const [regState, setRegState] = useState("");
  const reg = regimenes.includes(regState) ? regState : (regimenes[0] ?? "");

  const combo = combosState.find((c) => c.categoria === catSel && c.regimen === reg);
  const precios = combo?.precios ?? {};

  // Reserva por HABITACIONES: cantidad de habitaciones por tipo (sencilla/doble/…).
  const [habs, setHabs] = useState<Record<string, string>>({});
  const [ninos, setNinos] = useState("0");
  const [ninos2, setNinos2] = useState("0");
  const [infantes, setInfantes] = useState("0");
  const [paxServ, setPaxServ] = useState("1");

  const roomTypes = ACOM_ROOMS.filter((a) => precios[a] != null);
  const paxTarifa = (a: AcomRoom) => paxTarifaDe(acomConfigs, a);

  const paxRooms = roomTypes.reduce((s, a) => s + (Number(habs[a]) || 0) * paxTarifa(a), 0);
  const numNinos = precios["nino"] != null ? (Number(ninos) || 0) : 0;
  const numNinos2 = precios["nino2"] != null ? (Number(ninos2) || 0) : 0;
  const numInfantes = Number(infantes) || 0;
  const paxConSilla = paxRooms + numNinos + numNinos2;
  const totalPax = esServicios ? (Number(paxServ) || 0) : paxConSilla + numInfantes;
  const numHabitaciones = roomTypes.reduce((s, a) => s + (Number(habs[a]) || 0), 0);

  const totalHotel =
    roomTypes.reduce((s, a) => s + (Number(habs[a]) || 0) * paxTarifa(a) * precios[a]!, 0) +
    numNinos * (precios["nino"] ?? 0) +
    numNinos2 * (precios["nino2"] ?? 0);

  // Servicios add-on (precio según pax)
  const [servSel, setServSel] = useState<Set<number>>(new Set());
  function precioServ(s: ServicioDisp): number {
    return precioServicio(s.modo, s.personaPvp, s.grupos, totalPax);
  }
  const totalServicios = serviciosDisp.reduce((acc, s) => (servSel.has(s.servicioId) ? acc + precioServ(s) : acc), 0);
  const totalPrecio = totalHotel + totalServicios;

  // Cliente
  const [cli, setCli] = useState({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" });

  // Tipo de venta
  const [tipoAsesor, setTipoAsesor] = useState<"interno" | "agencia" | "freelance">("interno");
  const [asesorInterno, setAsesorInterno] = useState("");
  const [agenciaNombre, setAgenciaNombre] = useState("");
  const [agenciaAsesor, setAgenciaAsesor] = useState("");
  const [freelanceNombre, setFreelanceNombre] = useState("");
  const [plazo, setPlazo] = useState("");

  // Pasajeros: la cantidad de filas se deriva del total; los datos se guardan
  // en `pax` (se extiende según se editen).
  const emptyPax = (): PasajeroReserva => ({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", fechaNacimiento: "", nacionalidad: "Colombiana", esInfante: false });
  const [pax, setPax] = useState<PasajeroReserva[]>([]);
  const paxRows = Array.from({ length: totalPax }, (_, i) => pax[i] ?? emptyPax());

  // Validación pasajeros ↔ acomodación (punto 4)
  const habitacionesNum: Record<string, number> = {};
  for (const a of roomTypes) { const n = Number(habs[a]) || 0; if (n > 0) habitacionesNum[a] = n; }
  const refFecha = esPorFechas ? (fIda || null) : meta.fechaIda;
  const real = esServicios ? undefined : clasificarPorEdad(
    paxRows.map((p) => calcularEdad(p.fechaNacimiento, refFecha)),
    meta.edadInfanteMax, meta.edadNinoMax
  );
  const validacion = esServicios
    ? { errores: [] as string[], avisos: [] as string[] }
    : validarReservaHabitaciones({
        habitaciones: habitacionesNum,
        reglas: acomConfigs,
        ninosDeclarados: numNinos + numNinos2,
        infantesDeclarados: numInfantes,
        paxMinHotel: meta.paxMinHotel,
        paxMaxHotel: meta.paxMaxHotel,
        real,
      });
  const bloquear = validacion.errores.length > 0;

  function setPaxField(i: number, k: keyof PasajeroReserva, v: string) {
    setPax((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(emptyPax());
      next[i] = { ...next[i], [k]: v };
      return next;
    });
  }
  function copiarCliente(i: number) {
    setPax((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(emptyPax());
      next[i] = { ...next[i], nombres: cli.nombres, apellidos: cli.apellidos, tipoDoc: cli.tipoDoc, numeroDoc: cli.numeroDoc };
      return next;
    });
  }

  function guardar() {
    if (!cli.nombres.trim() || !cli.apellidos.trim()) { setErr("Nombres y apellidos del cliente son obligatorios."); return; }
    if (esServicios) {
      if (totalPax <= 0) { setErr("Indica el número de pasajeros."); return; }
      if (!servSel.size) { setErr("Selecciona al menos un servicio."); return; }
    } else if (numHabitaciones <= 0 && paxConSilla <= 0) {
      setErr("Indica al menos una habitación."); return;
    } else if (paxConSilla <= 0) {
      setErr("Las habitaciones elegidas no suman pasajeros."); return;
    }
    if (!esServicios && validacion.errores.length) {
      setErr(validacion.errores[0]); return;
    }
    // Nombres y apellidos obligatorios en todos los pasajeros.
    const faltaNombre = paxRows.findIndex((p) => !p.nombres.trim() || !p.apellidos.trim());
    if (faltaNombre >= 0) { setErr(`Pasajero ${faltaNombre + 1}: nombres y apellidos son obligatorios.`); return; }
    // Validación de documento: solo Pasaporte admite letras; el resto, solo números.
    const docOk = (tipo: string, num: string) => tipo === "PAS" || num.trim() === "" || /^\d+$/.test(num.trim());
    if (!docOk(cli.tipoDoc, cli.numeroDoc)) { setErr("El número de documento del cliente debe ser solo números (excepto Pasaporte)."); return; }
    const malDoc = paxRows.findIndex((p) => !docOk(p.tipoDoc, p.numeroDoc));
    if (malDoc >= 0) { setErr(`El documento del pasajero ${malDoc + 1} debe ser solo números (excepto Pasaporte).`); return; }
    setErr("");
    const habitaciones: Record<string, number> = {};
    if (!esServicios) for (const a of roomTypes) if (Number(habs[a]) > 0) habitaciones[a] = Number(habs[a]);
    const cortePax = esServicios ? totalPax : paxConSilla;
    const pasajeros = paxRows.map((p, idx) => ({ ...p, esInfante: idx >= cortePax }));
    start(async () => {
      const r = await reservarDesdeTarifario({
        paqueteId: meta.paqueteId, bloqueoId: meta.bloqueoId, modulo: meta.modulo, hotelId: meta.hotelId,
        categoria: esServicios ? "" : catSel, regimen: esServicios ? "" : reg,
        fechaIda: esPorFechas ? (fIda || undefined) : undefined,
        fechaRegreso: esPorFechas ? (fReg || undefined) : undefined,
        habitaciones, ninos: numNinos, ninos2: numNinos2, infantes: numInfantes,
        paxServicios: totalPax,
        cliente: cli, tipoAsesor, asesorInterno, agenciaNombre, agenciaAsesor, freelanceNombre, plazo, pasajeros,
        servicios: [...servSel],
      });
      if (r.ok) router.push(`/dashboard/contratos/${r.numero}`);
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-5">
      {esServicios && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Pasajeros</p>
          <div className="w-40">
            <label className={lbl}>Número de pasajeros</label>
            <Input type="number" min={1} value={paxServ} onChange={(e) => setPaxServ(e.target.value)} />
          </div>
          <p className="mt-3 text-sm text-gray-600">
            {totalPax} pasajero(s) · Total <b style={{ color: "var(--brand-primary)" }}>{formatCOP(totalPrecio)}</b>
          </p>
        </section>
      )}
      {/* Fechas (motor por fechas: porción / dinámico) */}
      {esPorFechas && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="mb-1 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Fechas del viaje</p>
          <p className="mb-3 text-xs text-gray-400">Elige las fechas y actualiza las tarifas: se liquidan esas noches (mezclando temporadas del hotel).</p>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className={lbl}>Fecha de ida</label><Input type="date" value={fIda} onChange={(e) => setFIda(e.target.value)} /></div>
            <div><label className={lbl}>Fecha de regreso</label><Input type="date" value={fReg} onChange={(e) => setFReg(e.target.value)} /></div>
            <Button type="button" onClick={cotizar} disabled={cotPend || !fIda || !fReg} style={{ backgroundColor: "var(--brand-accent)" }}>
              {cotPend ? "Cotizando…" : "Ver tarifas para estas fechas"}
            </Button>
            {nochesCot != null && <span className="text-sm text-gray-500">{nochesCot} noche(s)</span>}
          </div>
          {cotErr && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{cotErr}</p>}
        </section>
      )}
      {/* Habitaciones */}
      {!esServicios && (
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Habitaciones</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl}>Categoría</label>
            <select value={catSel} onChange={(e) => setCat(e.target.value)} className={inp}>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Régimen</label>
            <select value={reg} onChange={(e) => setRegState(e.target.value)} className={inp}>
              {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-4 mb-1 text-xs font-medium text-gray-500">Cantidad de habitaciones por tipo</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {roomTypes.map((a) => {
            const pt = paxTarifa(a);
            return (
              <div key={a}>
                <label className={lbl}>
                  {ACOM_ROOM_LABEL[a]} · {pt} pax<br />
                  <span className="text-[11px] text-gray-400">{formatCOP(precios[a]! * pt)} / hab</span>
                </label>
                <Input type="number" min={0} value={habs[a] ?? ""} onChange={(e) => setHabs({ ...habs, [a]: e.target.value })} placeholder="0" />
              </div>
            );
          })}
        </div>
        <p className="mt-4 mb-1 text-xs font-medium text-gray-500">Niños e infantes (por cantidad, dentro de las habitaciones)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {precios["nino"] != null && (
            <div>
              <label className={lbl}>Niño 1 · {formatCOP(precios["nino"]!)}</label>
              <Input type="number" min={0} value={ninos} onChange={(e) => setNinos(e.target.value)} />
            </div>
          )}
          {precios["nino2"] != null && (
            <div>
              <label className={lbl}>Niño 2 · {formatCOP(precios["nino2"]!)}</label>
              <Input type="number" min={0} value={ninos2} onChange={(e) => setNinos2(e.target.value)} />
            </div>
          )}
          <div>
            <label className={lbl}>Infantes (sin silla, $0)</label>
            <Input type="number" min={0} value={infantes} onChange={(e) => setInfantes(e.target.value)} />
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {numHabitaciones} habitación(es) · {totalPax} pasajero(s) · Hotel <b>{formatCOP(totalHotel)}</b>
          {totalServicios > 0 && <> + servicios <b>{formatCOP(totalServicios)}</b></>}
          {" "}· Total <b style={{ color: "var(--brand-primary)" }}>{formatCOP(totalPrecio)}</b>
        </p>
      </section>
      )}

      {/* Servicios adicionales (add-on) */}
      {serviciosDisp.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Servicios adicionales</p>
          <ul className="divide-y divide-gray-100">
            {serviciosDisp.map((s) => {
              const precio = precioServ(s);
              const sel = servSel.has(s.servicioId);
              return (
                <li key={s.servicioId} className="flex items-center justify-between py-2.5">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={(e) => {
                        setServSel((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(s.servicioId); else n.delete(s.servicioId);
                          return n;
                        });
                      }}
                    />
                    <span className="text-sm text-gray-800">
                      {s.nombre}{" "}
                      <span className="text-xs text-gray-400">({s.modo === "grupo" ? `por grupo · ${totalPax} pax` : "por persona"})</span>
                    </span>
                  </label>
                  <span className="text-sm tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(precio)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Cliente */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Cliente</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl}>Nombres *</label><Input value={cli.nombres} onChange={(e) => setCli({ ...cli, nombres: e.target.value })} /></div>
          <div><label className={lbl}>Apellidos *</label><Input value={cli.apellidos} onChange={(e) => setCli({ ...cli, apellidos: e.target.value })} /></div>
          <div>
            <label className={lbl}>Tipo doc</label>
            <select value={cli.tipoDoc} onChange={(e) => setCli({ ...cli, tipoDoc: e.target.value })} className={inp}>
              <option value="CC">CC</option><option value="CE">CE</option><option value="PAS">Pasaporte</option><option value="TI">TI</option>
            </select>
          </div>
          <div><label className={lbl}>Número doc</label><Input value={cli.numeroDoc} onChange={(e) => setCli({ ...cli, numeroDoc: e.target.value })} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={cli.telefono} onChange={(e) => setCli({ ...cli, telefono: e.target.value })} /></div>
          <div><label className={lbl}>Email</label><Input type="email" value={cli.email} onChange={(e) => setCli({ ...cli, email: e.target.value })} /></div>
        </div>
      </section>

      {/* Tipo de venta */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Tipo de venta</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {([["interno", "Asesor interno (B2C)"], ["agencia", "Agencia (B2B)"], ["freelance", "Freelance (B2B)"]] as const).map(([v, label]) => (
            <label key={v} className="flex items-center gap-1">
              <input type="radio" checked={tipoAsesor === v} onChange={() => setTipoAsesor(v)} /> {label}
            </label>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tipoAsesor === "interno" && (
            <div><label className={lbl}>Asesor interno</label><Input value={asesorInterno} onChange={(e) => setAsesorInterno(e.target.value)} /></div>
          )}
          {tipoAsesor === "agencia" && (
            <>
              <div><label className={lbl}>Nombre de la agencia</label><Input value={agenciaNombre} onChange={(e) => setAgenciaNombre(e.target.value)} /></div>
              <div><label className={lbl}>Asesor de la agencia</label><Input value={agenciaAsesor} onChange={(e) => setAgenciaAsesor(e.target.value)} /></div>
            </>
          )}
          {tipoAsesor === "freelance" && (
            <div><label className={lbl}>Nombre del freelance</label><Input value={freelanceNombre} onChange={(e) => setFreelanceNombre(e.target.value)} /></div>
          )}
          <div><label className={lbl}>Plazo para confirmar</label><Input type="date" value={plazo} onChange={(e) => setPlazo(e.target.value)} /></div>
        </div>
      </section>

      {/* Pasajeros */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Pasajeros ({totalPax})</p>
        {!totalPax ? (
          <p className="text-sm text-gray-400">Indica habitaciones arriba para capturar pasajeros.</p>
        ) : (
          <div className="space-y-3">
            {paxRows.map((p, i) => {
              const esInfante = i >= paxConSilla;
              return (
                <div key={i} className="rounded-lg border border-gray-100 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">
                      Pasajero {i + 1}{esInfante ? " · Infante" : ""}
                    </span>
                    {i === 0 && (
                      <button type="button" onClick={() => copiarCliente(0)} className="text-xs" style={{ color: "var(--brand-accent)" }}>
                        Copiar datos del cliente
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div><label className={lbl}>Nombres *</label><Input value={p.nombres} onChange={(e) => setPaxField(i, "nombres", e.target.value)} /></div>
                    <div><label className={lbl}>Apellidos *</label><Input value={p.apellidos} onChange={(e) => setPaxField(i, "apellidos", e.target.value)} /></div>
                    <div>
                      <label className={lbl}>Tipo doc</label>
                      <select value={p.tipoDoc} onChange={(e) => setPaxField(i, "tipoDoc", e.target.value)} className={inp}>
                        <option value="CC">CC</option><option value="CE">CE</option><option value="PAS">Pasaporte</option><option value="TI">TI</option><option value="RC">RC</option>
                      </select>
                    </div>
                    <div><label className={lbl}>Número doc</label><Input value={p.numeroDoc} onChange={(e) => setPaxField(i, "numeroDoc", e.target.value)} /></div>
                    <div><label className={lbl}>Fecha nacimiento</label><Input type="date" value={p.fechaNacimiento} onChange={(e) => setPaxField(i, "fechaNacimiento", e.target.value)} /></div>
                    <div><label className={lbl}>Nacionalidad</label><Input value={p.nacionalidad} onChange={(e) => setPaxField(i, "nacionalidad", e.target.value)} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Validación pasajeros ↔ acomodación */}
      {validacion.errores.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {validacion.errores.map((e, i) => <li key={i}>⚠ {e}</li>)}
        </ul>
      )}
      {validacion.avisos.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {validacion.avisos.map((a, i) => <li key={i}>ⓘ {a}</li>)}
        </ul>
      )}
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <div className="flex justify-end">
        <Button onClick={guardar} disabled={pending || bloquear} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Generando…" : "Generar contrato (pendiente)"}
        </Button>
      </div>
    </div>
  );
}
