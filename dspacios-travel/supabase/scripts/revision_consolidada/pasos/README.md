# Pasos de la guía de revisión consolidada

Cada módulo `NN_entrega.mjs` exporta `pasos`: un arreglo de objetos que son, a la vez, **la instrucción para el dueño** (campos de texto, en español) y **la comprobación automática del ensayo** (`verificar`).

```js
export const pasos = [{
  id: "B3-01",                 // único; se usa en --solo
  entrega: "bloque3",          // agrupa en la guía
  rol: "superadmin",           // alias de cuenta (<alias>@consolidada.test); null = visitante sin sesión
  titulo: "Presencia reciente del equipo",
  ruta: "/dashboard",          // enlace exacto que abre el dueño (relativo a http://localhost:3090)
  accion: "Texto para el dueño: qué hacer, en orden.",
  esperado: "Texto para el dueño: qué debe ver.",
  solo_lectura: true,          // opcional: el ensayo repite la verificación a 1280, 768 y 390 px (no debe cambiar datos)
  async verificar(c) { ... },  // c = { page (Playwright), sql(q), ir(ruta), texto(), espera(ms), foto(nombre), check(nombre, ok, detalle), APP, ancho }
}];
```

Reglas: los pasos de un mismo módulo corren en orden y pueden depender de los anteriores; `verificar` ejecuta lo que el dueño hará (clics, formularios) y comprueba lo esperado con `c.check`. Usa textos de interfaz exactos (en español). `c.sql` lee/escribe la base de la COPIA de ensayo.
