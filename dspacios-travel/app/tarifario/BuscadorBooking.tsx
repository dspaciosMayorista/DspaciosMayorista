"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { formatCOP } from "@/lib/utils";
import { ACOM_ROOMS, ACOM_ROOM_LABEL, type AcomRoom } from "@/lib/acomodaciones";
import { useCart, type HotelCartItem } from "@/lib/cart/CartContext";
import { buscarHoteles } from "@/app/(dashboard)/dashboard/reservar/actions";
import { type BusquedaResultado } from "@/lib/reservar/cotizar";
import { EDAD_MENOR_MAX, MAX_MENORES_POR_CONSULTA, ajustarCantidadEdades, parseEdadMenor } from "@/lib/reservar/edadesMenores";

export function BuscadorBooking({
  fotosPorHotel = {}, infoPorHotel = {}, destinos = [],
}: {
  fotosPorHotel?: Record<number, string>;
  infoPorHotel?: Record<number, { estrellas: number | null; clasificacion: string | null; descripcion: string | null; adultsOnly?: boolean; petFriendly?: boolean }>;
  destinos?: string[];
}) {
  const idBase = useId();
  const hoy = new Date().toISOString().slice(0, 10);
  const [fIda, setFIda] = useState(hoy);
  const [fReg, setFReg] = useState("");
  const [adultos, setAdultos] = useState("2");
  const [destino, setDestino] = useState("");
  const [nHab, setNHab] = useState("1");
  const [habs, setHabs] = useState<AcomRoom[]>(["doble"]);
  const [cantidadMenores, setCantidadMenoresState] = useState(0);
  const [edadesTxt, setEdadesTxt] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [avisoHab, setAvisoHab] = useState("");
  const [resultados, setResultados] = useState<BusquedaResultado[] | null>(null);
  const [diagnostico, setDiagnostico] = useState<string | null>(null);
  const [soloPetFriendly, setSoloPetFriendly] = useState(false);
  const [soloAdultsOnly, setSoloAdultsOnly] = useState(false);

  // Ajusta el nº de filas de habitación (tope de 8; 9+ requiere asesor).
  function setCantidad(n: number) {
    const pedido = Math.trunc(n) || 1;
    setAvisoHab(pedido > 8 ? "A partir de 9 habitaciones, contacta a un asesor." : "");
    const cant = Math.max(1, Math.min(8, pedido));
    setNHab(String(cant));
    setHabs((prev) => {
      const next = [...prev];
      while (next.length < cant) next.push("doble");
      next.length = cant;
      return next;
    });
  }
  const setHab = (i: number, acom: AcomRoom) => setHabs((p) => p.map((h, n) => (n === i ? acom : h)));

  // Cantidad de menores: agrega campos de edad vacíos al final o quita solo
  // los sobrantes del final — las edades ya escritas nunca se pierden/reordenan.
  function setCantidadMenores(nRaw: number) {
    setCantidadMenoresState(Math.max(0, Math.min(MAX_MENORES_POR_CONSULTA, Math.trunc(nRaw) || 0)));
    setEdadesTxt((prev) => ajustarCantidadEdades(prev, nRaw));
  }
  const setEdadAt = (i: number, v: string) => setEdadesTxt((prev) => prev.map((x, idx) => (idx === i ? v : x)));

  const edadesParsed = edadesTxt.map(parseEdadMenor);
  const edadesValidas = edadesParsed.every((p) => p.error == null);
  const edadesFaltantes = edadesParsed.filter((p) => p.valor == null).length;
  const edades = edadesParsed.map((p) => p.valor).filter((v): v is number => v != null);
  const menoresListos = cantidadMenores === 0 || edadesValidas;

  // "Adultos" es un campo real de la consulta: se valida y se envía al motor
  // (antes quedaba en el estado sin usarse). Entero ≥ 1, nunca decimal/texto/
  // negativo — el servidor vuelve a validar esto mismo, este parseo es solo
  // para dar feedback inmediato y no bloquear con un valor a medio escribir.
  const adultosTrim = adultos.trim();
  const adultosParsed = /^\d+$/.test(adultosTrim) ? Number(adultosTrim) : null;
  const adultosValido = adultosParsed != null && adultosParsed >= 1;

  function buscar() {
    setErr(""); setResultados(null); setDiagnostico(null);
    if (!fIda || !fReg) { setErr("Indica fecha de ida y de regreso."); return; }
    if (!adultosValido) { setErr("La cantidad de adultos debe ser un entero mayor o igual a 1."); return; }
    if (!menoresListos) { setErr(`Falta la edad de ${edadesFaltantes} menor(es).`); return; }
    start(async () => {
      const r = await buscarHoteles({
        fechaIda: fIda, fechaRegreso: fReg,
        habitaciones: habs.map((acom) => ({ acom })),
        adultos: adultosParsed,
        cantidadMenores, edadesMenores: edades,
        destino,
      });
      if (r.ok) { setResultados(r.resultados); setDiagnostico(r.diagnostico ?? null); }
      else setErr(r.error);
    });
  }

  const resultadosFiltrados = useMemo(() => {
    if (!resultados) return null;
    return resultados.filter((r) => {
      const info = infoPorHotel[r.hotelId];
      if (soloPetFriendly && !info?.petFriendly) return false;
      if (soloAdultsOnly && !info?.adultsOnly) return false;
      return true;
    });
  }, [resultados, infoPorHotel, soloPetFriendly, soloAdultsOnly]);

  const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="mb-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Buscar alojamiento</p>
        <div className="flex flex-wrap items-end gap-3">
          {destinos.length > 0 && (
            <div><label className="mb-1 block text-xs text-gray-500">Destino</label>
              <select value={destino} onChange={(e) => setDestino(e.target.value)} className={sel}>
                <option value="">Todos</option>
                {destinos.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div><label className="mb-1 block text-xs text-gray-500">Ida</label><input type="date" min={hoy} value={fIda} onChange={(e) => { const nueva = e.target.value; setFIda(nueva); if (fReg && fReg <= nueva) setFReg(""); }} className={sel} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Regreso</label><input type="date" min={fIda} value={fReg} onChange={(e) => setFReg(e.target.value)} className={sel} /></div>
          <div><label className="mb-1 block text-xs text-gray-500">Adultos (12+)</label>
            <input type="number" min={1} value={adultos} onChange={(e) => setAdultos(e.target.value)}
              className={`${sel} w-20 ${!adultosValido ? "border-red-400" : ""}`} aria-invalid={!adultosValido ? true : undefined} />
          </div>
          <div><label htmlFor={`${idBase}-cant`} className="mb-1 block text-xs text-gray-500">Cantidad de menores</label>
            <input id={`${idBase}-cant`} type="number" inputMode="numeric" min={0} max={MAX_MENORES_POR_CONSULTA} value={cantidadMenores}
              onChange={(e) => setCantidadMenores(Number(e.target.value))} className={`${sel} w-20`} />
          </div>
          <div><label className="mb-1 block text-xs text-gray-500">Habitaciones</label><input type="number" min={1} max={8} value={nHab} onChange={(e) => setCantidad(Number(e.target.value))} className={`${sel} w-20`} /></div>
        </div>

        {/* Una fila por habitación: solo el tipo de acomodación (los menores se
            declaran aparte, por edad exacta — no por habitación). */}
        <div className="mt-3 space-y-2">
          {habs.map((acom, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-gray-500">Habitación {i + 1}</span>
              <select value={acom} onChange={(e) => setHab(i, e.target.value as AcomRoom)} className={sel}>
                {ACOM_ROOMS.map((a) => <option key={a} value={a}>{ACOM_ROOM_LABEL[a]}</option>)}
              </select>
            </div>
          ))}
        </div>

        {cantidadMenores > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Edad de cada menor</p>
            <div className="flex flex-wrap gap-3">
              {edadesTxt.map((v, i) => {
                const errP = edadesParsed[i]?.error;
                const mostrarError = v.trim() !== "" && errP;
                return (
                  <div key={i}>
                    <label htmlFor={`${idBase}-edad-${i}`} className="mb-1 block text-xs text-gray-500">Edad menor {i + 1}</label>
                    <input
                      id={`${idBase}-edad-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={EDAD_MENOR_MAX}
                      value={v}
                      onChange={(e) => setEdadAt(i, e.target.value)}
                      className={`w-16 rounded-lg border px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] ${mostrarError ? "border-red-400" : "border-gray-300"}`}
                      aria-invalid={mostrarError ? true : undefined}
                    />
                    {mostrarError && <p className="mt-0.5 text-[10px] text-red-600">{errP}</p>}
                  </div>
                );
              })}
            </div>
            {!edadesValidas && edadesFaltantes > 0 && (
              <p className="mt-1 text-[11px] text-amber-600">Falta la edad de {edadesFaltantes} menor(es).</p>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={buscar} disabled={pending || !menoresListos || !adultosValido} className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Buscando…" : "Buscar hoteles"}
          </button>
          {resultados && <button type="button" onClick={() => setResultados(null)} className="text-xs text-gray-400 hover:text-gray-700">Limpiar resultados</button>}
        </div>
        {avisoHab && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{avisoHab}</p>}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>

      {resultados && resultadosFiltrados && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-500">{resultadosFiltrados.length} hotel(es) disponibles para tu búsqueda</p>
            <div className="flex flex-wrap gap-3 text-xs text-gray-600">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={soloPetFriendly} onChange={(e) => setSoloPetFriendly(e.target.checked)} />
                Pet friendly
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={soloAdultsOnly} onChange={(e) => setSoloAdultsOnly(e.target.checked)} />
                Adults Only
              </label>
            </div>
          </div>
          {resultadosFiltrados.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
              {diagnostico
                ? diagnostico
                : "No hay hoteles que cumplan esa composición/fechas/filtros. Prueba otra acomodación, fechas o quita un filtro."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resultadosFiltrados.map((r) => (
                <Resultado
                  key={`${r.paqueteId}-${r.hotelId}`}
                  r={r}
                  foto={fotosPorHotel[r.hotelId] ?? null}
                  info={infoPorHotel[r.hotelId]}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Resultado({ r, foto, info }: { r: BusquedaResultado; foto: string | null; info?: { estrellas: number | null; clasificacion: string | null; descripcion?: string | null; adultsOnly?: boolean; petFriendly?: boolean } }) {
  const { items, add, remove } = useCart();

  // Combos disponibles → selectores de categoría y alimentación (el más barato
  // viene por defecto). El precio y lo que va al carrito siguen al combo elegido.
  const categorias = useMemo(() => [...new Set(r.combos.map((c) => c.categoria))], [r.combos]);
  const [cat, setCat] = useState(r.categoria);
  const [reg, setReg] = useState(r.regimen);
  const regimenes = useMemo(
    () => [...new Set(r.combos.filter((c) => c.categoria === cat).map((c) => c.regimen))],
    [r.combos, cat]
  );
  // Si el régimen elegido no aplica a la categoría, cae al más barato de esa categoría.
  const regEff = regimenes.includes(reg) ? reg : (regimenes[0] ?? reg);
  const combo = r.combos.find((c) => c.categoria === cat && c.regimen === regEff) ?? r.combos[0];

  // La clasificación (infante/Niño 1/Niño 2) ya viene resuelta por edad real
  // desde la búsqueda (misma para todos los combos de este hotel — depende
  // del umbral del hotel, no de la categoría/régimen elegidos).
  const item: Omit<HotelCartItem, "id"> = {
    tipo: "hotel",
    modulo: "porcion_terrestre", paqueteId: r.paqueteId, hotelId: r.hotelId, bloqueoId: null,
    hotelNombre: r.hotelNombre ?? "", destino: r.destino, fotoUrl: foto,
    categoria: combo.categoria, regimen: combo.regimen, fechaIda: r.fechaIda, fechaRegreso: r.fechaRegreso, noches: r.noches,
    habitaciones: r.habitaciones, ninos: combo.menores.nino, ninos2: combo.menores.nino2, infantes: combo.menores.infantes,
    pax: combo.pax, precio: combo.total, edadesMenores: r.edadesMenores,
  };
  // El estado del botón se deriva del carrito real: si se quita del carrito,
  // vuelve a estar disponible para agregar.
  const enCarrito = items.find((i) =>
    i.tipo === "hotel" && i.hotelId === item.hotelId && i.paqueteId === item.paqueteId &&
    i.fechaIda === item.fechaIda && i.fechaRegreso === item.fechaRegreso &&
    i.categoria === item.categoria && i.regimen === item.regimen);
  const estrellas = info?.estrellas && info.estrellas > 0 ? "★".repeat(info.estrellas) : "";
  const selCls = "rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs";
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="aspect-[16/10] w-full bg-gray-100">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt={r.hotelNombre ?? ""} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-800">{r.hotelNombre}</span>
          {estrellas && <span className="text-sm text-amber-400">{estrellas}</span>}
          {info?.adultsOnly && (
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white" title="Este hotel no acepta niños ni infantes">Adults Only</span>
          )}
          {info?.petFriendly && (
            <span className="rounded-full bg-[var(--brand-success)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-success)]" title="Este hotel acepta mascotas">Pet friendly</span>
          )}
        </div>
        <div className="text-xs text-gray-500">{r.destino ?? ""} · {r.noches}N</div>
        {info?.descripcion?.trim() && (
          <p className="mt-1 line-clamp-2 text-xs text-gray-400">{info.descripcion}</p>
        )}

        {/* Selectores de categoría y alimentación */}
        <div className="mt-3 grid grid-cols-1 gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-20 shrink-0">Categoría</span>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={`${selCls} flex-1`}>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-20 shrink-0">Alimentación</span>
            <select value={regEff} onChange={(e) => setReg(e.target.value)} className={`${selCls} flex-1`}>
              {regimenes.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">total {combo.pax} pax</div>
            <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatCOP(combo.total)}</div>
          </div>
          <button type="button" onClick={() => (enCarrito ? remove(enCarrito.id) : add(item))}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: enCarrito ? "var(--brand-success)" : "var(--brand-primary)" }}>
            {enCarrito ? "✓ En el carrito · quitar" : "Agregar al carrito"}
          </button>
        </div>
      </div>
    </div>
  );
}
