import "server-only";
import { gzipSync } from "node:zlib";
import {
  serializarTarifarioCompacto,
  type TarifarioCompacto,
  type TarifarioCompactoComprimido,
} from "./compacto";

export function comprimirTarifarioCompacto(
  paquete: TarifarioCompacto
): TarifarioCompactoComprimido {
  const json = serializarTarifarioCompacto(paquete);
  return {
    version: 1,
    codec: "gzip-base64",
    datos: gzipSync(json, { level: 6 }).toString("base64"),
  };
}
