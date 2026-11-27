// Bloque 1 — vuelos y vouchers (#17 documentos con vuelos · #18 voucher aéreo · #26 historial de movimientos del record · #29 destinos aéreos alternativos · #37 voucher por servicio contratado · #40 editor de vuelos del contrato).
// Semillas: contratos DTM-9701…9705 y DTM-9801…9807, records AAA111/BBB222/CCC333 (ids 9501/9502/9503), destinos 9405 (solo alternativo) y 9406 (sin uso), cotización 11111111-1111-4111-8111-111111111111.
// Los pasos con efectos corren en orden: B1-05 genera vouchers que usan B1-06…B1-15.
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const SQ = (s) => String(s).replace(/'/g, "''");

/** Vouchers aéreos guardados de un contrato: [{clave, token}] por orden de creación. */
const vouchersVuelo = (c, n) =>
  c.sql(`select coalesce(servicio_clave,'') || '|' || share_token from public.vouchers where numero_contrato = '${SQ(n)}' and tipo = 'vuelo' order by id`)
    .split("\n").filter(Boolean).map((l) => { const [clave, token] = l.split("|"); return { clave, token }; });

/** Abre el contrato y pulsa «Voucher de vuelo»; devuelve el mensaje que muestra la página. */
async function generarVuelo(c, n) {
  await c.ir(`/dashboard/contratos/${n}`);
  const boton = c.page.getByTestId("generar-voucher-vuelo");
  await boton.waitFor({ timeout: 20000 });
  if (await boton.isDisabled()) return "BOTON DESHABILITADO";
  await boton.click();
  const msg = c.page.locator("p.mt-2.text-sm.text-green-600, p.mt-2.text-sm.text-red-600").first();
  await msg.waitFor({ timeout: 30000 });
  const t = norm(await msg.innerText());
  await c.espera(2500);
  return t;
}

/** Texto del voucher público de un token (con la sesión del paso). */
async function textoVoucher(c, token) { await c.ir(`/voucher/${token}`); return c.texto(); }

/** Tarjetas de tramo del editor de vuelos del contrato. */
const tarjetasTramo = (c) => c.page.locator("div.grid.rounded-lg.bg-gray-50");
const campoTramo = (tarjeta, etiqueta) => tarjeta.locator(`xpath=.//label[normalize-space(.)="${etiqueta}"]/following-sibling::*[1]`);

/** Edita la hora de salida de un tramo del editor (0 = primero) y guarda. */
async function cambiarHoraTramo(c, numero, indice, hora) {
  await c.ir(`/dashboard/vuelos/contrato/${numero}`);
  const t = tarjetasTramo(c).nth(indice);
  await t.waitFor({ timeout: 20000 });
  await campoTramo(t, "Hora salida").fill(hora);
  await c.page.getByRole("button", { name: "Guardar vuelo" }).click();
  await c.page.getByText("Vuelo guardado.").waitFor({ timeout: 30000 });
  await c.espera(1500);
}

async function paginasPdf(page) {
  try { const buf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }); return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length; } catch { return -1; }
}

/** Historial del record: abre la pestaña «Cambios» y devuelve la sección y sus tarjetas. */
async function abrirHistorial(c, idRecord) {
  await c.ir(`/dashboard/vuelos/${idRecord}`);
  await c.page.locator("button", { hasText: /^Cambios/ }).first().click();
  await c.espera(700);
  const seccion = c.page.locator("section").filter({ has: c.page.locator('p:text-is("Movimientos históricos")') }).first();
  // Rev2 B1-01: el historial nace COMPACTO (5 movimientos a la vista, el resto tras «Ver N movimientos anteriores», cada uno cerrado). Aquí se mide eso y luego se abre todo para leer cada tarjeta.
  const items = seccion.locator('li[data-testid="movimiento-historial"]');
  const visiblesIniciales = await items.evaluateAll((lis) => lis.filter((li) => !li.closest('[data-testid="movimientos-anteriores"]:not([open])')).length);
  const pliegue = seccion.locator('[data-testid="movimientos-anteriores"] > summary');
  const textoPliegue = (await pliegue.count()) ? norm(await pliegue.innerText()) : "";
  if (await pliegue.count()) await pliegue.click();
  const cabeceras = seccion.locator('li[data-testid="movimiento-historial"] > details > summary');
  for (let i = 0; i < (await cabeceras.count()); i++) await cabeceras.nth(i).click();
  await c.espera(300);
  const n = await items.count();
  const tarjetas = [];
  for (let i = 0; i < n; i++) tarjetas.push(norm(await items.nth(i).innerText()));
  return { seccion, items, tarjetas, visiblesIniciales, textoPliegue };
}

