"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearPaquete, actualizarPaquete, listarDestinosAereosCandidatos, type PaqueteConfig } from "./actions";
import { ComboDestino } from "@/components/ComboDestino";
import { trmValida90 } from "@/lib/reservar/monedaPublicacion90";

type Opt = { id: number; nombre: string; codigo_iata?: string | null };

type Tipo = "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
type Initial = Partial<{
  nombre: string;
  tipo: Tipo;
  noches: number;
  activo: boolean;
  destinoId: number | null;
  fechaCompraInicio: string;
  fechaCompraFin: string;
  fechaViajeInicio: string;
  fechaViajeFin: string;
  pctMk: number;          // porcentaje (20 = 20 %)
  impuestoTipo: "tiquete" | "fijo";
  impuestoFijo: number;
  notas: string;
  condicionPagoTipo: string;
  condicionPagoPctInicial: number | null;
  condicionPagoDiasSaldo: number | null;
  restriccionComercial: string;
  programaIncluye: string;
  programaNoIncluye: string;
  programaTarifasEspeciales: string;
  programaCondicionesComerciales: string;
  // #67 — destinos aéreos alternativos (solo Bloqueo/Sistema).
  destinosAereosAlternativos: boolean;
  destinosAereosIds: number[];
  // #63 — modo de oferta del paquete (solo Dinámico): "legacy" o "cop_trm_63" (COP con la TRM del paquete).
  modoOferta: string;
  trmOferta: number | null;
  // #90 D — moneda de publicación ELEGIDA (COP | USD); null = aún sin elegir.
  monedaPublicacion: string | null;
}>;

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function ConfigForm({
  destinos,
  id,
  initial,
}: {
  destinos: Opt[];
  id?: number;
  initial?: Initial;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [tipo, setTipo] = useState<Tipo>(initial?.tipo ?? "bloqueo");
  const [noches, setNoches] = useState(initial?.noches != null ? String(initial.noches) : "3");
  const [activo, setActivo] = useState(initial?.activo ?? true);
  const [destinoId, setDestinoId] = useState<number | "">(initial?.destinoId ?? "");
  const [compraIni, setCompraIni] = useState(initial?.fechaCompraInicio ?? "");
  const [compraFin, setCompraFin] = useState(initial?.fechaCompraFin ?? "");
  const [viajeIni, setViajeIni] = useState(initial?.fechaViajeInicio ?? "");
  const [viajeFin, setViajeFin] = useState(initial?.fechaViajeFin ?? "");
  const [pctMk, setPctMk] = useState(initial?.pctMk != null ? String(initial.pctMk) : "");
  const [impTipo, setImpTipo] = useState<"tiquete" | "fijo">(initial?.impuestoTipo ?? "tiquete");
  const [impFijo, setImpFijo] = useState(initial?.impuestoFijo != null ? String(initial.impuestoFijo) : "");
  const [notas, setNotas] = useState(initial?.notas ?? "");
  // Condición de pago (migración 164) — inicializar SIEMPRE con lo guardado.
  const [condicionPagoTipo, setCondicionPagoTipo] = useState(initial?.condicionPagoTipo ?? "normal");
  const [condicionPagoPct, setCondicionPagoPct] = useState(
    initial?.condicionPagoPctInicial != null ? String(Math.round(initial.condicionPagoPctInicial * 100)) : ""
  );
  const [condicionPagoDias, setCondicionPagoDias] = useState(
    initial?.condicionPagoDiasSaldo != null ? String(initial.condicionPagoDiasSaldo) : ""
  );
  const [restriccionComercial, setRestriccionComercial] = useState(initial?.restriccionComercial ?? "normal");
  const [programaIncluye, setProgramaIncluye] = useState(initial?.programaIncluye ?? "");
  const [programaNoIncluye, setProgramaNoIncluye] = useState(initial?.programaNoIncluye ?? "");
  const [programaTarifasEspeciales, setProgramaTarifasEspeciales] = useState(initial?.programaTarifasEspeciales ?? "");
  const [programaCondicionesComerciales, setProgramaCondicionesComerciales] = useState(initial?.programaCondicionesComerciales ?? "");
  // #67 — destinos aéreos alternativos: check por paquete + selección múltiple de
  // destinos del MISMO país. Los candidatos los entrega el servidor (una sola
  // regla de país); el servidor y la base vuelven a validar al guardar.
  // #63 — modo con conversión por TRM (solo Dinámico): el tarifario se publica en la moneda elegida (COP o USD) y lo que esté en la otra
  // moneda se convierte con esta TRM (USD→COP × TRM; COP→USD / TRM).
  const [modoOferta, setModoOferta] = useState<"legacy" | "cop_trm_63">(initial?.modoOferta === "cop_trm_63" ? "cop_trm_63" : "legacy");
  const [trmOferta, setTrmOferta] = useState(initial?.trmOferta != null ? String(initial.trmOferta) : "");
  const modo63 = tipo === "dinamico" && modoOferta === "cop_trm_63";
  // #90 D — la moneda de publicación se ELIGE EXPRESAMENTE (COP o USD; nunca se deduce de los hoteles ni se asume). Un paquete NUEVO arranca
  // sin moneda, también en el modo de conversión por TRM. Única excepción, de LECTURA: un paquete ya guardado en ese modo con moneda NULL es
  // anterior a la 233 y publicaba en COP, así que se muestra como COP; eso no es un valor por defecto para paquetes nuevos.
  const [monedaPub, setMonedaPub] = useState<"" | "COP" | "USD">(
    initial?.monedaPublicacion === "COP" || initial?.monedaPublicacion === "USD"
      ? initial.monedaPublicacion
      : id != null && initial?.modoOferta === "cop_trm_63" ? "COP" : "",
  );
  // Los destinos aéreos permitidos (#67) aplican a Bloqueo y, en modo COP, a las salidas vinculadas de Dinámico.
  const aereosAplica = tipo === "bloqueo" || modo63;
  // Moneda elegida (vacía mientras nadie la elija: no se muestra ni se envía ninguna).
  const monedaEfectiva: "" | "COP" | "USD" = monedaPub;
  const [aereosAlt, setAereosAlt] = useState(initial?.destinosAereosAlternativos ?? false);
  const [aereosIds, setAereosIds] = useState<number[]>(initial?.destinosAereosIds ?? []);
  const [candidatos, setCandidatos] = useState<{ id: number; nombre: string; codigo_iata: string | null }[]>([]);
  const [candidatosMotivo, setCandidatosMotivo] = useState<string | null>(null);
  const [candidatosCargando, setCandidatosCargando] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!aereosAplica || destinoId === "") {
      setCandidatos([]);
      setCandidatosMotivo(null);
      return;
    }
    let vigente = true;
    setCandidatosCargando(true);
    listarDestinosAereosCandidatos(Number(destinoId)).then((r) => {
      if (!vigente) return;
      setCandidatosCargando(false);
      if (r.ok) { setCandidatos(r.candidatos); setCandidatosMotivo(r.motivo); }
      else { setCandidatos([]); setCandidatosMotivo(r.error); }
    });
    return () => { vigente = false; };
  }, [aereosAplica, destinoId]);

  const toggleAereo = (id: number) =>
    setAereosIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  function guardar() {
    if (!nombre.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    if (!monedaPub) {
      setErr("Elige la moneda de publicación del paquete (COP o USD).");
      return;
    }
    // #93: la TRM es opcional al guardar (solo se exige al publicar/cotizar si hay fuentes que convertir); si se escribe, debe ser positiva.
    if (modo63 && trmOferta.trim() !== "" && trmValida90(trmOferta) == null) {
      setErr("La TRM debe ser un número positivo (pesos por dólar). Déjala vacía solo si ningún componente hay que convertirlo (todo en la moneda de publicación).");
      return;
    }
    setErr("");
    const cfg: PaqueteConfig = {
      nombre,
      tipo,
      noches: Number(noches) || 3,
      destinoId: destinoId === "" ? null : Number(destinoId),
      fechaCompraInicio: compraIni,
      fechaCompraFin: compraFin,
      fechaViajeInicio: viajeIni,
      fechaViajeFin: viajeFin,
      pctMk: Number(pctMk) || 0,
      impuestoTipo: impTipo,
      impuestoFijo: Number(impFijo) || 0,
      activo,
      notas,
      condicionPagoTipo,
      condicionPagoPctInicial: condicionPagoPct === "" ? null : Number(condicionPagoPct),
      condicionPagoDiasSaldo: condicionPagoDias === "" ? null : Number(condicionPagoDias),
      restriccionComercial,
      programaIncluye,
      programaNoIncluye,
      programaTarifasEspeciales,
      programaCondicionesComerciales,
      // Solo Bloqueo/Sistema (y Dinámico en modo COP) usa destinos aéreos alternativos; en los
      // demás tipos no se envía nada (no se toca lo guardado).
      ...(aereosAplica ? { destinosAereosAlternativos: aereosAlt, destinosAereosIds: aereosIds } : {}),
      // #63: modo de oferta y TRM. Fuera de Dinámico siempre "legacy" (la base lo exige).
      modoOferta: modo63 ? "cop_trm_63" : "legacy",
      trmOferta: modo63 && trmOferta.trim() !== "" ? Number(trmOferta) : null,
      monedaPublicacion: monedaPub,
    };
    start(async () => {
      const r = id ? await actualizarPaquete(id, cfg) : await crearPaquete(cfg);
      if (r.ok) {
        router.push(`/dashboard/paquetes/${r.id ?? id}`);
        router.refresh();
      } else setErr(r.error);
    });
  }

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={lbl}>Nombre del paquete *</label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cartagena 4D/3N — Bloqueo junio" />
        </div>

        <div className="md:col-span-2">
          <label className={lbl}>Tipo de paquete *</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={sel}>
            <option value="bloqueo">Bloqueo (vuelo + hotel)</option>
            <option value="porcion_terrestre">Porción terrestre (solo hotel)</option>
            <option value="dinamico">Dinámico (hotel + vuelo por sistema, sin record)</option>
            <option value="servicios">Servicios (solo servicios)</option>
          </select>
          <p className="mt-1 text-[11px] text-gray-400">Define qué adicionas y en qué módulo del tarifario aparece.</p>
        </div>

        {(tipo === "porcion_terrestre" || tipo === "dinamico") && (
          <div>
            <label className={lbl}>Noches por defecto</label>
            <Input type="number" min={1} value={noches} onChange={(e) => setNoches(e.target.value)} placeholder="3" />
            <p className="mt-1 text-[11px] text-gray-400">
              {tipo === "dinamico" ? "Referencia; cada salida liquida el hotel por sus propias noches (ida→regreso)." : "Se liquida desde la fecha de inicio del viaje."}
            </p>
          </div>
        )}

        <div>
          <label className={lbl}>Destino</label>
          <ComboDestino destinos={destinos} value={destinoId} onChange={setDestinoId} />
          <p className="mt-1 text-[11px] text-gray-400">Escribe el nombre o el IATA y elígelo. Filtra los vuelos, hoteles y servicios disponibles.</p>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo (visible en el tarifario)
          </label>
        </div>

        <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3" data-testid="moneda-publicacion">
          <label className={lbl}>Moneda de publicación *</label>
          <select
            value={monedaEfectiva}
            onChange={(e) => setMonedaPub(e.target.value === "USD" ? "USD" : e.target.value === "COP" ? "COP" : "")}
            className={sel}
            aria-label="Moneda de publicación"
          >
            <option value="">Elige una moneda…</option>
            <option value="COP">COP (pesos)</option>
            <option value="USD">USD (dólares)</option>
          </select>
          <p className="mt-1 text-[11px] text-gray-400">
            {modo63
              ? "La eliges tú; no se deduce de los hoteles. Con el modo de conversión por TRM, lo que esté en la otra moneda se convierte con la TRM del paquete y lo que ya esté en esta entra sin conversión. Cambiarla invalida el tarifario."
              : "La eliges tú; no se deduce de los hoteles. Todos los componentes del paquete (hoteles, servicios, vuelos y salidas) deben estar en esta moneda: mezclar o convertir monedas solo existe en el modo con conversión por TRM. Cambiarla invalida el tarifario."}
          </p>
        </div>

        {tipo === "dinamico" && (
          <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3" data-testid="modo-oferta-63">
            <label className={lbl}>Modo de oferta</label>
            <select value={modoOferta} onChange={(e) => setModoOferta(e.target.value === "cop_trm_63" ? "cop_trm_63" : "legacy")} className={sel} aria-label="Modo de oferta">
              <option value="legacy">De siempre (moneda del hotel)</option>
              <option value="cop_trm_63">Con conversión por TRM (admite salidas vinculadas a Empaquetados sin record)</option>
            </select>
            {modo63 && (
              <div className="mt-2 max-w-xs">
                <label className={lbl}>TRM del paquete (COP por USD)</label>
                <Input type="number" min={0} step="0.01" value={trmOferta} onChange={(e) => setTrmOferta(e.target.value)} placeholder="4000" aria-label="TRM del paquete" />
                <p className="mt-1 text-[11px] text-gray-400">
                  {monedaEfectiva ? `El tarifario se publica en ${monedaEfectiva}.` : "Elige primero la moneda de publicación."} {monedaEfectiva === "USD"
                    ? "Lo que esté en COP (hoteles, servicios, vuelos y salidas) se convierte COP / TRM antes de aplicar el markup; lo que esté en USD entra sin conversión. Solo es obligatoria si algún componente está en COP; si todo está en USD déjala vacía (no requiere conversión): al contratar quien convierte la cotización debe ingresar una TRM provisional para el equivalente en pesos de las obligaciones."
                    : "Los netos en USD de hoteles, servicios y salidas se convierten con esta TRM antes de aplicar el markup. Solo es obligatoria si algún componente está en USD; si todo está en COP déjala vacía (no requiere conversión) y no se usa ninguna TRM implícita."}
                  {" "}Cambiar la TRM invalida el tarifario: hay que volver a generarlo. El impuesto fijo se interpreta en la moneda de publicación.
                </p>
              </div>
            )}
          </div>
        )}

        {aereosAplica && (
          <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3" data-testid="destinos-aereos">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={aereosAlt}
                disabled={destinoId === ""}
                onChange={(e) => setAereosAlt(e.target.checked)}
                aria-label="Permitir vuelos a otros destinos del mismo país"
              />
              Permitir vuelos a otros destinos del mismo país
            </label>
            <p className="mt-1 text-[11px] text-gray-400">
              Apagado: solo vuelos al destino comercial. Encendido: también los destinos aéreos que elijas aquí (activos y del mismo país).
              El hotel, el destino público y los servicios no cambian, y no se agregan traslados.
            </p>
            {aereosAlt && (
              <div className="mt-2">
                {candidatosCargando ? (
                  <p className="text-xs text-gray-400">Cargando destinos…</p>
                ) : candidatos.length ? (
                  <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {candidatos.map((c) => (
                      <li key={c.id}>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                          <input type="checkbox" checked={aereosIds.includes(c.id)} onChange={() => toggleAereo(c.id)} />
                          {c.nombre}{c.codigo_iata ? ` (${c.codigo_iata})` : ""}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{candidatosMotivo ?? "No hay destinos alternativos disponibles."}</p>
                )}
                <p className="mt-2 text-[11px] text-gray-400">
                  Para quitar un destino o apagar la opción, primero desvincula en la sección de vuelos los que ya estén asociados a él.
                </p>
              </div>
            )}
          </div>
        )}

        <div>
          <label className={lbl}>Vigencia de compra — desde</label>
          <DateInput aria-label="Vigencia de compra — desde" type="date" value={compraIni} onValueChange={(dateValue) => setCompraIni(dateValue)} />
        </div>
        <div>
          <label className={lbl}>Vigencia de compra — hasta</label>
          <DateInput aria-label="Vigencia de compra — hasta" type="date" value={compraFin} onValueChange={(dateValue) => setCompraFin(dateValue)} />
        </div>

        <div>
          <label className={lbl}>Rango de viaje — desde</label>
          <DateInput aria-label="Rango de viaje — desde" type="date" value={viajeIni} onValueChange={(dateValue) => setViajeIni(dateValue)} />
        </div>
        <div>
          <label className={lbl}>Rango de viaje — hasta</label>
          <DateInput aria-label="Rango de viaje — hasta" type="date" value={viajeFin} onValueChange={(dateValue) => setViajeFin(dateValue)} />
        </div>

        <div>
          <label className={lbl}>% MK (margen)</label>
          <Input type="number" min={0} max={99} value={pctMk} onChange={(e) => setPctMk(e.target.value)} placeholder="20" />
          <p className="mt-1 text-[11px] text-gray-400">PVP = costo / (1 − %mk). Aplica a hotel y servicios.</p>
        </div>

        <div>
          <label className={lbl}>Impuesto (Base No Comisionable)</label>
          <select value={impTipo} onChange={(e) => setImpTipo(e.target.value as "tiquete" | "fijo")} className={sel}>
            <option value="tiquete">Valor neto del tiquete</option>
            <option value="fijo">Valor fijo</option>
          </select>
        </div>

        {impTipo === "fijo" && (
          <div>
            <label className={lbl}>Valor fijo del impuesto</label>
            <Input type="number" min={0} value={impFijo} onChange={(e) => setImpFijo(e.target.value)} placeholder="599000" />
          </div>
        )}

        <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Condición de pago</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={lbl}>Condición</label>
              <select value={condicionPagoTipo} onChange={(e) => setCondicionPagoTipo(e.target.value)} className={sel}>
                <option value="normal">Normal</option>
                <option value="pago_total">Requiere pago total</option>
                <option value="anticipo_saldo">Anticipo y saldo</option>
              </select>
            </div>
            {condicionPagoTipo === "anticipo_saldo" && (
              <>
                <div>
                  <label className={lbl}>Anticipo inicial (%)</label>
                  <Input type="number" min={1} max={99} value={condicionPagoPct} onChange={(e) => setCondicionPagoPct(e.target.value)} placeholder="50" />
                </div>
                <div>
                  <label className={lbl}>Días antes del viaje para el saldo</label>
                  <Input type="number" min={0} value={condicionPagoDias} onChange={(e) => setCondicionPagoDias(e.target.value)} placeholder="30" />
                </div>
              </>
            )}
            <div>
              <label className={lbl}>Restricción comercial</label>
              <select value={restriccionComercial} onChange={(e) => setRestriccionComercial(e.target.value)} className={sel}>
                <option value="normal">Sin restricción</option>
                <option value="promocional_no_reembolsable_no_endosable">Promocional — no reembolsable / no endosable</option>
              </select>
            </div>
          </div>
          {restriccionComercial !== "normal" && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              Este paquete queda marcado <b>No reembolsable</b> y <b>No endosable</b>.
            </p>
          )}
        </div>

        <div className="md:col-span-2">
          <label className={lbl}>Notas (opcional)</label>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} className={sel} rows={2} />
        </div>

        <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Descripción del paquete</p>
          <p className="mb-3 text-[11px] text-gray-400">
            Este contenido pertenece al paquete y lo ven por igual TODOS sus hoteles/opciones en el tarifario. Reemplaza el &ldquo;Incluye&rdquo; que antes se armaba solo.
          </p>
          {![programaIncluye, programaNoIncluye, programaTarifasEspeciales, programaCondicionesComerciales].some((t) => t.trim() !== "") && (
            <p className="mb-3 text-xs italic text-gray-400">Sin descripción configurada.</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl}>El programa incluye</label>
              <textarea value={programaIncluye} onChange={(e) => setProgramaIncluye(e.target.value)} className={sel} rows={4} />
              <p className="mt-1 text-[11px] text-gray-400">Escribe un elemento por línea.</p>
            </div>
            <div>
              <label className={lbl}>El programa no incluye</label>
              <textarea value={programaNoIncluye} onChange={(e) => setProgramaNoIncluye(e.target.value)} className={sel} rows={4} />
              <p className="mt-1 text-[11px] text-gray-400">Escribe un elemento por línea.</p>
            </div>
            <div>
              <label className={lbl}>Tarifas especiales</label>
              <textarea value={programaTarifasEspeciales} onChange={(e) => setProgramaTarifasEspeciales(e.target.value)} className={sel} rows={4} />
              <p className="mt-1 text-[11px] text-gray-400">Escribe un elemento por línea.</p>
            </div>
            <div>
              <label className={lbl}>Condiciones comerciales</label>
              <textarea value={programaCondicionesComerciales} onChange={(e) => setProgramaCondicionesComerciales(e.target.value)} className={sel} rows={4} />
              <p className="mt-1 text-[11px] text-gray-400">Escribe un elemento por línea.</p>
            </div>
          </div>
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex justify-end">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : id ? "Guardar cambios" : "Crear y continuar →"}
        </Button>
      </div>
    </div>
  );
}
