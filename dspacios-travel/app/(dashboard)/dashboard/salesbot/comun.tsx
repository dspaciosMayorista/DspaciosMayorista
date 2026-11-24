import Link from "next/link";
import { AlertTriangle, Clock, Search } from "lucide-react";
import type { AgenciaResumen, PorcentajeAgencia, Respuesta, Sello } from "@/lib/salesbot/contrato";

// Piezas compartidas por las pestañas de la consulta comercial (#56).
// Componentes de servidor, sin JavaScript de cliente.

export type Params = Record<string, string | string[] | undefined>;

export type Producto = "conversacion" | "programas" | "bloqueos" | "porcion";

export const PESTANAS: { producto: Producto; etiqueta: string }[] = [
  { producto: "conversacion", etiqueta: "Conversación" },
  { producto: "programas", etiqueta: "Programas" },
  { producto: "bloqueos", etiqueta: "Bloqueos" },
  { producto: "porcion", etiqueta: "Porción terrestre" },
];

export const ACOMODACION: Record<string, string> = {
  sencilla: "Sencilla",
  doble: "Doble",
  triple: "Triple",
  cuadruple: "Cuádruple",
  multiple: "Múltiple",
  nino: "Niño",
  nino2: "Niño 2",
  infante: "Infante",
};

export const HABITACIONES: { clave: "sencilla" | "doble" | "triple" | "multiple"; etiqueta: string }[] = [
  { clave: "sencilla", etiqueta: "Sencilla" },
  { clave: "doble", etiqueta: "Doble" },
  { clave: "triple", etiqueta: "Triple" },
  { clave: "multiple", etiqueta: "Múltiple" },
];

export const hora = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });

export function uno(sp: Params, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Parámetros que envían el formulario y los enlaces de la vista Programas (que no llevan `producto`). */
const PARAMS_PROGRAMAS = ["texto", "destino", "tipoTransporte", "fechaSalida", "presupuesto", "monedaPresupuesto", "programa", "audiencia", "agencia"];

/**
 * Vista activa. Sin parámetros: la conversación. Las vistas secundarias se
 * eligen con `?producto=`; un formulario o enlace de Programas (que no envía
 * `producto`) sigue abriendo Programas, como antes de la conversación.
 */
export function productoDe(sp: Params): Producto {
  const p = uno(sp, "producto");
  if (p === "conversacion" || p === "programas" || p === "bloqueos" || p === "porcion") return p;
  return PARAMS_PROGRAMAS.some((k) => uno(sp, k) !== undefined) ? "programas" : "conversacion";
}

/** Enlace que conserva los parámetros actuales salvo los que se quitan, y fija los que se pasan. */
export function enlaceCon(sp: Params, fijar: Record<string, string>, quitar: string[] = [], ancla = ""): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && !quitar.includes(k) && !(k in fijar)) q.set(k, v);
  for (const [k, v] of Object.entries(fijar)) q.set(k, v);
  return `/dashboard/salesbot?${q.toString()}${ancla}`;
}

export function Pestanas({ activo }: { activo: Producto }) {
  return (
    <nav className="flex gap-1 border-b" aria-label="Producto">
      {PESTANAS.map((t) => (
        <Link
          key={t.producto}
          href={`/dashboard/salesbot?producto=${t.producto}`}
          aria-current={t.producto === activo ? "page" : undefined}
          className={`-mb-px rounded-t-md border px-4 py-2 text-sm font-medium ${t.producto === activo ? "border-b-white bg-white" : "border-transparent text-gray-600"}`}
          style={t.producto === activo ? { color: "var(--brand-primary)" } : undefined}
        >
          {t.etiqueta}
        </Link>
      ))}
    </nav>
  );
}

export function SelloConsulta({ sello }: { sello: Sello }) {
  return (
    <p className="flex items-center gap-1 text-xs text-gray-500">
      <Clock size={12} aria-hidden /> Consultado a las {hora.format(new Date(sello.consultado_en))} (hora Bogotá) · vale hasta las{" "}
      {hora.format(new Date(sello.valido_hasta))}
    </p>
  );
}

export function Aviso({ texto }: { texto: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {texto}
    </p>
  );
}

export function ErrorConsulta<T>({ r }: { r: Extract<Respuesta<T>, { ok: false }> }) {
  return <Aviso texto={`${r.motivo ?? "No fue posible consultar."}${r.campos?.length ? ` (${r.campos.join(", ")})` : ""}`} />;
}

export function textoPorcentaje(p: PorcentajeAgencia): string {
  switch (p.estado) {
    case "propio":
      return `Comisión de ${p.agencia.nombre}: ${(p.pct * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })}% (porcentaje propio de su ficha). La base y el monto los calcula y confirma el asesor.`;
    case "sin_pct_propio":
      return `${p.agencia.nombre} no tiene un porcentaje propio configurado. La comisión la confirma el asesor.`;
    case "pct_invalido":
      return `El porcentaje de ${p.agencia.nombre} en su ficha no es válido. La comisión la confirma el asesor.`;
    case "no_encontrada":
      return "No se encontró la agencia elegida.";
  }
}

/** Radio de audiencia (viajero final / agencia) y, en B2B, el selector de agencia del catálogo. */
export function SelectorAudiencia({ audiencia, agencias, agenciaId }: { audiencia: "b2c" | "b2b"; agencias: AgenciaResumen[] | null; agenciaId?: string }) {
  return (
    <>
      <fieldset className="text-sm">
        <legend className="mb-1 text-gray-700">Cliente</legend>
        <label className="mr-3">
          <input type="radio" name="audiencia" value="b2c" defaultChecked={audiencia === "b2c"} /> Viajero final
        </label>
        <label>
          <input type="radio" name="audiencia" value="b2b" defaultChecked={audiencia === "b2b"} /> Agencia o freelance
        </label>
      </fieldset>
      {audiencia === "b2b" && agencias && (
        <label className="text-sm">
          <span className="mb-1 block text-gray-700">Agencia</span>
          <select name="agencia" defaultValue={agenciaId ?? ""} className="w-full rounded-md border px-2 py-1.5">
            <option value="">Elige una agencia</option>
            {agencias.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
                {a.tipo ? ` (${a.tipo})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** Habitaciones por tipo y edades exactas de los menores (nunca fecha de nacimiento). */
export function CamposComposicion({ sp }: { sp: Params }) {
  return (
    <>
      {HABITACIONES.map((h) => (
        <label key={h.clave} className="text-sm">
          <span className="mb-1 block text-gray-700">Habitaciones {h.etiqueta.toLowerCase()}</span>
          <input name={`hab_${h.clave}`} inputMode="numeric" defaultValue={uno(sp, `hab_${h.clave}`) ?? ""} className="w-full rounded-md border px-2 py-1.5" />
        </label>
      ))}
      <label className="text-sm">
        <span className="mb-1 block text-gray-700">Edades de los menores</span>
        <input name="edadesMenores" defaultValue={uno(sp, "edadesMenores") ?? ""} className="w-full rounded-md border px-2 py-1.5" placeholder="Ej.: 5, 9" />
      </label>
    </>
  );
}

/** Campos ocultos para conservar parámetros entre formularios de la misma pestaña. */
export function Ocultos({ sp, claves }: { sp: Params; claves: string[] }) {
  return (
    <>
      {claves.map((k) => {
        const v = uno(sp, k);
        return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
      })}
    </>
  );
}

export function BotonConsultar({ texto = "Consultar" }: { texto?: string }) {
  return (
    <button type="submit" className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--brand-primary)" }}>
      <Search size={16} aria-hidden /> {texto}
    </button>
  );
}
