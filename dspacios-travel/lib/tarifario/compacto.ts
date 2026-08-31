export type FilaTarifarioCompactable = {
  modulo: "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
  bloqueo_label: string | null;
  bloqueo_id?: number | null;
  empaquetado_id?: number | null;
  salida_id?: number | null;
  paquete_id?: number | null;
  hotel_id?: number | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  noches: number | null;
  destino_nombre: string | null;
  paquete_nombre: string | null;
  hotel_nombre: string | null;
  servicio_id?: number | null;
  servicio_nombre?: string | null;
  tipo_tarifa?: string | null;
  pax_desde?: number | null;
  pax_hasta?: number | null;
  categoria: string | null;
  regimen: string | null;
  acomodacion: string | null;
  precio_pvp: number;
  descripcion?: string | null;
  recargo_individual?: number | null;
  moneda?: string | null;
};

type Texto = number;
type Numero = number | null;
type FilaCompacta = [
  number, Texto, Numero, Numero, Numero, Numero, Numero, Texto, Texto, Numero,
  Texto, Texto, Texto, Numero, Texto, Texto, Numero, Numero, Texto, Texto,
  Texto, number, Texto, Numero, Texto,
];

export type TarifarioCompacto = { version: 1; textos: string[]; filas: FilaCompacta[] };
export type TarifarioCompactoSerializado = string & { readonly __tarifarioCompacto: unique symbol };

const MODULOS = ["bloqueo", "porcion_terrestre", "servicios", "dinamico"] as const;
const numero = (valor: number | null | undefined): Numero => valor == null ? null : valor;

export function compactarFilasTarifario<T extends FilaTarifarioCompactable>(
  filas: readonly T[]
): TarifarioCompacto {
  const textos: string[] = [];
  const indices = new Map<string, number>();
  const texto = (valor: string | null | undefined): Texto => {
    if (valor == null) return -1;
    const existente = indices.get(valor);
    if (existente != null) return existente;
    const indice = textos.length;
    textos.push(valor);
    indices.set(valor, indice);
    return indice;
  };

  return {
    version: 1,
    textos,
    filas: filas.map((f) => [
      MODULOS.indexOf(f.modulo), texto(f.bloqueo_label), numero(f.bloqueo_id),
      numero(f.empaquetado_id), numero(f.salida_id), numero(f.paquete_id), numero(f.hotel_id),
      texto(f.fecha_ida), texto(f.fecha_regreso), numero(f.noches), texto(f.destino_nombre),
      texto(f.paquete_nombre), texto(f.hotel_nombre), numero(f.servicio_id), texto(f.servicio_nombre),
      texto(f.tipo_tarifa), numero(f.pax_desde), numero(f.pax_hasta), texto(f.categoria), texto(f.regimen),
      texto(f.acomodacion), f.precio_pvp, texto(f.descripcion), numero(f.recargo_individual), texto(f.moneda),
    ]),
  };
}

export function descompactarFilasTarifario<T extends FilaTarifarioCompactable>(
  paquete: TarifarioCompacto
): T[] {
  if (paquete.version !== 1) throw new Error("Version de tarifario compacto no soportada");
  const texto = (indice: Texto): string | null => indice < 0 ? null : (paquete.textos[indice] ?? null);
  return paquete.filas.map((f) => ({
    modulo: MODULOS[f[0]] ?? "bloqueo",
    bloqueo_label: texto(f[1]), bloqueo_id: f[2], empaquetado_id: f[3], salida_id: f[4],
    paquete_id: f[5], hotel_id: f[6], fecha_ida: texto(f[7]), fecha_regreso: texto(f[8]),
    noches: f[9], destino_nombre: texto(f[10]), paquete_nombre: texto(f[11]), hotel_nombre: texto(f[12]),
    servicio_id: f[13], servicio_nombre: texto(f[14]), tipo_tarifa: texto(f[15]), pax_desde: f[16],
    pax_hasta: f[17], categoria: texto(f[18]), regimen: texto(f[19]), acomodacion: texto(f[20]),
    precio_pvp: f[21], descripcion: texto(f[22]), recargo_individual: f[23], moneda: texto(f[24]),
  } as T));
}

/**
 * Flight/RSC procesa cada elemento de arrays y objetos recibidos como props.
 * El catalogo tiene cientos de miles de valores escalares, aunque su JSON sea
 * relativamente pequeno. Entregarlo como un solo string aplaza ese trabajo a
 * un JSON.parse lineal y evita que el decodificador de React reconstruya cada
 * celda del tarifario por separado durante la navegacion.
 */
export function serializarTarifarioCompacto(
  paquete: TarifarioCompacto
): TarifarioCompactoSerializado {
  return JSON.stringify(paquete) as TarifarioCompactoSerializado;
}

export function deserializarTarifarioCompacto(
  valor: TarifarioCompactoSerializado
): TarifarioCompacto {
  const paquete: unknown = JSON.parse(valor);
  if (
    paquete == null || typeof paquete !== "object" ||
    (paquete as { version?: unknown }).version !== 1 ||
    !Array.isArray((paquete as { textos?: unknown }).textos) ||
    !Array.isArray((paquete as { filas?: unknown }).filas)
  ) {
    throw new Error("Tarifario compacto serializado invalido");
  }
  return paquete as TarifarioCompacto;
}
