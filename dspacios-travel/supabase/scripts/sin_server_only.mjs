// Sustituye `server-only` (paquete que solo existe dentro de Next) por un módulo vacío para correr fuera de Next, como hacen las pruebas unitarias.
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, n) { return s === "server-only" ? { url: "data:text/javascript,export {}", shortCircuit: true } : n(s, c); }`),
);
