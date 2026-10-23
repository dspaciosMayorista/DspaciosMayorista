"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  Info,
  Loader2,
  Search,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/DateInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ETIQUETA_ACOMODACION } from "@/lib/salesbot/respuestas";
import { textoEsSeguro } from "@/lib/salesbot/respuestas";

import {
  buscarProgramasVentana,
  consultarDetalleVentana,
  generarBorradorVentana,
} from "./consultas";
import {
  AYUDA_TIPO,
  ETIQUETA_TIPO,
  TIPOS_CONSULTA,
  exigeDatosDeViaje,
  type BorradorVentana,
  type ConsultaVentanaInput,
  type ResultadoBusquedaVentana,
  type ResultadoDetalleVentana,
  type SalesbotDetalleProgramaSeguro,
  type TipoConsulta,
} from "./tiposVista";

const ACOMODACIONES = Object.entries(ETIQUETA_ACOMODACION).map(([valor, etiqueta]) => ({
  valor,
  etiqueta,
}));

function nf(n: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);
}

export function VentanaProgramasClient({
  rol,
  nombreAsesor,
  tipoInicial,
}: {
  rol: string;
  nombreAsesor: string;
  tipoInicial: TipoConsulta;
}) {
  const [tipo, setTipo] = useState<TipoConsulta>(tipoInicial);
  const [destino, setDestino] = useState("");
  const [texto, setTexto] = useState("");
  const [transporte, setTransporte] = useState("ninguno");
  const [fecha, setFecha] = useState("");
  const [pax, setPax] = useState("");
  const [acomodacion, setAcomodacion] = useState("");
  const [edadInputs, setEdadInputs] = useState<string[]>([]);
  const [programaId, setProgramaId] = useState<number | null>(null);

  const [busqueda, setBusqueda] = useState<ResultadoBusquedaVentana | null>(null);
  const [detalle, setDetalle] = useState<ResultadoDetalleVentana | null>(null);
  const [borrador, setBorrador] = useState<BorradorVentana | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const nPax = pax.trim() === "" ? null : Number(pax);
  const paxNumerico = Number.isInteger(nPax) && (nPax as number) >= 1 ? (nPax as number) : null;

  // Las edades solo se piden con `pax` conocido. Es la misma regla de Fase A
  // (`datosFaltantesParaCotizar`) aplicada en la UI, para no preguntar algo que
  // el motor despues va a volver a preguntar.
  const puedeEditarEdades = paxNumerico != null;
  const faltanEdades = puedeEditarEdades && edadInputs.filter(Boolean).length !== paxNumerico;

  const entrada: ConsultaVentanaInput = useMemo(
    () => ({
      tipoConsulta: tipo,
      destino,
      texto,
      tipoTransporte: transporte === "ninguno" ? undefined : (transporte as "aereo" | "terrestre"),
      programaId,
      fechaSalida: fecha,
      pax: paxNumerico,
      edades: edadInputs.map((e) => (e.trim() === "" ? NaN : Number(e))),
      acomodacion,
      nombreAsesor,
    }),
    [tipo, destino, texto, transporte, programaId, fecha, paxNumerico, edadInputs, acomodacion, nombreAsesor],
  );

  const faltantes = useMemo(() => {
    const f: string[] = [];
    if (!destino.trim() && !texto.trim()) f.push("destino o texto");
    if (exigeDatosDeViaje(tipo)) {
      if (!fecha.trim()) f.push("fecha de salida");
      if (paxNumerico == null) f.push("numero de pasajeros");
      else if (faltanEdades) f.push(paxNumerico > 1 ? "edad de cada pasajero" : "edad del pasajero");
      if (!acomodacion.trim()) f.push("tipo de alojamiento");
    }
    return f;
  }, [destino, texto, tipo, fecha, paxNumerico, faltanEdades, acomodacion]);

  function buscar() {
    setBorrador(null);
    setDetalle(null);
    startTransition(async () => {
      const r = await buscarProgramasVentana(entrada);
      setBusqueda(r);
      if (r.ok && !r.programas.some((p) => p.id === programaId)) setProgramaId(null);
    });
  }

  function verDetalle(id: number) {
    setProgramaId(id);
    setBorrador(null);
    startTransition(async () => {
      setDetalle(await consultarDetalleVentana(id));
    });
  }

  function generar() {
    startTransition(async () => {
      const r = await generarBorradorVentana(entrada);
      setCopiado(false);
      setBorrador(r.ok ? r.borrador : null);
    });
  }

  async function copiar() {
    if (!borrador?.seguro || borrador.texto.length === 0) return;
    // Doble verificacion: si alguien cambio el texto en memoria, no se copia.
    if (!textoEsSeguro(borrador.texto)) return;
    try {
      await navigator.clipboard.writeText(borrador.texto);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  const d: SalesbotDetalleProgramaSeguro | null = detalle?.ok ? detalle.detalle : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── Formulario ───────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Consulta</h2>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700">Tipo de consulta</span>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoConsulta)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_CONSULTA.map((t) => (
                <SelectItem key={t} value={t}>{ETIQUETA_TIPO[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="block text-xs text-gray-500">{AYUDA_TIPO[tipo]}</span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">Destino</span>
            <Input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Leticia" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">Texto libre</span>
            <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Amazonas" />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700">Tipo de transporte</span>
          <Select value={transporte} onValueChange={(v) => setTransporte(v ?? "ninguno")}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ninguno">Todos</SelectItem>
              <SelectItem value="aereo">Con aereo</SelectItem>
              <SelectItem value="terrestre">Terrestre</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">Fecha de salida</span>
            {/* El `DateInput` del repo, no un `<input type="date">` nativo: hay un
                guardián (`calendariosCobertura.test.ts`) que prohíbe el picker
                nativo para que las fechas usen el mismo calendario. */}
            <DateInput
              aria-label="Fecha de salida"
              value={fecha}
              onValueChange={setFecha}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">Pasajeros</span>
            <Input
              type="number"
              min={1}
              value={pax}
              onChange={(e) => {
                setPax(e.target.value);
                setEdadInputs([]);
              }}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">Acomodacion</span>
            <Select value={acomodacion} onValueChange={(v) => setAcomodacion(v ?? "")}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Elegir" /></SelectTrigger>
              <SelectContent>
                {ACOMODACIONES.map((a) => (
                  <SelectItem key={a.valor} value={a.valor}>{a.etiqueta}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        {/* Las edades solo existen si ya se sabe cuantos pasajeros hay. */}
        <div className="space-y-1">
          <span className="text-sm font-medium text-gray-700">Edades</span>
          {!puedeEditarEdades ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Escribe primero el numero de pasajeros. Las edades se piden una por una.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: paxNumerico as number }).map((_, i) => (
                  <Input
                    key={i}
                    type="number"
                    min={0}
                    className="w-24"
                    placeholder={`Edad ${i + 1}`}
                    value={edadInputs[i] ?? ""}
                    onChange={(e) => {
                      const next = [...edadInputs];
                      next[i] = e.target.value;
                      setEdadInputs(next);
                    }}
                  />
                ))}
              </div>
              {faltanEdades ? (
                <p className="text-xs text-amber-700">
                  Faltan {paxNumerico! - edadInputs.filter(Boolean).length} edad(es).
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={buscar} disabled={pendiente} variant="outline">
            {pendiente ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Buscar
          </Button>
          <Button onClick={generar} disabled={pendiente}>
            <Wallet size={16} />
            Generar respuesta
          </Button>
        </div>

        {faltantes.length > 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Para este tipo de consulta falta: {faltantes.join(", ")}.
          </p>
        ) : null}
      </section>

      {/* ── Resultados ───────────────────────────────────────────────── */}
      <div className="space-y-4">
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Programas publicados
          </h2>

          {busqueda?.ok ? (
            <>
              <p className="text-xs text-gray-500">{busqueda.programas.length} encontrado(s).</p>
              <ul className="space-y-2">
                {busqueda.programas.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => verDetalle(p.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        programaId === p.id
                          ? "border-gray-900 bg-gray-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <span className="block font-medium text-gray-900">{p.nombre}</span>
                      <span className="block text-xs text-gray-500">
                        {[p.noches ? `${p.noches} noches` : null, p.subtitulo, (p.ciudades ?? []).join(", ")]
                          .filter(Boolean)
                          .join(" / ")}
                      </span>
                      {/* El precio del resumen solo se pinta si es numero real. */}
                      <span className="block text-xs text-gray-700">
                        {p.desde_pvp != null && p.desde_pvp > 0
                          ? `Desde ${nf(p.desde_pvp)} ${p.moneda}`
                          : "precio a confirmar"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {/* El resumen no trae esto; se declara para que el texto no lo afirme. */}
              {busqueda.noConsultado.length > 0 ? (
                <p className="flex items-start gap-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  El resumen NO trae: {busqueda.noConsultado.join(", ")}.
                </p>
              ) : null}
            </>
          ) : busqueda && !busqueda.ok ? (
            <AvisoError codigo={busqueda.codigo} mensaje={busqueda.mensaje} />
          ) : (
            <p className="text-sm text-gray-400">Sin busqueda todavia.</p>
          )}
        </section>

        {d ? <PanelDetalle detalle={d} /> : null}

        {detalle && !detalle.ok ? (
          <AvisoError codigo={detalle.codigo} mensaje={detalle.mensaje} />
        ) : null}

        {/* ── Borrador ───────────────────────────────────────────────── */}
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Respuesta sugerida
          </h2>

          {borrador ? (
            <>
              {borrador.seguro && borrador.texto ? (
                <>
                  <textarea
                    readOnly
                    rows={12}
                    value={borrador.texto}
                    aria-label="Respuesta sugerida"
                    className="w-full rounded-lg border border-gray-300 p-3 font-mono text-xs text-gray-800"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={copiar} variant={copiado ? "outline" : "default"}>
                      {copiado ? <Check size={16} /> : <Copy size={16} />}
                      {copiado ? "Copiado" : "Copiar"}
                    </Button>
                    {borrador.requiereEscalamiento ? (
                      <span className="text-xs text-amber-700">Requiere confirmar con un asesor.</span>
                    ) : null}
                  </div>
                </>
              ) : (
                /* Bloqueado: no hay textarea, no hay boton. El texto no existe
                   para esta pantalla, no esta "oculto". */
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-red-800">
                    <Ban size={16} />
                    Texto bloqueado: no se muestra ni se puede copiar.
                  </p>
                  <ul className="space-y-1 text-xs text-red-700">
                    {borrador.frasesBloqueadas.map((f, i) => (
                      <li key={i}>
                        <span className="font-medium">{f.frase}</span> &mdash; {f.porQue}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-red-700">
                    Suele ser una frase comercial dentro de un texto del catalogo.
                  </p>
                </div>
              )}

              {borrador.avisos.length > 0 ? (
                <ul className="space-y-1">
                  {borrador.avisos.map((a, i) => (
                    <li key={i} className="flex items-start gap-1 text-xs text-gray-500">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-gray-400">Sin respuesta generada.</p>
          )}
        </section>

        <p className="text-xs text-gray-400">
          Sesion: {rol}. Nada de lo que escribas se guarda ni se envia.
        </p>
      </div>
    </div>
  );
}

function AvisoError({ codigo, mensaje }: { codigo: string; mensaje: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>
        {mensaje}
        <span className="block text-xs opacity-70">{codigo}</span>
      </span>
    </p>
  );
}

/**
 * Panel del detalle. Solo consume el DTO seguro de `lib/salesbot`: no hay forma
 * de pintar `notas`, `neto`, `pct_mk`, `regla_comisionable*`, `tarifa_*` ni
 * `impulso_*` porque ninguno tiene tipo en el DTO.
 *
 * `blackouts` SI aparece y es deliberado: son fechas bloqueadas, no cupos, y el
 * asesor necesita verlas. NO entran al texto sugerible.
 */
function PanelDetalle({ detalle }: { detalle: SalesbotDetalleProgramaSeguro }) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{detalle.nombre}</h2>
        <p className="text-xs text-gray-500">
          {[detalle.dias ? `${detalle.dias} dias` : null, detalle.noches ? `${detalle.noches} noches` : null,
            detalle.proveedor_nombre].filter(Boolean).join(" / ")}
        </p>
      </div>

      {detalle.ciudades.length ? (
        <p className="text-xs text-gray-600">
          Itinerario: {detalle.ciudades.map((c) => c.nombre).join(" - ")}
        </p>
      ) : null}

      {detalle.categorias.length ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase text-gray-500">Precios por categoria</h3>
          {detalle.categorias.map((c) => (
            <div key={c.id} className="text-xs">
              <p className="font-medium text-gray-700">{c.nombre ?? "General"}</p>
              <ul className="text-gray-600">
                {c.precios.map((p, i) => (
                  <li key={i}>
                    {p.acomodacion}:{" "}
                    {p.estado_precio === "A_SOLICITUD"
                      ? "a solicitud"
                      : p.pvp != null && p.pvp > 0
                        ? `${nf(p.pvp)} ${p.moneda}`
                        : "precio a confirmar"}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {detalle.salidas.length ? (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase text-gray-500">Salidas</h3>
          <ul className="text-xs text-gray-600">
            {detalle.salidas.map((s) => (
              <li key={s.id}>
                {s.etiqueta ?? "Salida"}: {s.fecha_desde ?? "por confirmar"}
                {s.fecha_hasta ? ` al ${s.fecha_hasta}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detalle.blackouts.length ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">Fechas bloqueadas en el catalogo ({detalle.blackouts.length}).</p>
          <p className="mt-1">
            Son fechas sin operacion. NO son disponibilidad ni disponibilidad negativa: no las
            uses como respuesta a una pregunta por cupos.
          </p>
        </div>
      ) : null}

      {detalle.texto_condiciones || detalle.texto_cancelacion || detalle.texto_pagos ? (
        <div className="space-y-1 text-xs text-gray-600">
          {detalle.texto_condiciones ? <p><span className="font-medium">Condiciones:</span> {detalle.texto_condiciones}</p> : null}
          {detalle.texto_cancelacion ? <p><span className="font-medium">Cancelacion:</span> {detalle.texto_cancelacion}</p> : null}
          {detalle.texto_pagos ? <p><span className="font-medium">Pagos:</span> {detalle.texto_pagos}</p> : null}
        </div>
      ) : null}
    </section>
  );
}