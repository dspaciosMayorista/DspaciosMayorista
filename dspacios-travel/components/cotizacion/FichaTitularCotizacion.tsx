import { UserRound, Users } from "lucide-react";
import type { FichaTitular, RegistroPersonas } from "@/lib/cotizacion/fichaTitular";

// B2-11 / B2-12a — Titular y viajeros de la cotización, de solo lectura, en la propia pantalla de trabajo (sin abrir «Ver / Imprimir»). Sin hooks ni acciones.
// Distinto del TitularEditor (que edita): aquí solo se lee lo guardado; lo ausente dice «No registrado», nunca se supone.
const NR = "No registrado";

const NOTA_REGISTRO: Record<RegistroPersonas, string | null> = {
  registrado: "Titular registrado en Personas de cotización.",
  pendiente: "Pendiente de registrar en Personas de cotización: usa «Reintentar».",
  sin_titular: "Sin titular identificado: no se registra ninguna persona.",
  sin_puesto: "No hay un titular activo en Personas de cotización.",
  desconocido: null,
};

function Campo({ etiqueta, valor, testid }: { etiqueta: string; valor: string | null; testid: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{etiqueta}</dt>
      <dd className={`break-words text-sm ${valor ? "text-gray-800" : "text-gray-400"}`} data-testid={testid}>{valor ?? NR}</dd>
    </div>
  );
}

export function FichaTitularCotizacion({ ficha, estado }: { ficha: FichaTitular; estado?: string | null }) {
  const nota = NOTA_REGISTRO[ficha.registro];
  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4" data-testid="ficha-titular-cotizacion" aria-label="Titular de la cotización">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <UserRound className="h-4 w-4" aria-hidden style={{ color: "var(--brand-primary)" }} />
        Titular de la cotización
        {estado && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">{estado}</span>}
      </h2>
      <p className="mt-1 text-xs text-gray-500" data-testid="ficha-origen">Origen: {ficha.origen}</p>
      {ficha.aliado && (
        <p className="mt-0.5 text-xs text-gray-600" data-testid="ficha-aliado">
          Aliado: {ficha.aliado.nombre ?? NR} ({ficha.aliado.tipo === "agencia" ? "agencia" : "freelance"}) · El titular de abajo es el viajero, no el aliado.
        </p>
      )}
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Campo etiqueta="Nombre" valor={ficha.nombre} testid="ficha-nombre" />
        <Campo etiqueta="Documento" valor={ficha.documento} testid="ficha-documento" />
        <Campo etiqueta="Fecha de nacimiento" valor={ficha.nacimiento} testid="ficha-nacimiento" />
        <Campo etiqueta="Teléfono" valor={ficha.telefono} testid="ficha-telefono" />
        <Campo etiqueta="Correo" valor={ficha.email} testid="ficha-email" />
      </dl>
      {ficha.composicion.length > 0 && (
        <p className="mt-3 text-sm text-gray-700" data-testid="ficha-composicion">
          {ficha.composicion.map((c, i) => (
            <span key={c.etiqueta}>{i > 0 && " · "}<span className="text-gray-500">{c.etiqueta}:</span> <span className="font-medium tabular-nums">{c.valor}</span></span>
          ))}
        </p>
      )}
      <div className="mt-3" data-testid="ficha-pasajeros">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <Users className="h-3.5 w-3.5" aria-hidden /> Viajeros con datos guardados ({ficha.pasajeros.length})
        </h3>
        {ficha.pasajeros.length === 0 ? (
          <p className="mt-1 text-sm text-gray-400">Aún no hay viajeros con nombre o documento guardados.</p>
        ) : (
          <ul className="mt-1 divide-y divide-gray-100 text-sm">
            {ficha.pasajeros.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                <span className="font-medium text-gray-800">{p.nombre}</span>
                <span className="text-gray-600">{p.documento ?? "Documento: " + NR}</span>
                <span className="text-gray-500">{p.nacimiento ? `Nac. ${p.nacimiento}` : "Nacimiento: " + NR}</span>
                {p.fuente === "aliado" && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">Indicado por el aliado</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {nota && <p className="mt-3 text-xs text-gray-500" data-testid="ficha-registro">{nota}</p>}
      <details className="mt-2 text-xs text-gray-500">
        <summary className="cursor-pointer text-gray-600">¿Cuándo se guarda este titular en el CRM?</summary>
        <p className="mt-1">
          El titular y los viajeros identificados se registran en Personas de cotización al crear o guardar la cotización: no al verla, aceptarla, descartarla ni convertirla.
          El contacto de campañas (cliente final) solo se intenta agregar cuando la cotización nace del carrito del tarifario, de una solicitud de hotel o de un paquete dinámico público.
          Convertir en contrato no crea personas ni contactos nuevos.
        </p>
      </details>
    </section>
  );
}
