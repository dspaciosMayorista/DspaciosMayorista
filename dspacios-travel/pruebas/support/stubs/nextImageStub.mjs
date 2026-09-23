// Stub de "next/image" para pruebas de interacción React (ver
// pruebas/support/reactLoader.mjs) — `next/image` no se puede resolver fuera
// del bundler de Next (su package.json usa condiciones de "exports" que solo
// Webpack/Turbopack entienden). Los fixtures de la prueba pasan `foto: null`
// siempre, así que este componente NUNCA se instancia de verdad — solo debe
// existir para que el `import Image from "next/image"` del componente real
// no rompa la resolución de módulos.
export default function ImageStub() {
  return null;
}