export const pasos = [
  {
    id: "B1-01", entrega: "bloque1", rol: "controlvuelo", solo_lectura: true,
    titulo: "Historial de movimientos de un record de vuelo",
    ruta: "/dashboard/vuelos/9501",
    accion: "1) Abre el record AAA111 (enlace de la ruta). 2) Pulsa la pestaña «Cambios» y baja hasta «Movimientos históricos»: verás 5 movimientos en filas cerradas y «Ver 3 movimientos anteriores». 3) Pulsa «Ver 3 movimientos anteriores», luego pulsa una fila para abrirla y abre uno o más «Detalle por silla». 4) Abre luego el record BBB222 (/dashboard/vuelos/9502), pestaña «Cambios». 5) Repite en el celular y a ancho intermedio.",
    esperado: "AAA111 muestra 8 movimientos (5 a la vista y 3 tras «Ver 3 movimientos anteriores»; cada fila cerrada dice qué pasó y cuándo, y se abre para ver el detalle), del más reciente al más antiguo, con fecha y hora de Bogotá «dd/mm/aaaa hh:mm (hora de Bogotá)»: el retiro del 23/11/2026 23:30 se rotula «Retiro de cupo» con record destino «No aplica» y su motivo (que nombra BBB222) aparece solo como «Motivo (texto libre)», sin lenguaje de traslado. El traslado del 05/10/2026 10:00 dice «Salieron 3 cupo(s) libre(s) hacia BBB222», cupos origen 12 → 9, sillas de origen #10, #11, #12. El pasajero movido del 02/11/2026 15:15 entra desde BBB222 con el contrato CM-0451. Los dos movimientos anteriores (01 y 02/01/2026) se rotulan «Movimiento anterior (tipo no guardado)» y «Cambio entre records (registro anterior)» y dicen «No guardado» en lo que falta, sin deducir nada del motivo. Los límites del día de Bogotá se ven bien (22/11 23:59, 23/11 00:00, 31/12/2025 23:59). «Detalle por silla» lista «Silla #10 → #7» y siguientes. Desde BBB222 el mismo traslado se lee «Entraron 3 cupo(s) libre(s) desde AAA111». En celular y ancho intermedio nada se sale de la tarjeta ni de la pantalla.",
    async verificar(c) {
      const A = await abrirHistorial(c, 9501);
      c.check("AAA111 muestra 8 movimientos (10 filas guardadas, el traslado agrupa 3)", A.tarjetas.length === 8, String(A.tarjetas.length));
      c.check("Rev2 B1-01 · historial compacto: 5 movimientos a la vista y «Ver 3 movimientos anteriores» (nada se pierde: 8 en total)", A.visiblesIniciales === 5 && /Ver 3 movimientos anteriores/.test(A.textoPliegue), `${A.visiblesIniciales} · ${A.textoPliegue}`);
      const t = A.tarjetas;
      const retiro = t.find((x) => /REFERENCIA-X{20}/.test(x)) ?? "";
      c.check("retiro: «Retiro de cupo», destino «No aplica», sin lenguaje de traslado", /Retiro de cupo/i.test(retiro) && /Record destino No aplica/i.test(retiro) && !/Traslado|Entraron|Salieron/i.test(retiro.replace(/Se pasa al record BBB222[^”]*/, "")), retiro.slice(0, 160));
      c.check("retiro: motivo rotulado «texto libre», 23/11/2026 23:30 (hora de Bogotá) y actor completo", /Motivo \(texto libre\): “Se pasa al record BBB222/.test(retiro) && /23\/11\/2026 23:30 \(hora de Bogotá\)/.test(retiro) && /Registrado por Javier Alberto de Jesús Hernández-Quintero/i.test(retiro), retiro.slice(0, 160));
      const traslado = t.find((x) => /^Traslado de cupos libres/.test(x)) ?? "";
      c.check("traslado visto desde AAA111: salieron 3 cupos hacia BBB222, 05/10/2026 10:00, cupos 12 → 9, sillas #10, #11, #12",
        /Salieron 3 cupo\(s\) libre\(s\) hacia BBB222/.test(traslado) && /05\/10\/2026 10:00 \(hora de Bogotá\)/.test(traslado) && /Cupos origen \(antes → después\) 12 → 9/i.test(traslado) && /Sillas de origen #10, #11, #12/i.test(traslado) && /Record origen AAA111/i.test(traslado) && /Record destino BBB222/i.test(traslado), traslado.slice(0, 200));
      const mover = t.find((x) => /^Pasajero movido con su cupo/.test(x)) ?? "";
      c.check("pasajero movido con su cupo: entra desde BBB222, 02/11/2026 15:15, contrato CM-0451", /Entró pasajero con su cupo desde BBB222/.test(mover) && /02\/11\/2026 15:15/.test(mover) && /Contrato CM-0451/i.test(mover), mover.slice(0, 200));
      const legado = t.find((x) => /^Movimiento anterior \(tipo no guardado\)/.test(x)) ?? "";
      c.check("historial anterior incompleto: «No guardado» en actor/destino/cupos y nada inferido del motivo", /no se guardó su tipo ni su destino/i.test(legado) && /Registrado por No guardado/i.test(legado) && /Record destino No guardado/i.test(legado) && /Cupos origen \(antes → después\) No guardado/i.test(legado) && !/hacia CCC333/.test(legado) && /02\/01\/2026 07:00/.test(legado), legado.slice(0, 200));
      const cambio = t.find((x) => /^Cambio entre records \(registro anterior\)/.test(x)) ?? "";
      c.check("anterior con origen y destino guardados: «Cambio entre records (registro anterior)», 03/01/2026 07:00", /Entró desde CCC333/.test(cambio) && /03\/01\/2026 07:00/.test(cambio), cambio.slice(0, 200));
      const unido = t.join(" || ");
      const orden = ["23/11/2026 23:30", "23/11/2026 00:00", "22/11/2026 23:59", "02/11/2026 15:15", "05/10/2026 10:00", "03/01/2026 07:00", "02/01/2026 07:00", "31/12/2025 23:59"].map((x) => unido.indexOf(x));
      c.check("fechas en hora de Bogotá, con los límites del día, de la más reciente a la más antigua", orden.every((x, i) => x >= 0 && (i === 0 || x > orden[i - 1])), orden.join(","));
      // Detalle por silla: se abre y lista cada silla.
      const resumenes = A.seccion.locator("summary").filter({ hasText: /^Detalle por silla/ });
      for (let i = 0; i < (await resumenes.count()); i++) await resumenes.nth(i).click();
      await c.espera(400);
      const detalle = norm(await A.seccion.innerText());
      c.check("«Detalle por silla» abierto lista cada silla (#10 → #7, #11 → #8, #12 → #9 y #3 → #13 con contrato)", /Silla #10 → #7/.test(detalle) && /Silla #11 → #8/.test(detalle) && /Silla #12 → #9/.test(detalle) && /Silla #3 → #13 · contrato CM-0451/.test(detalle), "");
      // Legibilidad: ninguna tarjeta ni su contenido se sale del ancho disponible.
      const fuera = await A.items.evaluateAll((lis, ancho) => lis.filter((li) => { const r = li.getBoundingClientRect(); return r.left < -1 || r.right > ancho + 1 || [...li.querySelectorAll("*")].some((e) => e.getBoundingClientRect().right > r.right + 1); }).length, c.ancho);
      c.check("ninguna tarjeta ni su contenido se sale de la pantalla", fuera === 0, String(fuera));
      const B = await abrirHistorial(c, 9502);
      const entra = B.tarjetas.find((x) => /^Traslado de cupos libres/.test(x)) ?? "";
      c.check("desde BBB222 el traslado se lee como entrada (6 → 9, sillas #7, #8, #9)", /Entraron 3 cupo\(s\) libre\(s\) desde AAA111/.test(entra) && /Cupos destino \(antes → después\) 6 → 9/i.test(entra) && /Sillas de destino #7, #8, #9/i.test(entra), entra.slice(0, 200));
      c.check("desde BBB222 el pasajero movido con cupo se lee como salida hacia AAA111", /Salió pasajero con su cupo hacia AAA111/.test(B.tarjetas.find((x) => /^Pasajero movido con su cupo/.test(x)) ?? ""), "");
    },
  },
  {
    id: "B1-02", entrega: "bloque1", rol: "venta", solo_lectura: true,
    titulo: "El asesor de ventas no entra al módulo de vuelos ni al editor",
    ruta: "/dashboard/contratos/DTM-9705",
    accion: "Con la cuenta de venta (dueña de DTM-9705): 1) Abre el contrato DTM-9705 y busca un enlace para registrar o editar el vuelo. 2) Intenta abrir /dashboard/vuelos/contrato/DTM-9705. 3) Intenta abrir el record /dashboard/vuelos/9501.",
    esperado: "El contrato DTM-9705 se ve, pero NO ofrece el enlace «Registrar o editar vuelo y record →». El editor de vuelos responde «Tu rol no tiene acceso al editor operativo de vuelos del contrato.» (o te devuelve fuera del módulo) y el record 9501 no muestra «Movimientos históricos» ni ningún movimiento.",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-9705"); let t = await c.texto();
      c.check("el contrato propio abre", /DTM-9705/.test(t), t.slice(0, 120));
      c.check("sin enlace al editor de vuelos", (await c.page.getByTestId("enlace-editor-vuelos").count()) === 0, "");
      await c.ir("/dashboard/vuelos/contrato/DTM-9705"); t = await c.texto();
      c.check("el editor de vuelos no se ofrece al asesor", !/Guardar vuelo/.test(t) && (/Tu rol no tiene acceso al editor operativo/.test(t) || !/\/dashboard\/vuelos\/contrato\//.test(c.page.url())), c.page.url());
      await c.ir("/dashboard/vuelos/9501"); t = await c.texto();
      c.check("el record no muestra el historial", !/Movimientos históricos|Traslado de cupos libres|Retiro de cupo/.test(t), t.slice(0, 120));
    },
  },
  {
    id: "B1-03", entrega: "bloque1", rol: "administracion", solo_lectura: true,
    titulo: "Listado de vuelos empaquetados y enlace al editor de vuelos del contrato",
    ruta: "/dashboard/vuelos?vista=empaquetados",
    accion: "1) Abre Vuelos, pestaña «EMPAQUETADOS». 2) Busca los contratos DTM-9701, DTM-9702, DTM-9703 y DTM-9705 (origen «Contrato») y DTM-9704. 3) Abre el contrato DTM-9704 y busca el enlace del vuelo. 4) Abre el contrato DTM-9701, pulsa «Registrar o editar vuelo y record →».",
    esperado: "El listado incluye los contratos con vuelo (DTM-9701, DTM-9702, DTM-9703, DTM-9705) con su lápiz «Editar vuelo»; DTM-9704, que es solo porción terrestre, NO aparece. En la ficha de DTM-9704 no hay enlace al editor. En la ficha de DTM-9701 el enlace «Registrar o editar vuelo y record →» abre /dashboard/vuelos/contrato/DTM-9701 con el título «DTM-9701», «Vuelo del contrato» y las tarjetas de tramo.",
    async verificar(c) {
      await c.ir("/dashboard/vuelos?vista=empaquetados"); let t = await c.texto();
      for (const n of ["DTM-9701", "DTM-9702", "DTM-9703", "DTM-9705"]) c.check(`el listado incluye ${n}`, t.includes(n), "");
      c.check("el listado NO incluye el contrato solo terrestre DTM-9704", !t.includes("DTM-9704"), "");
      c.check("hay lápiz «Editar vuelo» hacia el editor de DTM-9701", (await c.page.locator('a[href="/dashboard/vuelos/contrato/DTM-9701"]').count()) > 0, "");
      c.check("no hay editor de vuelos para DTM-9704", (await c.page.locator('a[href="/dashboard/vuelos/contrato/DTM-9704"]').count()) === 0, "");
      await c.ir("/dashboard/contratos/DTM-9704");
      c.check("la ficha solo terrestre no ofrece el enlace al editor", (await c.page.getByTestId("enlace-editor-vuelos").count()) === 0, "");
      await c.ir("/dashboard/contratos/DTM-9701");
      const enlace = c.page.getByTestId("enlace-editor-vuelos");
      c.check("DTM-9701 ofrece «Registrar o editar vuelo y record →»", (await enlace.count()) === 1 && /Registrar o editar vuelo y record/.test(await enlace.innerText()), "");
      c.check("el enlace apunta al editor del propio contrato", (await enlace.getAttribute("href")) === "/dashboard/vuelos/contrato/DTM-9701", String(await enlace.getAttribute("href")));
      await enlace.click();
      await c.page.waitForURL(/\/dashboard\/vuelos\/contrato\/DTM-9701/, { timeout: 30000 }).catch(() => {});
      await c.espera(1500);
      t = await c.texto();
      c.check("el editor abre con el título del contrato y sus tarjetas de tramo", /DTM-9701/.test(t) && /Vuelo del contrato/.test(t) && (await tarjetasTramo(c).count()) >= 2, c.page.url());
    },
  },
  {
    id: "B1-04", entrega: "bloque1", rol: "superadmin", solo_lectura: true,
    titulo: "Destinos: uno usado solo como alternativo se fusiona, uno sin uso se borra directo",
    ruta: "/dashboard/producto/destinos",
    accion: "1) Busca «B1 ALTERNATIVO» y pulsa la X de su tarjeta. 2) Lee el aviso del cuadro «Eliminar destino». 3) Sin elegir destino, pulsa «Mover y eliminar». 4) Pulsa «Cancelar». 5) Busca «B1 SIN USO», pulsa su X, lee el cuadro y pulsa «Cancelar» (no lo elimines).",
    esperado: "B1 ALTERNATIVO lista «1 destino aéreo alternativo de un paquete» y exige mover su contenido: ofrece un selector «Busca el destino de llegada…» y el botón «Mover y eliminar»; sin destino elegido responde «Tiene contenido asociado: elige a qué destino moverlo.» y no borra nada. B1 SIN USO dice «No tiene contenido asociado; se eliminará directamente.» y ofrece el botón «Eliminar». Al cancelar ambos destinos siguen existiendo.",
    async verificar(c) {
      await c.ir("/dashboard/producto/destinos");
      const buscar = c.page.getByPlaceholder("Buscar por nombre o país…");
      const abrir = async (id, nombre) => {
        await buscar.fill(nombre); await c.espera(500);
        await c.page.locator(`[data-destino-tarjeta="${id}"]`).getByRole("button", { name: "Eliminar destino" }).click();
        await c.page.locator('[data-uso-destino="listo"]').waitFor({ state: "attached", timeout: 30000 });
        return c.page.locator('[data-uso-destino="listo"]');
      };
      const uso = await abrir(9405, "B1 ALTERNATIVO");
      const modal = c.page.locator("div.fixed.inset-0.z-50.flex");
      let t = norm(await modal.innerText());
      c.check("9405: el cuadro pide fusionar (modo «fusion»)", (await uso.getAttribute("data-modo-eliminacion")) === "fusion", String(await uso.getAttribute("data-modo-eliminacion")));
      c.check("9405: informa «1 destino aéreo alternativo de un paquete»", /1 destino aéreo alternativo de un paquete/.test(t), t.slice(0, 300));
      c.check("9405: ofrece mover a otro destino y NO un borrado directo", /Busca el destino de llegada…|Tiene contenido asociado: no se puede eliminar sin moverlo/.test(t) && (await modal.getByRole("button", { name: "Mover y eliminar" }).count()) === 1 && (await modal.getByRole("button", { name: "Eliminar", exact: true }).count()) === 0, t.slice(0, 300));
      await modal.getByRole("button", { name: "Mover y eliminar" }).click(); await c.espera(500);
      t = norm(await modal.innerText());
      c.check("9405: sin destino elegido se rechaza con el aviso", /Tiene contenido asociado: elige a qué destino moverlo\./.test(t), t.slice(-200));
      await modal.getByRole("button", { name: "Cancelar" }).click(); await c.espera(400);
      const uso2 = await abrir(9406, "B1 SIN USO");
      t = norm(await modal.innerText());
      c.check("9406: borrado directo, «No tiene contenido asociado; se eliminará directamente.»", (await uso2.getAttribute("data-modo-eliminacion")) === "borrado_directo" && /No tiene contenido asociado; se eliminará directamente\./.test(t), t.slice(0, 300));
      c.check("9406: ofrece el botón «Eliminar» sin selector de destino", (await modal.getByRole("button", { name: "Eliminar", exact: true }).count()) === 1 && !/Busca el destino de llegada/.test(t), "");
      await modal.getByRole("button", { name: "Cancelar" }).click(); await c.espera(400);
      c.check("ambos destinos siguen existiendo", c.sql("select count(*) from public.destinos where id in (9405, 9406)") === "2", "");
    },
  },
  {
    id: "B1-05", entrega: "bloque1", rol: "administracion",
    titulo: "Voucher aéreo por servicio contratado: PNR distintos juntos, servicios separados",
    ruta: "/dashboard/contratos/DTM-9803",
    accion: "1) En el contrato DTM-9803 (3 pasajeros, dos servicios aéreos) pulsa «Voucher de vuelo». 2) Abre «Ver / imprimir →» de cada tarjeta. 3) Repite en DTM-9805 (dos servicios que comparten el mismo PNR SAME00) y en DTM-9703 (cuatro tramos, nombres muy largos).",
    esperado: "DTM-9803 muestra dos tarjetas «Vuelo», cada una con su propia ruta y enlace distinto (nunca uno por pasajero). El servicio 1 trae sus dos tramos (AV301 y AV302) con sus PNR distintos, AAA111 y ZZZ999, juntos en el mismo documento; el servicio 2 trae LA401, LA402 y su PNR BBB222, sin nada del servicio 1. Los tres pasajeros (Carla, Juan y Eva Mora) figuran una sola vez y cada voucher lo aclara dos veces: el aviso «Esta reserva tiene 2 servicios aéreos. El sistema no registra qué pasajero viaja en cada vuelo…» y la nota «no hay registrada una asignación de pasajero a tramo». DTM-9805 comparte el PNR pero sigue en DOS vouchers (AV701 en uno, AV702 en el otro). DTM-9703 genera un solo voucher con sus cuatro tramos.",
    async verificar(c) {
      const m1 = await generarVuelo(c, "DTM-9803");
      c.check("DTM-9803: el botón creó 2 vouchers", /2 nuevo\(s\)/.test(m1), m1);
      const v3 = vouchersVuelo(c, "DTM-9803");
      c.check("DTM-9803: dos enlaces distintos", v3.length === 2 && v3[0].token !== v3[1].token, JSON.stringify(v3));
      const rutas = await c.page.getByTestId("voucher-vuelo-ruta").allInnerTexts();
      c.check("la ficha lista una tarjeta por servicio con su propia ruta", rutas.length === 2 && rutas[0] !== rutas[1], JSON.stringify(rutas));
      for (const [i, v] of v3.entries()) {
        const t = await textoVoucher(c, v.token);
        const propio = i === 0 ? ["AAA111", "ZZZ999", "AV301", "AV302"] : ["BBB222", "LA401", "LA402"], ajeno = i === 0 ? ["BBB222", "LA401", "LA402"] : ["AAA111", "ZZZ999", "AV301", "AV302"];
        c.check(`servicio ${i + 1} de DTM-9803: solo sus tramos y PNR (${propio.join(", ")})`, propio.every((x) => t.includes(x)) && ajeno.every((x) => !t.includes(x)), t.slice(0, 200));
        c.check(`servicio ${i + 1}: los 3 pasajeros una vez, la nota de asignación y el aviso de 2 servicios`, /Carla Mora/.test(t) && /Juan Mora/.test(t) && /Eva Mora/.test(t) && /no hay registrada una asignación de pasajero a tramo/.test(t) && /Esta reserva tiene 2 servicios aéreos\. El sistema no registra qué pasajero viaja en cada vuelo/.test(t), t.slice(-400));
      }
      const m5 = await generarVuelo(c, "DTM-9805");
      const v5 = vouchersVuelo(c, "DTM-9805");
      c.check("DTM-9805: mismo PNR, pero DOS vouchers con enlaces distintos", /2 nuevo\(s\)/.test(m5) && v5.length === 2 && v5[0].token !== v5[1].token, m5);
      const t5 = [await textoVoucher(c, v5[0].token), await textoVoucher(c, v5[1].token)];
      c.check("cada voucher de DTM-9805 trae solo su tramo (AV701 / AV702) y el PNR compartido SAME00", t5.every((t) => t.includes("SAME00")) && ((t5[0].includes("AV701") && !t5[0].includes("AV702") && t5[1].includes("AV702") && !t5[1].includes("AV701")) || (t5[0].includes("AV702") && !t5[0].includes("AV701") && t5[1].includes("AV701") && !t5[1].includes("AV702"))), "");
      const m7 = await generarVuelo(c, "DTM-9703");
      const v7 = vouchersVuelo(c, "DTM-9703");
      c.check("DTM-9703: un voucher aéreo (4 tramos, sin pedir asociación)", /1 nuevo\(s\)/.test(m7) && v7.length === 1, m7);
      const t7 = await textoVoucher(c, v7[0].token);
      c.check("el voucher de DTM-9703 trae sus 4 tramos", ["XX900", "XX901", "XX902", "XX903"].every((x) => t7.includes(x)), "");
    },
  },
  {
    id: "B1-05b", entrega: "bloque1", rol: "administracion",
    titulo: "Pasajeros distintos en vuelos distintos: lo que el voucher sabe y lo que no",
    ruta: "/dashboard/contratos/DTM-9871",
    accion: "1) En DTM-9871 (4 pasajeros: Ana Pérez, Luis Gómez, Marta Ríos y Pedro Soto; dos servicios aéreos: Bogotá–Cartagena AV871/AV872 y Medellín–Cartagena LA881/LA882) pulsa «Voucher de vuelo». 2) Abre «Ver / imprimir →» de cada tarjeta y baja hasta «Pasajeros de la reserva». 3) Usa la vista de impresión del navegador.",
    esperado: "Se crean DOS vouchers (uno por servicio). El del servicio Bogotá–Cartagena trae AV871 y AV872 y su PNR RV2AAA, sin nada de LA881/LA882; el del servicio Medellín–Cartagena trae LA881 y LA882 y su PNR RV2BBB. AMBOS listan a los CUATRO pasajeros, porque el sistema no guarda quién viaja en qué vuelo, y lo dicen en un recuadro ámbar visible: «Esta reserva tiene 2 servicios aéreos. El sistema no registra qué pasajero viaja en cada vuelo: la lista de pasajeros corresponde a toda la reserva, no a este vuelo en particular. No se debe entender que todos los pasajeros viajan en todos los vuelos.» más la nota «Pasajeros y tramos se listan por separado…». Ambos textos salen también al imprimir. Nadie decide por el sistema cuál pasajero va en cuál vuelo.",
    async verificar(c) {
      const m = await generarVuelo(c, "DTM-9871");
      const v = vouchersVuelo(c, "DTM-9871");
      c.check("DTM-9871: el botón creó 2 vouchers con enlaces distintos", /2 nuevo\(s\)/.test(m) && v.length === 2 && v[0].token !== v[1].token, m);
      for (const x of v) {
        const t = await textoVoucher(c, x.token);
        const esA = /AV871/.test(t);
        const propio = esA ? ["AV871", "AV872", "RV2AAA"] : ["LA881", "LA882", "RV2BBB"], ajeno = esA ? ["LA881", "LA882", "RV2BBB"] : ["AV871", "AV872", "RV2AAA"];
        c.check(`servicio ${esA ? "Bogotá–Cartagena" : "Medellín–Cartagena"}: solo sus tramos y PNR`, propio.every((y) => t.includes(y)) && ajeno.every((y) => !t.includes(y)), t.slice(0, 160));
        c.check("lista a los CUATRO pasajeros (no hay vínculo pasajero↔tramo)", ["Ana Pérez", "Luis Gómez", "Marta Ríos", "Pedro Soto"].every((n) => t.includes(n)), "");
        c.check("dice que el sistema no registra qué pasajero viaja en cada vuelo", /Esta reserva tiene 2 servicios aéreos\. El sistema no registra qué pasajero viaja en cada vuelo/.test(t) && /no hay registrada una asignación de pasajero a tramo/.test(t), "");
        const aviso = c.page.getByTestId("aviso-varios-servicios");
        const caja = await aviso.boundingBox();
        c.check("el aviso es visible (no oculto ni diminuto) y se imprime", !!caja && caja.height >= 24 && !(await aviso.evaluate((e) => /print:hidden/.test(e.className))), JSON.stringify(caja));
      }
    },
  },
  {
    id: "B1-06", entrega: "bloque1", rol: "administracion",
    titulo: "Voucher sin PNR y vista previa interna según el pago",
    ruta: "/dashboard/contratos/DTM-9804",
    accion: "1) En DTM-9804 (sin PNR guardado) pulsa «Voucher de vuelo» y abre «Ver / imprimir →». 2) En DTM-9801 (100 % pagado, PNR ABC123) pulsa «Voucher de vuelo», lee la nota sobre el aliado y abre el voucher. 3) En DTM-9802 (pago parcial, PNR SECRET9802) genera el voucher, lee la nota y abre el voucher; usa la vista de impresión del navegador.",
    esperado: "DTM-9804: el voucher se genera sin problema, muestra el vuelo AV501 y NO tiene celda de PNR. DTM-9801: la ficha dice «Contrato 100 % pagado: el aliado ya puede abrir estos vouchers desde su portal.» y el voucher muestra el PNR ABC123 al personal interno. DTM-9802: la ficha dice «Vista previa interna: el aliado solo podrá abrir estos vouchers cuando el contrato esté 100 % pagado…»; el voucher NO muestra SECRET9802 (ni en pantalla ni en el código de la página), explica «se mostrará en el voucher cuando el contrato esté 100 % pagado» y esa nota no se imprime.",
    async verificar(c) {
      const m4 = await generarVuelo(c, "DTM-9804");
      const v4 = vouchersVuelo(c, "DTM-9804");
      c.check("DTM-9804: se genera sin PNR guardado", /1 nuevo\(s\)/.test(m4) && v4.length === 1, m4);
      const t4 = await textoVoucher(c, v4[0].token);
      c.check("DTM-9804: trae AV501 y ninguna celda de PNR", /AV501/.test(t4) && !/PNR/i.test(t4), t4.slice(0, 300));
      const m1 = await generarVuelo(c, "DTM-9801");
      const v1 = vouchersVuelo(c, "DTM-9801");
      c.check("DTM-9801: voucher generado", /1 nuevo\(s\)/.test(m1) && v1.length === 1, m1);
      c.check("DTM-9801: la ficha dice que el aliado ya puede abrirlo (100 % pagado)", /Contrato 100\s*% pagado: el aliado ya puede abrir estos vouchers desde su portal/.test(await c.texto()), "");
      const t1 = await textoVoucher(c, v1[0].token);
      c.check("DTM-9801: el personal interno ve el PNR ABC123", /ABC123/.test(t1) && /PNR \/ C.DIGO DE RESERVA/i.test(t1), t1.slice(0, 200));
      const m2 = await generarVuelo(c, "DTM-9802");
      const v2 = vouchersVuelo(c, "DTM-9802");
      c.check("DTM-9802: voucher generado", /1 nuevo\(s\)/.test(m2) && v2.length === 1, m2);
      c.check("DTM-9802: la ficha avisa que es vista previa interna", /Vista previa interna: el aliado solo podrá abrir estos vouchers cuando el contrato esté 100\s*% pagado/.test(await c.texto()), "");
      const t2 = await textoVoucher(c, v2[0].token);
      const html = await c.page.content();
      c.check("DTM-9802: el PNR no está en pantalla ni en el código de la página", !/SECRET9802/.test(t2) && !/SECRET9802/.test(html), "");
      c.check("DTM-9802: explica por qué no se muestra el PNR", /se mostrará en el voucher cuando el contrato esté 100\s*% pagado/.test(t2) && /AV223/.test(t2), "");
      await c.page.emulateMedia({ media: "print" });
      const nota = await c.page.evaluate(() => { const e = document.querySelector('[data-testid="pnr-pendiente-pago"]'); return e ? getComputedStyle(e).display : "sin nota"; });
      await c.page.emulateMedia({ media: null });
      c.check("la nota interna no se imprime", nota === "none", nota);
    },
  },
  {
    id: "B1-07", entrega: "bloque1", rol: "administracion", solo_lectura: true,
    titulo: "Voucher aéreo en celular e impresión (datos largos)",
    ruta: "/dashboard/contratos/DTM-9703",
    accion: "1) En DTM-9703 abre «Ver / imprimir →» del voucher aéreo (nombre de cliente y aerolínea muy largos, 4 tramos). 2) Míralo a ancho de escritorio, intermedio y celular. 3) Abre la vista de impresión del navegador.",
    esperado: "Nada se sale de la pantalla en ninguno de los tres anchos: cada tramo muestra aerolínea, vuelo, fecha, origen, destino y horas dentro de su recuadro, y el texto largo se parte en varias líneas. El documento impreso cabe en 4 páginas o menos y el PNR de un contrato sin pago completo no aparece.",
    async verificar(c) {
      const v = vouchersVuelo(c, "DTM-9703");
      c.check("existe el voucher de DTM-9703 (lo generó B1-05)", v.length === 1, String(v.length));
      const t = await textoVoucher(c, v[0].token);
      c.check("muestra el nombre largo del titular y los 4 tramos", /desbordamiento del documento impreso/.test(t) && ["XX900", "XX901", "XX902", "XX903"].every((x) => t.includes(x)), "");
      c.check("sin PNR en un contrato sin pago completo", !/PNR9703/.test(t), "");
      const desborda = await c.page.evaluate(() => [...document.querySelectorAll('[data-testid="tramo-voucher-vuelo"]')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
      c.check("ningún recuadro de tramo desborda", desborda === 0, String(desborda));
      const n = await paginasPdf(c.page);
      c.check("impreso cabe en 4 páginas o menos", n === -1 || (n >= 1 && n <= 4), String(n));
    },
  },
  {
    id: "B1-08", entrega: "bloque1", rol: "aliado", solo_lectura: true,
    titulo: "El aliado abre el voucher solo con el contrato 100 % pagado",
    ruta: "/portal/b2b/documentos",
    accion: "1) En «Documentos» busca los contratos DTM-9801 y DTM-9802. 2) Abre el «Voucher vuelo» de DTM-9801. 3) Intenta abrir el voucher de DTM-9802 (enlace directo que te pasa el personal). 4) Revisa que DTM-9803 y DTM-9804 no figuren.",
    esperado: "DTM-9801 (pagado) lista «Voucher vuelo» y el voucher muestra el PNR ABC123 en cada tramo y, al final de «Pasajeros de la reserva», la misma nota «no hay registrada una asignación de pasajero a tramo» que ve el personal (la nota interna «se mostrará cuando el contrato esté 100 % pagado» NO aparece: es solo para el personal). DTM-9802 (pago parcial) dice «Disponible cuando el contrato esté 100 % pagado» y su enlace directo responde página no encontrada: sin vuelos, sin pasajeros, sin PNR. DTM-9803 y DTM-9804 no tienen aliado y no aparecen. El voucher cabe en celular e impreso en 2 páginas o menos.",
    async verificar(c) {
      await c.ir("/portal/b2b/documentos");
      const t = await c.texto();
      c.check("el portal lista DTM-9801 y DTM-9802", t.includes("DTM-9801") && t.includes("DTM-9802"), t.slice(0, 200));
      c.check("DTM-9803 y DTM-9804 no figuran (sin aliado)", !t.includes("DTM-9803") && !t.includes("DTM-9804"), "");
      const fila1 = norm(await c.page.locator("tr", { hasText: "DTM-9801" }).first().innerText());
      const fila2 = norm(await c.page.locator("tr", { hasText: "DTM-9802" }).first().innerText());
      c.check("DTM-9801 ofrece «Voucher vuelo»", /Voucher vuelo/i.test(fila1), fila1);
      c.check("DTM-9802 dice «Disponible cuando el contrato esté 100 % pagado» y no enlaza voucher", /Disponible cuando el contrato esté 100\s*% pagado/.test(fila2) && !/Voucher vuelo/i.test(fila2), fila2);
      const t1 = vouchersVuelo(c, "DTM-9801")[0]?.token, t2 = vouchersVuelo(c, "DTM-9802")[0]?.token;
      c.check("existen los vouchers generados en B1-06", !!t1 && !!t2, "");
      const x2 = await textoVoucher(c, t2);
      c.check("voucher impago: el aliado no recibe contenido (sin vuelos, pasajeros ni PNR)", !/AV223|Cliente sin pago|Ana Ruiz|SECRET9802/.test(x2) && !/Servicio a.reo/i.test(x2), x2.slice(0, 160));
      const x1 = await textoVoucher(c, t1);
      c.check("voucher pagado: el aliado ve el PNR ABC123 y los tramos", /ABC123/.test(x1) && /AV123/.test(x1) && /AV124/.test(x1) && /PNR \/ C.DIGO DE RESERVA/i.test(x1), x1.slice(0, 200));
      c.check("Rev2 B1-06 · el aliado ve la nota de pasajeros y tramos y NO la nota interna de PNR pendiente", /no hay registrada una asignación de pasajero a tramo/.test(x1) && !/se mostrará en el voucher cuando el contrato esté 100/.test(x1) && (await c.page.getByTestId("pnr-pendiente-pago").count()) === 0 && (await c.page.getByTestId("nota-pasajeros-tramos").count()) === 1, "");
      const n = await paginasPdf(c.page);
      c.check("impreso cabe en 2 páginas o menos", n === -1 || (n >= 1 && n <= 2), String(n));
    },
  },
  {
    id: "B1-08b", entrega: "bloque1", rol: "aliado", solo_lectura: true,
    titulo: "El aliado ve la misma aclaración sobre pasajeros y vuelos",
    ruta: "/portal/b2b/documentos",
    accion: "1) En «Documentos» busca DTM-9871 (pagado; lo generó el personal en el paso B1-05b). 2) Abre sus dos «Voucher vuelo». 3) Baja hasta «Pasajeros de la reserva».",
    esperado: "Ves los dos vouchers de DTM-9871 con su PNR (RV2AAA y RV2BBB), los cuatro pasajeros y el mismo recuadro «Esta reserva tiene 2 servicios aéreos. El sistema no registra qué pasajero viaja en cada vuelo…» y la nota «Pasajeros y tramos se listan por separado…» que ve el personal. No aparece la nota interna sobre «se mostrará cuando el contrato esté 100 % pagado».",
    async verificar(c) {
      await c.ir("/portal/b2b/documentos");
      const fila = norm(await c.page.locator("tr", { hasText: "DTM-9871" }).first().innerText());
      c.check("el portal lista DTM-9871 con sus vouchers de vuelo", /Voucher vuelo/i.test(fila), fila);
      for (const x of vouchersVuelo(c, "DTM-9871")) {
        const t = await textoVoucher(c, x.token);
        c.check("el aliado ve el aviso de 2 servicios, la nota y su PNR", /Esta reserva tiene 2 servicios aéreos/.test(t) && /no hay registrada una asignación de pasajero a tramo/.test(t) && /RV2(AAA|BBB)/.test(t), t.slice(0, 160));
        c.check("el aliado NO ve la nota interna de PNR pendiente", (await c.page.getByTestId("pnr-pendiente-pago").count()) === 0, "");
      }
    },
  },
  {
    id: "B1-09", entrega: "bloque1", rol: null, solo_lectura: true,
    titulo: "El contrato del cliente no lleva el PNR; la cotización sí muestra vuelos y horas",
    ruta: "/cot/11111111-1111-4111-8111-111111111111",
    accion: "Sin iniciar sesión: 1) Abre la cotización pública (enlace de la ruta). 2) Abre el documento del contrato de DTM-9701 y el de DTM-9801 (enlace /c/<token> que entrega el sistema: pídelo a quien te acompaña o cópialo desde la ficha del contrato).",
    esperado: "La cotización de «Cliente Cotización» muestra los vuelos AV123 y AV124 con hora de salida y llegada (08:15 y 09:45) y un solo aviso de que los itinerarios pueden cambiar. Los documentos del contrato (DTM-9701 y DTM-9801) NO muestran número de vuelo, horas ni PNR (PNR9701, ABC123).",
    async verificar(c) {
      await c.ir("/cot/11111111-1111-4111-8111-111111111111");
      const tq = await c.texto();
      c.check("la cotización pública abre", /Cliente Cotización/.test(tq), tq.slice(0, 160));
      c.check("la cotización muestra vuelos y horas HH:mm", /AV123/.test(tq) && /AV124/.test(tq) && /08:15/.test(tq) && /09:45/.test(tq), "");
      c.check("el aviso de cambio de itinerario no se repite por tramo", (tq.match(/sujetos a cambio|sujeto a cambio/gi) ?? []).length <= 2, String((tq.match(/sujetos a cambio|sujeto a cambio/gi) ?? []).length));
      const tok = (n) => c.sql(`select share_token from public.ventas where numero_contrato = '${n}'`);
      await c.ir(`/c/${tok("DTM-9701")}`);
      const t97 = await c.texto();
      c.check("contrato DTM-9701 del cliente: abre y no trae vuelo, hora ni PNR", /María Fernanda Pérez/.test(t97) && /CARTAGENA/i.test(t97) && !/AV123/.test(t97) && !/08:15/.test(t97) && !/PNR9701/.test(t97), t97.slice(0, 200));
      await c.ir(`/c/${tok("DTM-9801")}`);
      const t98 = await c.texto();
      c.check("contrato DTM-9801 del cliente: abre y no trae PNR", /María Fernanda Pérez/.test(t98) && !/ABC123/.test(t98) && !/PNR/.test(t98), t98.slice(0, 200));
    },
  },
  {
    id: "B1-10", entrega: "bloque1", rol: "administracion",
    titulo: "Editar un vuelo guardado deja el voucher anterior como no vigente",
    ruta: "/dashboard/contratos/DTM-9806",
    accion: "1) En DTM-9806 pulsa «Voucher de vuelo» y abre «Ver / imprimir →». 2) Pulsa «Registrar o editar vuelo y record →». 3) En el primer tramo cambia «Hora salida» de 08:15 a 09:05 y pulsa «Guardar vuelo». 4) Vuelve a abrir el voucher y mira la ficha del contrato. 5) Mira la vista de impresión del voucher.",
    esperado: "Tras guardar, el editor dice «Vuelo guardado.». El voucher abierto por el personal interno se ve con el banner rojo «Desactualizado: los vuelos del servicio cambiaron después de generar este voucher. No lo entregues; vuelve a generarlo desde el contrato.» y ese banner SÍ se imprime. La tarjeta del voucher en la ficha dice «Desactualizado: volver a generar».",
    async verificar(c) {
      const m = await generarVuelo(c, "DTM-9806");
      const v = vouchersVuelo(c, "DTM-9806");
      c.check("DTM-9806: voucher generado", /1 nuevo\(s\)/.test(m) && v.length === 1, m);
      const t0 = await textoVoucher(c, v[0].token);
      c.check("antes del cambio trae AV601, AV602 y el PNR ZZZ601", /AV601/.test(t0) && /AV602/.test(t0) && /ZZZ601/.test(t0) && /08:15/.test(t0), t0.slice(0, 200));
      await cambiarHoraTramo(c, "DTM-9806", 0, "09:05");
      const t1 = await textoVoucher(c, v[0].token);
      c.check("el personal ve el documento con el banner «Desactualizado»", /Desactualizado: los vuelos del servicio cambiaron/.test(t1) && /AV602/.test(t1), t1.slice(0, 200));
      await c.page.emulateMedia({ media: "print" });
      const banner = await c.page.evaluate(() => { const e = document.querySelector('[data-testid="voucher-desactualizado"]'); return e ? getComputedStyle(e).display : "sin banner"; });
      await c.page.emulateMedia({ media: null });
      c.check("el banner se imprime (una copia en papel no pasa por vigente)", banner !== "none" && banner !== "sin banner", banner);
      await c.ir("/dashboard/contratos/DTM-9806");
      c.check("la ficha marca «Desactualizado: volver a generar»", /Desactualizado: volver a generar/i.test(await c.texto()), "");
    },
  },
  {
    id: "B1-11", entrega: "bloque1", rol: "aliado", solo_lectura: true,
    titulo: "El aliado con el enlace anterior ve «Voucher en actualización», sin itinerario",
    ruta: "/portal/b2b/documentos",
    accion: "Con la cuenta del aliado abre el voucher aéreo de DTM-9806 (enlace del portal o el que ya tenías).",
    esperado: "Mientras el personal no regenere el voucher, la página dice «Voucher en actualización», explica que el documento vigente se publicará en el mismo enlace y pide «Comunícate con tu asesor.». No muestra vuelos, horas, pasajeros ni PNR.",
    async verificar(c) {
      const v = vouchersVuelo(c, "DTM-9806");
      c.check("existe el voucher de DTM-9806", v.length === 1, String(v.length));
      const t = await textoVoucher(c, v[0].token);
      c.check("«Voucher en actualización» y «Comunícate con tu asesor.»", /Voucher en actualización/.test(t) && /Comunícate con tu asesor/.test(t), t.slice(0, 200));
      c.check("sin itinerario, pasajeros ni PNR", !/AV601|AV602|ZZZ601|Nora Vega|Iván Vega/.test(t), "");
    },
  },
  {
    id: "B1-12", entrega: "bloque1", rol: "administracion",
    titulo: "Regenerar conserva el enlace y actualiza el itinerario",
    ruta: "/dashboard/contratos/DTM-9806",
    accion: "1) En DTM-9806 pulsa «Voucher de vuelo». 2) Abre «Ver / imprimir →». 3) Pulsa «Voucher de vuelo» una segunda vez sin cambiar nada.",
    esperado: "El mensaje dice «✓ Voucher(s) de vuelo: 0 nuevo(s), 1 actualizado(s) en el mismo enlace». El enlace es el mismo de antes y ahora muestra la hora 09:05 sin banner de desactualizado. La tarjeta pasa a «Actualizado (n)» (señal interna, no prueba que el cliente lo haya visto). La segunda pulsación responde «Voucher(s) de vuelo sin cambios (mismo contenido y mismo enlace)».",
    async verificar(c) {
      const antes = vouchersVuelo(c, "DTM-9806");
      const m = await generarVuelo(c, "DTM-9806");
      c.check("regeneración: 1 actualizado en el mismo enlace", /0 nuevo\(s\), 1 actualizado\(s\) en el mismo enlace/.test(m), m);
      const despues = vouchersVuelo(c, "DTM-9806");
      c.check("el enlace es exactamente el mismo", despues.length === 1 && despues[0].token === antes[0].token, JSON.stringify(despues));
      const t = await c.texto();
      c.check("la tarjeta dice «Actualizado (n)» y ya no «Desactualizado»", /Actualizado \(\d+\)/.test(t) && !/Desactualizado: volver a generar/i.test(t), "");
      const v = await textoVoucher(c, despues[0].token);
      c.check("el voucher muestra 09:05, AV601 y AV602, sin banner de desactualizado", /09:05/.test(v) && /AV601/.test(v) && /AV602/.test(v) && !/Desactualizado: los vuelos/.test(v), v.slice(0, 200));
      const m2 = await generarVuelo(c, "DTM-9806");
      c.check("pulsar de nuevo sin cambios no agrega nada", /sin cambios \(mismo contenido y mismo enlace\)/.test(m2), m2);
    },
  },
  {
    id: "B1-13", entrega: "bloque1", rol: "administracion",
    titulo: "Itinerario heredado (una sola fila ida y regreso): guardar sin cambios, editar SOLO la ida y regenerar",
    ruta: "/dashboard/contratos/DTM-9807",
    accion: "1) En DTM-9807 (itinerario antiguo: ida LG100 y regreso LG200 en una sola fila, PNR LEGPNR1) pulsa «Voucher de vuelo» y abre el voucher. 2) Abre «Registrar o editar vuelo y record →» y, SIN cambiar nada, pulsa «Guardar vuelo»; abre el voucher anterior y la ficha. 3) En el mismo editor elige «Tramo» = «Ida», «N.° de vuelo» = LG111, «Hora salida» = 08:00, «Hora llegada» = 09:30 y pulsa «Guardar vuelo». 4) Abre el voucher anterior y la ficha. 5) Pulsa «Voucher de vuelo» otra vez y abre el voucher.",
    esperado: "Antes de editar, el voucher muestra los dos vuelos heredados (LG100 de ida y LG200 de regreso) y el PNR LEGPNR1. Guardar SIN cambios no desactualiza nada: el voucher sigue igual, sin banner, y al pulsar «Voucher de vuelo» dice «sin cambios». Al editar solo la ida, el voucher anterior queda con el banner «Desactualizado: los vuelos del servicio cambiaron…» y la ficha dice «Desactualizado: volver a generar». Al regenerar el enlace es el mismo y muestra LG111 de ida y el regreso heredado LG200 (10 de junio de 2027, 18:00–19:30) SIN que haya que volver a escribirlo, ya sin LG100 ni banner. El itinerario guardado del regreso (vuelo, fecha y horas) no se modificó.",
    async verificar(c) {
      const legado = () => c.sql(`select id || '|' || servicio_aereo || '|' || coalesce(vuelo_ida, '') || '|' || coalesce(vuelo_regreso, '') || '|' || coalesce(hora_salida_ida, '') || '|' || coalesce(hora_llegada_ida, '') || '|' || coalesce(fecha_regreso::text, '') || '|' || coalesce(hora_salida_reg, '') || '|' || coalesce(hora_llegada_reg, '') from public.contrato_vuelos where numero_contrato = 'DTM-9807'`);
      const m = await generarVuelo(c, "DTM-9807");
      const v = vouchersVuelo(c, "DTM-9807");
      c.check("DTM-9807: voucher generado desde el itinerario heredado", /1 nuevo\(s\)/.test(m) && v.length === 1, m);
      const t0 = await textoVoucher(c, v[0].token);
      c.check("antes de editar: LG100, LG200 y el PNR LEGPNR1", /LG100/.test(t0) && /LG200/.test(t0) && /LEGPNR1/.test(t0), t0.slice(0, 200));
      const l0 = legado();
      c.check("la fila heredada guarda ida y regreso en sus columnas (una sola fila)", /^\d+\|[0-9a-f-]{36}\|LG100\|LG200\|08:00\|09:30\|2027-06-10\|18:00\|19:30$/.test(l0), l0);
      const guardar = async () => {
        await c.ir("/dashboard/vuelos/contrato/DTM-9807");
        const tarjeta = tarjetasTramo(c).first();
        await tarjeta.waitFor({ timeout: 20000 });
        return tarjeta;
      };
      // Paso A — guardar SIN cambios por el editor real: no es una edición, no desactualiza nada y no toca el itinerario heredado.
      await guardar();
      await c.page.getByRole("button", { name: "Guardar vuelo" }).click();
      const okA = await c.page.getByText("Vuelo guardado.").waitFor({ timeout: 30000 }).then(() => true, () => false);
      c.check("guardar sin cambios («Vuelo guardado.»)", okA, "");
      await c.espera(1500);
      c.check("la fila, su servicio y todas las columnas del itinerario heredado quedan idénticas", legado() === l0, `${l0} → ${legado()}`);
      const tA = await textoVoucher(c, v[0].token);
      c.check("el voucher sigue vigente (sin banner) con LG100 y LG200", !/Desactualizado: los vuelos/.test(tA) && /LG100/.test(tA) && /LG200/.test(tA), tA.slice(0, 200));
      const mA = await generarVuelo(c, "DTM-9807");
      c.check("«Voucher de vuelo» después de guardar sin cambios: sin cambios, mismo enlace", /sin cambios \(mismo contenido y mismo enlace\)/.test(mA) && vouchersVuelo(c, "DTM-9807").length === 1, mA);
      // Paso B — editar SOLO la ida.
      const tarjeta = await guardar();
      await tarjeta.locator("select").first().selectOption({ label: "Ida" });
      await campoTramo(tarjeta, "N.° de vuelo").fill("LG111");
      await campoTramo(tarjeta, "Hora salida").fill("08:00");
      await campoTramo(tarjeta, "Hora llegada").fill("09:30");
      await c.page.getByRole("button", { name: "Guardar vuelo" }).click();
      const ok = await c.page.getByText("Vuelo guardado.").waitFor({ timeout: 30000 }).then(() => true, () => false);
      c.check("el editor guardó el tramo heredado («Vuelo guardado.»)", ok, norm(await c.page.locator("section").first().innerText().catch(() => "")).slice(0, 200));
      await c.espera(1500);
      const l1 = legado().split("|");
      c.check("el regreso heredado sigue guardado intacto (LG200, 10 jun, 18:00–19:30) y la fila y su servicio son los mismos", l1[0] === l0.split("|")[0] && l1[1] === l0.split("|")[1] && l1.slice(3).join("|") === l0.split("|").slice(3).join("|"), `${l0} → ${legado()}`);
      c.check("el editor solo escribió los campos modernos del tramo de ida (LG111, 08:00, 09:30)", c.sql(`select numero_vuelo || '|' || hora_salida || '|' || hora_llegada || '|' || direccion from public.contrato_vuelos where numero_contrato = 'DTM-9807'`) === "LG111|08:00|09:30|ida", "");
      const t1 = await textoVoucher(c, v[0].token);
      c.check("el voucher anterior queda con el banner «Desactualizado»", /Desactualizado: los vuelos del servicio cambiaron/.test(t1) && /LG100/.test(t1), t1.slice(0, 200));
      await c.ir("/dashboard/contratos/DTM-9807");
      c.check("la ficha marca «Desactualizado: volver a generar»", /Desactualizado: volver a generar/i.test(await c.texto()), "");
      const m2 = await generarVuelo(c, "DTM-9807");
      const v2 = vouchersVuelo(c, "DTM-9807");
      c.check("regenerado en el mismo enlace y el mismo servicio", /1 actualizado\(s\) en el mismo enlace/.test(m2) && v2.length === 1 && v2[0].token === v[0].token && v2[0].clave === v[0].clave, m2);
      const t2 = await textoVoucher(c, v2[0].token);
      c.check("el mismo enlace muestra LG111 y ya no LG100, sin banner", /LG111/.test(t2) && !/LG100/.test(t2) && !/Desactualizado: los vuelos/.test(t2), t2.slice(0, 250));
      c.check("el regreso heredado LG200 SIGUE en el voucher regenerado (sin volver a escribirlo), con su fecha y horas", /LG200/.test(t2) && /2027/.test(t2) && /18:00/.test(t2) && /19:30/.test(t2) && /LEGPNR1/.test(t2), t2.slice(0, 600));
      const orden = [t2.indexOf("LG111"), t2.indexOf("LG200")];
      c.check("el orden es ida (LG111) y luego regreso (LG200)", orden[0] >= 0 && orden[1] > orden[0], JSON.stringify(orden));
      const m3 = await generarVuelo(c, "DTM-9807");
      c.check("pulsar de nuevo sin cambios no agrega nada", /sin cambios \(mismo contenido y mismo enlace\)/.test(m3), m3);
    },
  },
  {
    id: "B1-14", entrega: "bloque1", rol: "superadmin",
    titulo: "Señal interna «comunicación pendiente» separada de la entrega real",
    ruta: "/dashboard/gestion-contratos?numero=DTM-9803",
    accion: "1) En Gestión de contratos filtra por DTM-9803; en «Voucher» pulsa «Registrar entrega», elige un canal y «Guardar acuse». 2) Abre «Registrar o editar vuelo y record →» de DTM-9803, cambia «Hora salida» del primer tramo de 07:00 a 07:30 y pulsa «Guardar vuelo». 3) Vuelve a Gestión de contratos. 4) En la ficha del contrato pulsa «Voucher de vuelo». 5) Vuelve a Gestión de contratos.",
    esperado: "Tras el acuse la fila dice «Entrega registrada manualmente» (acuse del personal, no prueba que el cliente lo recibiera). Después del cambio de vuelo la fila dice «Generado (2): vuelo desactualizado» y «Voucher actualizado: comunicación pendiente». Tras regenerar, la ficha marca «Actualizado (n)» en UNA sola tarjeta, y Gestión mantiene «Voucher actualizado: comunicación pendiente»: ya no presenta la entrega anterior como vigente y aclara «no indica que el cliente haya recibido, leído ni aceptado el cambio». La señal es interna: el sistema no envía nada al cliente.",
    async verificar(c) {
      const fila = () => c.page.locator("article").filter({ hasText: "DTM-9803" }).first();
      await c.ir("/dashboard/gestion-contratos?numero=DTM-9803");
      c.check("la fila de DTM-9803 aparece", (await c.page.locator("article").filter({ hasText: "DTM-9803" }).count()) >= 1, "");
      await fila().getByRole("button", { name: "Registrar entrega" }).click();
      await fila().locator("select").selectOption({ label: "Correo" });
      await fila().getByRole("button", { name: "Guardar acuse" }).click();
      await c.espera(3500);
      await c.ir("/dashboard/gestion-contratos?numero=DTM-9803");
      c.check("tras el acuse: «Entrega registrada manualmente»", /Entrega registrada manualmente/.test(norm(await fila().innerText())), norm(await fila().innerText()).slice(0, 300));
      await cambiarHoraTramo(c, "DTM-9803", 0, "07:30");
      await c.ir("/dashboard/gestion-contratos?numero=DTM-9803");
      let f = norm(await fila().innerText());
      c.check("solo con el cambio de vuelo ya dice «vuelo desactualizado» y «comunicación pendiente»", /vuelo desactualizado/i.test(f) && /Voucher actualizado: comunicación pendiente/.test(f), f.slice(0, 400));
      const m = await generarVuelo(c, "DTM-9803");
      c.check("regeneración del servicio cambiado", /1 actualizado\(s\) en el mismo enlace/.test(m), m);
      const tarjetas = (await c.texto()).match(/Actualizado \(\d+\)/g) ?? [];
      c.check("la ficha marca «Actualizado (n)» en una sola tarjeta", tarjetas.length === 1, JSON.stringify(tarjetas));
      await c.ir("/dashboard/gestion-contratos?numero=DTM-9803");
      f = norm(await fila().innerText());
      c.check("Gestión mantiene «Voucher actualizado: comunicación pendiente»", /Voucher actualizado: comunicación pendiente/.test(f), f.slice(0, 400));
      c.check("ya no presenta la entrega anterior como vigente", !/Entrega registrada manualmente/.test(f), f.slice(0, 400));
      c.check("aclara que es una señal interna, no prueba de recepción por el cliente", /no indica que el cliente haya recibido, leído ni aceptado/.test(await c.texto()), "");
    },
  },
  {
    id: "B1-15", entrega: "bloque1", rol: "administracion",
    titulo: "Unir, retirar y separar servicios aéreos (el PNR no define el servicio)",
    ruta: "/dashboard/vuelos/contrato/DTM-9805",
    accion: "1) En DTM-9805 (dos servicios que comparten el PNR SAME00) abre el editor. 2) En el segundo tramo cambia «Servicio aéreo contratado» a «Servicio 1» y pulsa «Guardar vuelo». 3) Mira las tarjetas de voucher en la ficha del contrato y pulsa «Voucher de vuelo». 4) Vuelve al editor y pon el segundo tramo en «Servicio nuevo A», guarda, y pulsa «Voucher de vuelo» en la ficha.",
    esperado: "Al unir: la tarjeta del servicio que ya no existe dice «Retirado (servicio ya no existe)» y la del servicio 1 «Desactualizado: volver a generar»; al regenerar, el voucher del servicio 1 conserva su enlace y trae AV701 y AV702, (el voucher del servicio inexistente ya figura como retirado: su enlace no muestra itinerario y el historial se conserva). Al separar de nuevo con «Servicio nuevo A» se crea un voucher NUEVO con enlace propio para AV702 y el del servicio 1 vuelve a traer solo AV701: la identidad del servicio es la asociación guardada, no el PNR compartido.",
    async verificar(c) {
      const previos = vouchersVuelo(c, "DTM-9805");
      c.check("DTM-9805 parte con 2 vouchers (B1-05)", previos.length === 2, String(previos.length));
      let ancla = null, otro = null;
      for (const v of previos) { const t = await textoVoucher(c, v.token); if (/AV701/.test(t)) ancla = v; else otro = v; }
      c.check("se identifican el voucher de AV701 y el de AV702", !!ancla && !!otro, "");
      // Unir: el tramo 2 pasa al servicio 1.
      await c.ir("/dashboard/vuelos/contrato/DTM-9805");
      const t2 = tarjetasTramo(c).nth(1);
      await t2.waitFor({ timeout: 20000 });
      await t2.getByTestId("tramo-servicio-aereo").selectOption({ label: "Servicio 1" });
      await c.page.getByRole("button", { name: "Guardar vuelo" }).click();
      await c.page.getByText("Vuelo guardado.").waitFor({ timeout: 30000 });
      await c.espera(1500);
      await c.ir("/dashboard/contratos/DTM-9805");
      let t = await c.texto();
      c.check("tras unir: una tarjeta «Retirado (servicio ya no existe)» y una «Desactualizado: volver a generar»", /Retirado \(servicio ya no existe\)/.test(t) && /Desactualizado: volver a generar/i.test(t), "");
      const m = await generarVuelo(c, "DTM-9805");
      c.check("regeneración tras unir: servicio 1 actualizado, el otro retirado", /1 actualizado\(s\) en el mismo enlace/.test(m), m);
      const tUnido = await textoVoucher(c, ancla.token);
      c.check("el voucher del servicio 1 conserva su enlace y trae AV701 y AV702", /AV701/.test(tUnido) && /AV702/.test(tUnido), tUnido.slice(0, 200));
      const tRetirado = await textoVoucher(c, otro.token);
      c.check("el enlace del servicio retirado dice «Voucher retirado» y no muestra itinerario", /Voucher retirado/.test(tRetirado) && !/AV702|SAME00/.test(tRetirado), tRetirado.slice(0, 200));
      // Separar: el tramo 2 pasa a un servicio nuevo.
      await c.ir("/dashboard/vuelos/contrato/DTM-9805");
      const t2b = tarjetasTramo(c).nth(1);
      await t2b.waitFor({ timeout: 20000 });
      await t2b.getByTestId("tramo-servicio-aereo").selectOption({ label: "Servicio nuevo A" });
      await c.page.getByRole("button", { name: "Guardar vuelo" }).click();
      await c.page.getByText("Vuelo guardado.").waitFor({ timeout: 30000 });
      await c.espera(1500);
      const m2 = await generarVuelo(c, "DTM-9805");
      const finales = vouchersVuelo(c, "DTM-9805");
      c.check("al separar se crea 1 voucher nuevo y el del servicio 1 se actualiza", /1 nuevo\(s\), 1 actualizado\(s\)/.test(m2) && finales.length === 3, m2);
      const nuevo = finales.find((f) => f.token !== ancla.token && f.token !== otro.token);
      const tNuevo = nuevo ? await textoVoucher(c, nuevo.token) : "";
      const tAncla = await textoVoucher(c, ancla.token);
      c.check("el voucher nuevo trae solo AV702 y el del servicio 1 solo AV701", /AV702/.test(tNuevo) && !/AV701/.test(tNuevo) && /AV701/.test(tAncla) && !/AV702/.test(tAncla), "");
    },
  },
  {
    id: "B1-16", entrega: "bloque1", rol: "administracion",
    titulo: "Tramo histórico sin servicio asociado: se exige asociarlo, nunca se adivina",
    ruta: "/dashboard/contratos/DTM-5101",
    accion: "1) En DTM-5101 (dos servicios aéreos guardados y un tercer tramo histórico AV512 sin servicio) pulsa «Voucher de vuelo». 2) Abre «Registrar o editar vuelo y record →»: el tercer tramo muestra «— elegir servicio —». 3) En ese tramo elige «Servicio 2» y pulsa «Guardar vuelo». 4) Vuelve a la ficha y pulsa «Voucher de vuelo».",
    esperado: "El primer intento NO genera nada y avisa «Hay 1 tramo(s) del contrato sin servicio aéreo asociado. Asócialos a su servicio en el editor de vuelos del contrato y vuelve a generar. No se cambió ningún voucher.». Tras asociar el tramo a «Servicio 2» el editor dice «Vuelo guardado.» y la generación crea 2 vouchers: el del servicio 1 con AV510 y el del servicio 2 con AV511 y AV512 juntos (aunque sus PNR sean distintos).",
    async verificar(c) {
      const m = await generarVuelo(c, "DTM-5101");
      c.check("sin asociar: la generación se rechaza con el aviso y no crea vouchers", /sin servicio aéreo asociado/.test(m) && /No se cambió ningún voucher/.test(m) && vouchersVuelo(c, "DTM-5101").length === 0, m);
      await c.ir("/dashboard/vuelos/contrato/DTM-5101");
      const t3 = tarjetasTramo(c).nth(2);
      await t3.waitFor({ timeout: 20000 });
      c.check("el tercer tramo pide elegir servicio", (await t3.getByTestId("tramo-servicio-aereo").inputValue()) === "", "");
      await t3.getByTestId("tramo-servicio-aereo").selectOption({ label: "Servicio 2" });
      await c.page.getByRole("button", { name: "Guardar vuelo" }).click();
      const ok = await c.page.getByText("Vuelo guardado.").waitFor({ timeout: 30000 }).then(() => true, () => false);
      c.check("el editor guarda la asociación («Vuelo guardado.»)", ok, "");
      await c.espera(1500);
      const m2 = await generarVuelo(c, "DTM-5101");
      const v = vouchersVuelo(c, "DTM-5101");
      c.check("ahora genera 2 vouchers", /2 nuevo\(s\)/.test(m2) && v.length === 2, m2);
      const textos = [];
      for (const x of v) textos.push(await textoVoucher(c, x.token));
      const dos = textos.find((t) => /AV511/.test(t)) ?? "";
      const uno = textos.find((t) => /AV510/.test(t)) ?? "";
      c.check("el servicio 2 trae AV511 y AV512 juntos; el servicio 1 solo AV510", /AV512/.test(dos) && !/AV510/.test(dos) && /AV510/.test(uno) && !/AV511|AV512/.test(uno), "");
    },
  },
];
