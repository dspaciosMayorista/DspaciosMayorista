// #103 — calendario del hotel, actualización de tarifarios, solicitudes a proveedores, códigos de promoción y avisos de pago a proveedores.
// Derivado de docs/tecnico/owner-walkthrough-103.md (W1–W11, ensayado 49/49 en su propio entorno). Correo SOLO en captura local (Mailpit); la respuesta del proveedor es SIMULADA.
// El buzón real de Hostinger NO se verifica aquí. Contratos DTM-2001…2004, hotel 20301 y obligaciones 20301…20303 vienen de semillas/08_hotel_103.sql.
import { cargarConfig, responder, pdfSintetico } from "../responder_proveedor.mjs";

const CFG = cargarConfig();
const CORREO = `http://127.0.0.1:${CFG.puertos.correo}`;
const HOTEL = "/dashboard/producto/hoteles/20301";
const HOTEL_TEMP = `${HOTEL}?tab=temporadas`;
const DEUDA = "select count(*) from public.armado_paquetes where id in (20301, 20302) and tarifario_revision_fuente > coalesce(tarifario_revision_publicada, 0)";

// ── correo capturado (Mailpit) ──
const mensajes = async () => (await (await fetch(`${CORREO}/api/v1/messages?limit=500`)).json()).messages ?? [];
const para = (ms, dir) => ms.filter((m) => (m.To ?? []).some((x) => x.Address === dir));
const detalle = async (id) => (await fetch(`${CORREO}/api/v1/message/${id}`)).json();
const nuevosPara = async (dir, antes) => (await para(await mensajes(), dir)).length - antes;
const conteoPara = async (dir) => para(await mensajes(), dir).length;

// ── pantalla ──
const panel = (p) => p.locator('[data-testid="solicitudes-proveedor"]').innerText().catch(() => "");
const boton = (p, re) => p.getByRole("button", { name: re }).first();
const editarFila = (p, nombre) => p.evaluate((n) => { const fila = [...document.querySelectorAll("*")].find((e) => e.children.length < 8 && new RegExp("^" + n).test((e.textContent || "").trim()) && e.querySelector("button")); const btn = fila && [...fila.querySelectorAll("button")].find((x) => /Editar/.test(x.textContent)); if (!btn) return false; btn.click(); return true; }, nombre);
const marcadas = (p) => p.evaluate(() => [...document.querySelectorAll('[role="gridcell"]')].filter((x) => x.getAttribute("aria-pressed") === "true").length);
const mesCalendario = (p, mes, anio) => p.evaluate(([m, a]) => { const s = document.querySelector('select[aria-label="Mes"]'); if (!s) return false; const i = [...s.options].findIndex((o) => new RegExp(m, "i").test(o.textContent) && new RegExp(String(a)).test(o.textContent)); if (i < 0) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, String(i)); s.dispatchEvent(new Event("change", { bubbles: true })); return true; }, [mes, anio]);
const etiquetaDia = (p, dia, mes) => p.evaluate(([d, m]) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((x) => new RegExp(`(^|\\D)${d}\\D.*${m}`, "i").test(x.getAttribute("aria-label") || "") && !x.disabled); return c ? c.getAttribute("aria-label") : null; }, [dia, mes]);
const celda = (p, etiqueta) => p.locator(`[role="gridcell"][aria-label="${etiqueta}"]`);
const desborde = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const escribirFecha = async (p, etiqueta, valor) => { const i = p.locator(`input[aria-label="${etiqueta}"]`).first(); await i.fill(valor); await i.press("Tab"); };
const sinAviso = (p, ms = 90000) => p.waitForSelector('[data-testid="estado-tarifarios"]', { state: "detached", timeout: ms }).then(() => true, () => false);
const abrirSolicitudes = async (c, numero) => { await c.ir(`/dashboard/contratos/${numero}`); await c.espera(1500); await c.page.locator('[data-testid="solicitudes-proveedor"]').scrollIntoViewIfNeeded().catch(() => {}); };
const previsualizar = async (c) => { await boton(c.page, /^\s*Vista previa/).click(); await c.espera(3500); };
const elegirCodigo = async (c, re) => { await c.page.locator('[data-testid="codigo-promocion"] label', { hasText: re }).first().locator("input").click(); await c.espera(2500); };
const casilla = async (c, re, valor) => { const i = c.page.locator('[data-testid="estancias-solicitud"] label', { hasText: re }).first().locator("input"); if ((await i.isChecked()) !== valor) await i.click(); await c.espera(400); };
const srcdocSolicitud = (p) => p.locator('[data-testid="vista-previa-solicitud"] iframe').getAttribute("srcdoc").catch(() => "");
const enviarSolicitud = async (c) => { const b = boton(c.page, /Enviar solicitud/); if (!(await b.isEnabled())) return false; await b.click(); await c.espera(4500); return true; };

export const pasos = [
  {
    id: "H103-01", entrega: "hotel103", rol: "administracion", titulo: "Una actualización de tarifarios que quedó a medias se termina sola", ruta: HOTEL_TEMP,
    accion: "1. Abre la pestaña «Temporadas, promociones y calculadora» del hotel «Hotel Prueba 103» (enlace del paso).\n2. NO hagas clic en nada y observa la parte de arriba de la página hasta un minuto.\n3. Recarga la página.",
    esperado: "Arriba aparece un aviso ámbar sobre paquetes sin actualizar («Quedaron 2 paquetes sin actualizar…» o «Completando la actualización de tarifarios automáticamente…»). Desaparece solo en cerca de un minuto, sin que pulses nada. Al recargar ya no hay aviso. Esa deuda de ejemplo se consume la primera vez: si ya abriste esta página antes de este paso, el aviso puede no aparecer (no es un error). Los 2 paquetes de ejemplo quedan al día.",
    async verificar(c) {
      c.sql("update public.armado_paquetes set tarifario_revision_fuente = 4, tarifario_revision_publicada = 1, tarifario_estado = 'pendiente' where id in (20301, 20302)");
      c.sql("insert into public.tarifario_cambio_fuente (paquete_id, revision, alcance, motivo, creado_en) select p, 4, 'aditivo', 'revision', now() - interval '20 minutes' from unnest(array[20301, 20302]) p where not exists (select 1 from public.tarifario_cambio_fuente where paquete_id = p)");
      c.sql("update public.tarifario_cambio_fuente set creado_en = now() - interval '20 minutes' where paquete_id in (20301, 20302)");
      await c.page.goto(`${c.APP}${HOTEL_TEMP}`, { waitUntil: "commit" });
      const visto = await c.page.waitForSelector('[data-testid="estado-tarifarios"]', { timeout: 20000, state: "attached" }).then(() => true, () => false);
      const primera = visto ? await c.page.locator('[data-testid="estado-tarifarios"]').innerText() : "(sin aviso)";
      c.check("con deuda pendiente aparece el aviso de actualización", visto, primera);
      const t0 = Date.now(), solo = await sinAviso(c.page);
      c.check("sin ningún clic, el aviso desaparece solo y la deuda queda en 0", solo && c.sql(DEUDA) === "0", `${Math.round((Date.now() - t0) / 1000)} s`);
      await c.ir(HOTEL_TEMP); await c.espera(2000);
      c.check("tras recargar no hay aviso de actualización", !/Quedaron \d+ paquete|Actualizando los tarifarios|Completando/.test(await c.texto()));
    },
  },
  {
    id: "H103-02", entrega: "hotel103", rol: "administracion", titulo: "Códigos de promoción del hotel (exigidos y faltantes)", ruta: HOTEL_TEMP, solo_lectura: true,
    accion: "En la misma pestaña «Temporadas, promociones y calculadora» baja hasta la sección de códigos de promoción.",
    esperado: "«Promo Semana Santa» muestra el código SS-2027-X con la nota «Pedir en el asunto». «Promo sin digitar» exige código y muestra el aviso ámbar «Exige código pero no se ha digitado». Un código vive en la promoción de ese hotel, no en el contrato del cliente.",
    async verificar(c) {
      await c.ir(HOTEL_TEMP); await c.espera(1500);
      const t = await c.texto(), valores = await c.page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).join(" | "));
      c.check("la sección de códigos existe y muestra el código SS-2027-X", /SS-2027-X/.test(valores), valores.slice(0, 200));
      c.check("la nota «Pedir en el asunto» está", /Pedir en el asunto/.test(valores));
      c.check("la promoción sin código se marca «Exige código pero no se ha digitado»", /Exige código pero no se ha digitado/.test(t));
    },
  },
  {
    id: "H103-03", entrega: "hotel103", rol: "administracion", titulo: "Noches excluidas de una vigencia: lista compacta de siempre + calendario en una ventana (no es un cierre del hotel)", ruta: HOTEL_TEMP,
    accion: "1. En la lista de vigencias pulsa «Editar» en «ALTA».\n2. Mira el bloque «Black-outs (fechas a excluir)»: es la lista compacta de rangos (Desde / Hasta / Quitar) de siempre; ahí mismo hay un botón «Elegir fechas en el calendario».\n3. Pulsa ese botón: se abre una ventana «Noches excluidas». En el selector de mes elige «diciembre» de 2026. Haz clic en el 26 y luego, con la tecla Mayús (Shift) pulsada, clic en el 28: se marcan 3 noches seguidas (un rango). Pulsa «Quitar todas (3)».\n4. Haz clic en el 30 y en el 31 de diciembre de 2026 y pulsa «Aplicar a la lista». La ventana se cierra y la lista compacta muestra un rango 30/12/2026 → 31/12/2026.\n5. (Prueba de cancelar) Vuelve a abrir el calendario, haz clic en el 29 de diciembre y pulsa «Cancelar»: la lista no cambia.\n6. Pulsa «Guardar cambios». Mide a ojo cuánto tarda: la pantalla debe quedar libre de inmediato aunque abajo se actualicen los tarifarios.\n7. Pulsa «Editar» en «ALTA» otra vez, abre el calendario y mira diciembre de 2026.",
    esperado: "Antes: el calendario ocupaba la vigencia entera y la lista de rangos estaba escondida. Ahora la lista compacta es lo primero que ves y el calendario es una ayuda en una ventana (Escape o «Cancelar» la cierra sin cambiar nada; «Aplicar a la lista» pasa lo elegido a la lista, aún sin guardar). El texto aclara que estas noches «Solo afectan a esta vigencia: no cierran el hotel» y que para cerrar el hotel entero se usa «Black out general». Dentro de la ventana: clic = una noche; Mayús + clic = un rango. Tras guardar (en pocos segundos), al reabrir siguen excluidas exactamente el 30 y el 31 de diciembre de 2026. Las exclusiones de la vigencia y el cierre general «Mantenimiento Walk» son cosas distintas: guardar aquí no cambia la lista de cierres generales. Un aviso breve de actualización de tarifarios puede aparecer y se limpia solo.",
    async verificar(c) {
      const p = c.page, cierres = c.sql("select count(*) from public.hotel_blackouts where hotel_id = 20301");
      await c.ir(HOTEL_TEMP);
      c.check("«Editar» en ALTA muestra la lista compacta de black-outs", (await editarFila(p, "ALTA")) && await p.getByText("Black-outs (fechas a excluir)").first().waitFor({ timeout: 8000 }).then(() => true, () => false));
      c.check("el calendario NO está desplegado de entrada (solo el botón para abrirlo)", (await p.locator('[role="grid"]').count()) === 0 && (await p.locator('[data-testid="abrir-calendario-exclusiones"]').count()) === 1);
      const t = await c.texto();
      c.check("explica que las exclusiones no cierran el hotel y remite a «Black out general»", /Solo afectan a esta vigencia: no cierran el hotel/.test(t) && /Black out general/.test(t));
      await p.locator('[data-testid="abrir-calendario-exclusiones"]').click(); await c.espera(400);
      c.check("el botón abre una ventana (diálogo) con el calendario", await p.locator('[role="dialog"] [role="grid"]').waitFor({ timeout: 8000 }).then(() => true, () => false));
      c.check("explica clic y Mayús + clic", /Mayús \+ clic = un rango/.test(await c.texto()));
      c.check("el selector de mes permite ir a diciembre de 2026", await mesCalendario(p, "diciembre", 2026));
      await c.espera(300);
      const l26 = await etiquetaDia(p, 26, "diciembre"), l28 = await etiquetaDia(p, 28, "diciembre");
      await celda(p, l26).click(); await celda(p, l28).click({ modifiers: ["Shift"] }); await c.espera(300);
      c.check("Mayús + clic marca un rango de 3 noches (26–28 dic)", (await marcadas(p)) === 3, `marcadas=${await marcadas(p)}`);
      await boton(p, /Quitar todas/).click(); await c.espera(300);
      c.check("«Quitar todas» deja 0 noches excluidas", (await marcadas(p)) === 0);
      const l30 = await etiquetaDia(p, 30, "diciembre"), l31 = await etiquetaDia(p, 31, "diciembre");
      await celda(p, l30).click(); await celda(p, l31).click(); await c.espera(300);
      c.check("clic en 30 y 31 de diciembre las marca como excluidas", (await marcadas(p)) === 2, `${l30} | ${l31}`);
      await boton(p, /^Aplicar a la lista$/).click(); await p.locator('[role="dialog"]:visible').waitFor({ state: "hidden", timeout: 8000 }).catch(() => {}); await c.espera(400);   // espera real al cierre (con la máquina cargada 400 ms no alcanzaba)
      c.check("«Aplicar a la lista» cierra la ventana y la lista compacta muestra el rango", (await p.locator('[role="dialog"]:visible').count()) === 0 && /Elegir fechas en el calendario \(2 noches\)/.test(await c.texto()), `dialogos=${await p.locator('[role="dialog"]').count()} [${(await p.locator('[role="dialog"]').allInnerTexts()).join(' // ').replace(/s+/g, ' ').slice(0, 160)}] · ${((await c.texto()).match(/Elegir fechas en el calendario[^.]{0,40}/) ?? ["sin texto de rango"])[0]}`);
      await p.locator('[data-testid="abrir-calendario-exclusiones"]').click(); await c.espera(400); await mesCalendario(p, "diciembre", 2026);
      await celda(p, await etiquetaDia(p, 29, "diciembre")).click(); await c.espera(200);
      await boton(p, /^Cancelar$/).click(); await c.espera(300);
      c.check("«Cancelar» descarta lo elegido en la ventana (la lista sigue con 2 noches)", /Elegir fechas en el calendario \(2 noches\)/.test(await c.texto()));
      const t0 = Date.now(); await boton(p, /Guardar cambios/).click();
      let ms = null; for (let i = 0; i < 60; i++) { if (/2026-12-30/.test(c.sql("select blackouts::text from public.hotel_temporadas where id = 20301"))) { ms = Date.now() - t0; break; } await c.espera(250); }
      c.check("guardar responde sin esperar a regenerar paquetes (persistido en menos de 8 s)", ms !== null && ms < 8000, `${ms} ms`);
      const bl = c.sql("select blackouts::text from public.hotel_temporadas where id = 20301");
      c.check("quedan guardadas solo las noches 30 y 31 de diciembre de 2026", /2026-12-30/.test(bl) && /2026-12-31/.test(bl) && !/2026-12-2[6789]/.test(bl), bl);
      c.check("el aviso de actualización (si salió) se limpia solo y la deuda es 0", (await sinAviso(p)) && c.sql(DEUDA) === "0");
      c.check("las exclusiones de la vigencia no tocaron los cierres generales del hotel", c.sql("select count(*) from public.hotel_blackouts where hotel_id = 20301") === cierres, `antes=${cierres}`);
      await c.ir(HOTEL_TEMP); await editarFila(p, "ALTA"); await c.espera(800);
      await p.locator('[data-testid="abrir-calendario-exclusiones"]').click(); await c.espera(400); await mesCalendario(p, "diciembre", 2026); await c.espera(300);
      c.check("al reabrir siguen excluidas las 2 noches", (await marcadas(p)) === 2, String(await marcadas(p)));
    },
  },
  {
    id: "H103-04", entrega: "hotel103", rol: "administracion", titulo: "Conjunto de fechas reutilizable: COPIA noches a la vigencia que editas; no crea ni enlaza vigencias", ruta: HOTEL_TEMP,
    accion: "1. Pulsa «Editar» en «Promo Semana Santa», abre «Elegir fechas en el calendario» y baja hasta «Conjuntos de fechas guardados».\n2. Lee «Vigencia en edición: Promo Semana Santa» y el párrafo que explica qué hace un conjunto.\n3. Elige «Semana Santa Walk · 2027 · 4 noches» y pulsa «Copiar fechas a esta vigencia». Pulsa «Aplicar a la lista» y luego «Guardar cambios».\n4. (Lo comprueba el ensayo automático, tú ves la frase en pantalla) editar el conjunto después no cambia la vigencia donde ya lo copiaste.\n5. Pulsa «Cancelar» en la edición y, SIN editar ninguna vigencia, abre el formulario de vigencia nueva: la opción «Empezar una vigencia nueva con este conjunto» aparece en esa ventana y solo rellena el nombre y las noches del formulario; no guarda nada.",
    esperado: "Antes: el botón decía «Aplicar (copiar fechas)» y no quedaba claro a qué vigencia iban las fechas ni si se creaba una vigencia con el nombre del conjunto. Ahora la ventana nombra la vigencia que estás editando («nueva (sin guardar)» si todavía no existe) y dice que un conjunto es solo una lista de noches: NO es una vigencia; copiarlo agrega esas noches a las exclusiones de la vigencia en edición, no crea una vigencia nueva ni cambia otra ya guardada. El selector ofrece el conjunto con su año. Al copiar se marcan 4 noches (25 a 28 de marzo de 2027) dentro de «Promo Semana Santa», aún sin guardar. Guardado, esa vigencia lleva el 25 de marzo de 2027 entre sus exclusiones. Estas noches excluidas son de la vigencia; no son un cierre general del hotel. «Empezar una vigencia nueva con este conjunto» (solo con vigencia nueva) no crea nada: pone el nombre «Semana Santa Walk 2027» y las 4 noches en el formulario, que sigue sin guardar hasta que completes fechas y tarifas y pulses «Agregar temporada».",
    async verificar(c) {
      const p = c.page; await c.ir(HOTEL_TEMP);
      c.check("«Editar» en Promo Semana Santa abre el formulario", await editarFila(p, "Promo Semana Santa"));
      await c.espera(800);
      await p.locator('[data-testid="abrir-calendario-exclusiones"]').click(); await c.espera(500);
      const t1 = await c.texto();
      c.check("la ventana nombra la vigencia que se edita", /Vigencia en edición: Promo Semana Santa/.test(t1));
      c.check("la pantalla explica que un conjunto NO es una vigencia y que copiarlo COPIA sus noches sin crear vigencias", /no es una vigencia/.test(t1) && /COPIA sus noches a las exclusiones de la vigencia que estás editando/.test(t1) && /no crea una vigencia nueva ni cambia otra ya guardada/.test(t1));
      c.check("con una vigencia guardada en edición NO se ofrece «Empezar una vigencia nueva»", (await p.getByRole("button", { name: /Empezar una vigencia nueva con este conjunto/ }).count()) === 0);
      const valor = await p.evaluate(() => { const s = document.querySelector("#conjunto-elegido"); const o = [...(s?.options ?? [])].find((x) => /Semana Santa Walk/.test(x.textContent)); return o ? { v: o.value, t: o.textContent } : null; });
      c.check("el conjunto «Semana Santa Walk» (con año) se ofrece", !!valor, JSON.stringify(valor));
      await p.selectOption("#conjunto-elegido", valor.v); await boton(p, /Copiar fechas a esta vigencia/).click(); await c.espera(700);
      c.check("copiar agrega 4 noches a la vigencia que se edita (aún sin guardar)", (await marcadas(p)) === 4, String(await marcadas(p)));
      await boton(p, /^Aplicar a la lista$/).click(); await c.espera(400);
      await boton(p, /Guardar cambios/).click(); await c.espera(3500);
      const q = "select blackouts::text from public.hotel_temporadas where nombre = 'Promo Semana Santa' and hotel_id = 20301";
      c.check("guardado: el 25 de marzo de 2027 es una exclusión de la vigencia", /2027-03-25/.test(c.sql(q)), c.sql(q));
      c.sql(`update public.conjuntos_fechas set rangos = '[{"fecha_inicio":"2027-04-01","fecha_fin":"2027-04-02"}]' where nombre = 'Semana Santa Walk'`);
      c.check("editar el conjunto después NO cambia la vigencia (copia, no enlace)", !/2027-04-01/.test(c.sql(q)));
      c.sql(`update public.conjuntos_fechas set rangos = '[{"fecha_inicio":"2027-03-25","fecha_fin":"2027-03-28"}]' where nombre = 'Semana Santa Walk'`);
      await sinAviso(p, 60000);
      await c.ir(HOTEL_TEMP); await c.espera(1500);
      await p.locator('[data-testid="abrir-calendario-exclusiones"]').click(); await c.espera(500);
      const nueva = boton(p, /Empezar una vigencia nueva con este conjunto/);
      c.check("en el formulario de vigencia NUEVA sí se ofrece «Empezar una vigencia nueva con este conjunto»", (await nueva.count()) > 0);
      const antes = c.sql("select count(*) from public.hotel_temporadas where hotel_id = 20301");
      await p.selectOption("#conjunto-elegido", valor.v); await nueva.click(); await c.espera(500);
      const campos = await p.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).join("|"));
      c.check("solo rellena el formulario (nombre del conjunto) y no crea ninguna vigencia", /Semana Santa Walk 2027/.test(campos) && c.sql("select count(*) from public.hotel_temporadas where hotel_id = 20301") === antes, campos.slice(0, 120));
    },
  },
  {
    id: "H103-05", entrega: "hotel103", rol: "administracion", titulo: "Black out general: guardar y borrar al instante; un fallo no se esconde", ruta: HOTEL,
    accion: "1. Abre la página del hotel (pestaña «Configuración») y despliega «Black out general (1)». Aparece «Mantenimiento Walk» (2027-02-10 → 2027-02-12).\n2. Agrega un cierre: Desde 01/06/2027, Hasta 02/06/2027, Motivo «Cierre de prueba revision», cierre total, «Agregar cierre». Debe aparecer en la lista enseguida.\n3. (Opcional, prueba de fallo) Abre las herramientas del navegador (F12) > pestaña «Red» > «Sin conexión» y pulsa «Eliminar» en el cierre nuevo. Vuelve a poner «Sin conexión» en «Sin limitación».\n4. Con red normal, pulsa «Eliminar» en el cierre nuevo y luego en «Mantenimiento Walk». No recargues.",
    esperado: "El cierre nuevo aparece en la lista al instante y puede mostrar «Cierre guardado. Los tarifarios se están actualizando en segundo plano.». Sin conexión, «Eliminar» NO borra la fila: queda visible con un mensaje de error rojo («No se pudo eliminar el cierre. Intenta de nuevo.»). Con red, cada fila desaparece de inmediato tras confirmarse el borrado, sin recargar la página, y al recargar sigue sin existir. El hotel queda sin cierres generales. (Los cierres generales cierran la venta de todo el hotel; son distintos de las exclusiones de una vigencia del paso anterior.)",
    async verificar(c) {
      const p = c.page; await c.ir(HOTEL);
      await boton(p, /Black out general/).click(); await c.espera(600);
      c.check("«Mantenimiento Walk» está en la lista", /Mantenimiento Walk/.test(await c.texto()));
      await p.evaluate(() => { window.__sinRecarga = true; });
      await escribirFecha(p, "Desde (noche)", "01/06/2027"); await escribirFecha(p, "Hasta (noche)", "02/06/2027");
      await p.getByPlaceholder(/Sin disponibilidad/).fill("Cierre de prueba revision");
      const t0 = Date.now(); await boton(p, /Agregar cierre/).click();
      const aparece = await p.getByText("Cierre de prueba revision").first().waitFor({ timeout: 8000 }).then(() => true, () => false);
      c.check("el cierre nuevo aparece en la lista enseguida", aparece && Date.now() - t0 < 6000, `${Date.now() - t0} ms`);
      c.check("el cierre quedó en la base", c.sql("select count(*) from public.hotel_blackouts where hotel_id = 20301 and motivo = 'Cierre de prueba revision'") === "1");
      const fila = (txt) => p.locator("li", { hasText: txt }).first();
      await p.context().setOffline(true);
      try {
        await fila("Cierre de prueba revision").getByRole("button", { name: /Eliminar/ }).click();
        const err = await p.locator('[role="alert"]', { hasText: /No se pudo eliminar el cierre/ }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
        c.check("sin conexión: aparece el error y la fila SIGUE visible", err && (await fila("Cierre de prueba revision").count()) === 1);
      } finally { await p.context().setOffline(false); }
      await c.espera(500);
      const t1 = Date.now(); await fila("Cierre de prueba revision").getByRole("button", { name: /Eliminar/ }).click();
      const salio = await fila("Cierre de prueba revision").waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false);
      c.check("con red: la fila sale de inmediato, sin recargar la página", salio && Date.now() - t1 < 5000 && (await p.evaluate(() => window.__sinRecarga === true)), `${Date.now() - t1} ms`);
      await fila("Mantenimiento Walk").getByRole("button", { name: /Eliminar/ }).click();
      const salio2 = await fila("Mantenimiento Walk").waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false);
      await c.espera(1500);
      c.check("«Mantenimiento Walk» también desaparece al instante y la base ya no lo tiene", salio2 && c.sql("select count(*) from public.hotel_blackouts where hotel_id = 20301") === "0");
      await c.ir(HOTEL); await boton(p, /Black out general/).click(); await c.espera(500);
      c.check("tras recargar siguen sin existir (0 cierres)", /Black out general \(0\)/.test(await c.texto()));
    },
  },
  {
    id: "H103-06", entrega: "hotel103", rol: "administracion", titulo: "Solicitud al proveedor con código de promoción (correo en captura local)", ruta: "/dashboard/contratos/DTM-2001",
    accion: "1. Abre el contrato DTM-2001, baja a «Solicitudes a proveedores por correo». Debe decir «Modo de captura local: el correo NO sale de esta máquina.»\n2. Proveedor «Hotel Prueba 103»; Correo(s) del proveedor «reservas@walk.test»; pulsa «Vista previa».\n3. La vista pide «Código de promoción exigido por el hotel»: «Enviar solicitud» sigue deshabilitado. Elige «Promo Semana Santa» (SS-2027-X).\n4. Pulsa «Enviar solicitud» y púlsalo otra vez.\n5. Abre la bandeja de correos de prueba http://127.0.0.1:" + CFG.puertos.correo + " (nada sale del computador).\n6. (Opcional) Proveedor «Receptivo 103», correo «tours@walk.test», «Vista previa».\nNo se prueba aquí el buzón real de Hostinger: el correo solo llega a la bandeja local de pruebas.",
    esperado: "Se envía UNA sola solicitud (la segunda pulsación no envía otra). El historial muestra «Enviada» con «Código SS-2027-X». La bandeja local tiene exactamente un mensaje a reservas@walk.test, con una tabla HTML y una versión en texto plano que traen el código SS-2027-X, el titular, la estancia elegida y los tres viajeros (Ana Walk, Luis Walk, Sofía Walk) con su edad; sin precios, sin costos y sin vouchers del cliente adjuntos ni sustituidos. La dirección de respuesta tiene la forma respuestas+<token largo>@consolidada.test. Con «Receptivo 103» se lista el «Traslado aeropuerto - hotel» y no hay sección de código.",
    async verificar(c) {
      const p = c.page, antes = await conteoPara("reservas@walk.test");
      await abrirSolicitudes(c, "DTM-2001");
      const t = await c.texto();
      c.check("la sección y el aviso de captura local están", /Solicitudes a proveedores por correo/.test(t) && /NO sale de esta máquina/.test(t));
      await p.selectOption("#sp-proveedor", "Hotel Prueba 103"); await p.locator("#sp-correos").fill("reservas@walk.test");
      await previsualizar(c);
      const pv = await panel(p);
      c.check("la vista previa exige elegir el código («Código de promoción exigido por el hotel»)", /Código de promoción exigido por el hotel/.test(pv) && /Promo Semana Santa/.test(pv) && /SS-2027-X/.test(pv), pv.slice(0, 300));
      c.check("«Enviar solicitud» está deshabilitado hasta elegir el código", !(await boton(p, /Enviar solicitud/).isEnabled()));
      await elegirCodigo(c, /Semana Santa/);
      c.check("al elegir el código se habilita el envío y la vista lo muestra", /SS-2027-X/.test(await srcdocSolicitud(p)) && (await boton(p, /Enviar solicitud/).isEnabled()));
      await enviarSolicitud(c);
      c.check("llegó exactamente UN mensaje a la bandeja local", (await nuevosPara("reservas@walk.test", antes)) === 1);
      const m = (await para(await mensajes(), "reservas@walk.test"))[0];
      if (m) {
        const d = await detalle(m.ID), cuerpo = (d.HTML ?? "") + "\n" + (d.Text ?? "");
        c.check("trae tabla HTML y texto plano con el código SS-2027-X", /<table/.test(d.HTML ?? "") && /SS-2027-X/.test(d.HTML ?? "") && /SS-2027-X/.test(d.Text ?? ""));
        c.check("nombra el titular y los 3 viajeros", /Cliente Walkthrough/.test(cuerpo) && /Ana Walk/.test(d.Text ?? "") && /Luis Walk/.test(d.Text ?? "") && /Sofía Walk/.test(d.Text ?? ""));
        c.check("incluye la edad de los viajeros (Ana Walk, 41)", /Ana Walk[^\n]{0,60}41/.test(d.Text ?? ""), (d.Text ?? "").slice(0, 400));
        c.check("sin precios ni costos", !/precio|costo|3\.?000\.?000/i.test(cuerpo));
        c.check("sin adjuntos ni voucher del cliente sustituyendo la solicitud", (d.Attachments ?? []).length === 0 && !/voucher/i.test(cuerpo));
        c.check("la dirección de respuesta lleva el token", (d.ReplyTo ?? []).some((r) => /^respuestas\+[A-Za-z0-9_-]{16,}@consolidada\.test$/.test(r.Address)), JSON.stringify(d.ReplyTo));
      } else c.check("el mensaje existe en la bandeja", false, "sin mensaje");
      if (await boton(p, /Enviar solicitud/).isEnabled()) { await boton(p, /Enviar solicitud/).click(); await c.espera(2000); }
      c.check("la segunda pulsación no envía otro mensaje", (await nuevosPara("reservas@walk.test", antes)) === 1);
      const h = await panel(p);
      c.check("el historial muestra «Enviada» con «Código SS-2027-X»", /Enviada/.test(h) && /Código SS-2027-X/.test(h), h.slice(-250));
      c.check("la solicitud guardó contrato, código y proveedor", c.sql("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-2001' and tipo = 'solicitud' and codigo_texto = 'SS-2027-X'") === "1");
      await p.selectOption("#sp-proveedor", "Receptivo 103"); await p.locator("#sp-correos").fill("tours@walk.test"); await previsualizar(c);
      const sd = await srcdocSolicitud(p);
      c.check("(opcional) un proveedor de servicios lista el traslado y no pide código", /Traslado aeropuerto/.test(sd) && !/Código de promoción/.test(sd));
    },
  },
  {
    id: "H103-07", entrega: "hotel103", rol: "administracion", titulo: "Dos estancias del mismo proveedor: una solicitud por hotel, cada una con su código", ruta: "/dashboard/contratos/DTM-2004",
    accion: "1. Abre DTM-2004. En «Solicitudes a proveedores por correo»: Proveedor «Hotel Prueba 103», Correo(s) «reservas@hotel.test». El bloque «Estancias de esta solicitud» lista «Hotel Prueba 103» y «Otro Hotel 103».\n2. Con ambas marcadas pulsa «Vista previa».\n3. Desmarca «Otro Hotel 103», «Vista previa», elige «Promo Semana Santa» (SS-2027-X) y «Enviar solicitud».\n4. Marca «Otro Hotel 103», desmarca «Hotel Prueba 103», «Vista previa», elige «Promo Otro Hotel» (OTRO-CODE) y «Enviar solicitud».\n5. Mira la bandeja local de pruebas.",
    esperado: "Con las dos estancias marcadas la vista previa se bloquea con un mensaje claro: una solicitud lleva un solo código, envía un hotel por solicitud. Después hay DOS mensajes a reservas@hotel.test: uno con SS-2027-X y solo la primera estancia, otro con OTRO-CODE y solo la segunda; ningún mensaje trae los dos códigos. El historial muestra dos solicitudes.",
    async verificar(c) {
      const p = c.page, antes = await conteoPara("reservas@hotel.test");
      await abrirSolicitudes(c, "DTM-2004");
      await p.selectOption("#sp-proveedor", "Hotel Prueba 103"); await c.espera(600); await p.locator("#sp-correos").fill("reservas@hotel.test"); await c.espera(300);
      const t = await panel(p);
      c.check("«Estancias de esta solicitud» lista los dos hoteles", /Estancias de esta solicitud/.test(t) && /Otro Hotel 103/.test(t) && /Hotel Prueba 103/.test(t), t.slice(0, 200));
      await previsualizar(c);
      c.check("con ambas estancias la vista previa se bloquea explicando una solicitud por hotel", /una solicitud lleva un solo código|selecciona el hotel|solicitud aparte/.test(await panel(p)), (await panel(p)).slice(0, 300));
      await casilla(c, /Otro Hotel 103/, false); await previsualizar(c); await elegirCodigo(c, /Semana Santa/);
      c.check("la estancia A se previsualiza con SS-2027-X y sin nada del hotel B", /SS-2027-X/.test(await srcdocSolicitud(p)) && !/OTRO-CODE|Otro Hotel 103/.test(await srcdocSolicitud(p)));
      c.check("se envía la estancia A", (await enviarSolicitud(c)) && /Solicitud enviada/.test(await panel(p)));
      await casilla(c, /Hotel Prueba 103/, false); await casilla(c, /Otro Hotel 103/, true); await previsualizar(c); await elegirCodigo(c, /Otro Hotel/);
      c.check("se envía la estancia B con su propio código", (await enviarSolicitud(c)) && /Solicitud enviada/.test(await panel(p)));
      const ms = await para(await mensajes(), "reservas@hotel.test"), det = []; for (const m of ms.slice(0, 2)) det.push(await detalle(m.ID));
      const a = det.filter((d) => /SS-2027-X/.test(d.HTML ?? "")), b = det.filter((d) => /OTRO-CODE/.test(d.HTML ?? ""));
      c.check("dos mensajes nuevos: uno con SS-2027-X y otro con OTRO-CODE, ninguno con ambos", (await nuevosPara("reservas@hotel.test", antes)) === 2 && a.length === 1 && b.length === 1 && a[0] !== b[0] && !/OTRO-CODE/.test(a[0].HTML) && !/SS-2027-X/.test(b[0].HTML));
      c.check("el mensaje del código A no menciona la otra estancia", a[0] ? !/Otro Hotel 103/.test((a[0].HTML ?? "") + (a[0].Text ?? "")) : false);
      c.check("el historial guarda dos solicitudes del contrato", Number(c.sql("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-2004' and tipo = 'solicitud'")) === 2);
    },
  },
  {
    id: "H103-08", entrega: "hotel103", rol: "administracion", titulo: "La respuesta del proveedor avisa, pero NO confirma nada (respuesta simulada)", ruta: "/dashboard/contratos/DTM-2001",
    accion: "1. En una terminal, desde la carpeta dspacios-travel de la revisión, juega la respuesta simulada del proveedor:\n   node supabase/scripts/revision_consolidada/responder_proveedor.mjs DTM-2001 \"Confirmamos disponibilidad con el código.\"\n   (deja un mensaje en un buzón SIMULADO y llama a la ruta de entrada real de la app; no usa el correo real de Hostinger).\n2. Recarga el contrato DTM-2001 y mira «Solicitudes a proveedores por correo».\n3. Pulsa «marcar leídas».\n4. Mira la bandeja local de pruebas.",
    esperado: "La solicitud pasa a «Respondió» y muestra el texto de la respuesta; sale el botón «1 respuesta(s) nueva(s) · marcar leídas». NO aparece «Confirmada por el proveedor»: una respuesta nunca confirma ni rechaza por sí sola, aunque el texto diga «Confirmamos». «Decisión registrada» sigue en «—» y el contrato sigue «pendiente». Al pulsar «marcar leídas» el contador desaparece (solo para este contrato). En la bandeja local llega un aviso interno «Respuesta del proveedor · …» para interno@consolidada.test. La lectura automática del buzón real de Hostinger NO está verificada aquí.",
    async verificar(c) {
      const p = c.page, antes = (await mensajes()).filter((m) => /Respuesta del proveedor/.test(m.Subject ?? "")).length;
      const r = await responder("DTM-2001", "Confirmamos disponibilidad con el código.", c.sql);
      c.check("la entrada simulada responde 200/202 y registra 1 respuesta nueva", [200, 202].includes(r.status) && Number(r.nuevos) === 1, JSON.stringify(r));
      await abrirSolicitudes(c, "DTM-2001"); const t = await panel(p);
      c.check("la tarjeta muestra «Respondió», el texto y «1 respuesta(s) nueva(s)»", /Respondió/.test(t) && /Confirmamos disponibilidad/.test(t) && /1 respuesta\(s\) nueva\(s\)/.test(t), t.slice(0, 400));
      c.check("NO aparece «Confirmada por el proveedor» ni «Rechazada por el proveedor»", !/Confirmada por el proveedor|Rechazada por el proveedor/.test(t));
      c.check("no hay decisión registrada y el contrato sigue pendiente", c.sql("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-2001' and tipo = 'solicitud' and confirmada_en is not null") === "0" && c.sql("select estado from public.ventas where numero_contrato = 'DTM-2001'") === "pendiente");
      await boton(p, /marcar leídas/).click(); await c.espera(2000);
      const sinLeer = c.sql("select count(*) from public.solicitud_proveedor_avisos a join public.solicitudes_proveedor s on s.id = a.solicitud_id where s.numero_contrato = 'DTM-2001' and a.leido_en is null and a.user_id = (select id from public.usuarios where email = 'administracion@consolidada.test')");
      await abrirSolicitudes(c, "DTM-2001"); const tp = await panel(p);
      c.check("«marcar leídas» limpia los avisos de este contrato", sinLeer === "0" && !/respuesta(s) nueva(s)/.test(tp), `sin leer en base: ${sinLeer}; panel: ${tp.slice(0, 200)}`);
      await c.espera(2000);
      const ms = (await mensajes()).filter((m) => /Respuesta del proveedor/.test(m.Subject ?? ""));
      c.check("llegó el aviso interno «Respuesta del proveedor · …» a interno@consolidada.test", ms.length > antes && ms.some((m) => (m.To ?? []).some((x) => x.Address === "interno@consolidada.test")));
    },
  },
  {
    id: "H103-09", entrega: "hotel103", rol: "administracion", titulo: "La confirmación del proveedor la registra una persona, de forma explícita", ruta: "/dashboard/contratos/DTM-2001",
    accion: "1. En la solicitud de DTM-2001 (ya con la respuesta del paso anterior) pulsa «Registrar: el proveedor confirmó».\n2. Mira la tarjeta, el estado del contrato y la bandeja local.",
    esperado: "Solo ahora la solicitud pasa a «Confirmada por el proveedor» y aparece una fecha en «Decisión registrada». Mensaje «Registrado: el proveedor confirmó el servicio.» El estado del contrato NO cambia por esto (sigue pendiente) y no se envía ningún correo nuevo al proveedor. Existe también «Registrar: el proveedor rechazó»; no se usa aquí. Respuesta y decisión son dos pasos separados.",
    async verificar(c) {
      const p = c.page, antes = await conteoPara("reservas@walk.test"); await abrirSolicitudes(c, "DTM-2001");
      c.check("antes de decidir hay botón de registro y no hay confirmación", (await boton(p, /Registrar: el proveedor confirmó/).count()) === 1 && !/Confirmada por el proveedor/.test(await panel(p)));
      await boton(p, /Registrar: el proveedor confirmó/).click(); await c.espera(3000);
      const t = await panel(p);
      c.check("la tarjeta pasa a «Confirmada por el proveedor» con fecha en «Decisión registrada»", /Confirmada por el proveedor/.test(t) && /Decisión registrada: \d/.test(t), t.slice(0, 300));
      c.check("el estado del contrato no cambia", c.sql("select estado from public.ventas where numero_contrato = 'DTM-2001'") === "pendiente");
      c.check("no se envió ningún correo nuevo al proveedor", (await nuevosPara("reservas@walk.test", antes)) === 0);
    },
  },
  {
    id: "H103-10", entrega: "hotel103", rol: "operaciones", titulo: "Aviso de pago a proveedores: pagos ya registrados, soporte y envío manual", ruta: "/dashboard/pagos/avisos",
    accion: "1. Abre «Aviso de pago a proveedores». Elige «Proveedor Pago 103».\n2. Verifica la lista de pagos (reserva, servicio, fecha, valor).\n3. Marca los cuatro pagos. En «Subir soporte de los pagos marcados» elige un archivo PDF, JPG o PNG de hasta 5 MB (el ensayo usa un PDF sintético: " + "crea uno con «node supabase/scripts/revision_consolidada/responder_proveedor.mjs --crear-soporte», queda en la carpeta de datos de la revisión) y pulsa «Guardar soporte». Nada se envía todavía.\n4. Marca el archivo adjunto junto a los pagos. «Referencia del pago (opcional)»: TRF-WALK-889. «Correo(s) del proveedor»: pagos@proveedor-walk.test. «Vista previa».\n5. Pulsa «Enviar aviso» y pulsa otra vez. Mira «Avisos enviados» y la bandeja local.",
    esperado: "Cuatro pagos: DTM-2001 COP 1.500.000 (parcial de una obligación de 4.000.000), DTM-2002 COP 2.500.000, DTM-2003 USD 100,00 (TRM 4000) y USD 50,00 (TRM 4100). Tras guardar el soporte: «Soporte guardado. Aún no se ha enviado nada»; tener pagos registrados y soportes nunca envía ni aprueba un correo por sí solo. La vista previa relaciona 3 reservas con su servicio, el parcial en columnas («Valor de este pago» COP 1.500.000, «Obligación total» COP 4.000.000, «Pagado acumulado» COP 1.500.000), las líneas USD con su TRM, totales SEPARADOS por moneda (COP 4.000.000; USD 150,00) y el nombre del archivo. Un solo envío con el PDF adjunto y el texto «AVISO DE PAGO»; la segunda pulsación no envía otro; el historial dice «Enviada», no confirmada ni conciliada, y pagos, asientos contables y conciliación bancaria no cambian.",
    async verificar(c) {
      const p = c.page, destino = "pagos@proveedor-walk.test", antes = await conteoPara(destino);
      const huella = () => c.sql("select md5(coalesce(string_agg(id || ':' || cuenta_por_pagar_id || ':' || valor || ':' || fecha || ':' || trm, ',' order by id), '')) || '|' || (select count(*) from public.asientos_contables) || '|' || (select count(*) from public.conciliacion_sistema) from public.cxp_pagos");
      const h0 = huella(), pdf = pdfSintetico();
      c.check("los pagos ya registrados existen sin ningún aviso de pago creado (registrar un pago no envía nada)", c.sql("select count(*) from public.solicitudes_proveedor where tipo = 'pago'") === "0", `correos previos al destino=${antes}`);
      await c.ir("/dashboard/pagos/avisos");
      c.check("la pantalla «Aviso de pago a proveedores» abre para operaciones", /Aviso de pago a proveedores/.test(await c.texto()));
      await p.selectOption("#av-proveedor", "Proveedor Pago 103"); await c.espera(2500);
      const t = await p.locator('[data-testid="pagos-aviso"]').innerText().catch(() => "");
      c.check("cuatro pagos: DTM-2001/2002/2003 con sus valores y TRM", /DTM-2001/.test(t) && /DTM-2002/.test(t) && /DTM-2003/.test(t) && /COP 1\.500\.000/.test(t) && /COP 2\.500\.000/.test(t) && /USD 100,00/.test(t) && /USD 50,00/.test(t), t.slice(0, 300));
      const incluir = p.locator('[data-testid="pagos-aviso"] input[aria-label^="Incluir"]');
      c.check("hay exactamente 4 casillas «Incluir el pago…»", (await incluir.count()) === 4);
      for (let i = 0; i < (await incluir.count()); i++) await incluir.nth(i).check();
      await p.setInputFiles('input[type="file"]', { name: "soporte-sintetico-103.pdf", mimeType: "application/pdf", buffer: pdf });
      await boton(p, /Guardar soporte/).click(); await c.espera(5000);
      c.check("guardar el soporte dice «Soporte guardado. Aún no se ha enviado nada»", /Soporte guardado\. Aún no se ha enviado nada/.test(await c.texto()));
      c.check("guardar el soporte no envió correo ni creó un aviso", (await nuevosPara(destino, antes)) === 0 && c.sql("select count(*) from public.solicitudes_proveedor where tipo = 'pago'") === "0");
      await p.locator('[data-testid="pagos-aviso"] input[type="checkbox"]:not([aria-label])').first().check().catch(() => {});
      await p.locator("#av-ref").fill("TRF-WALK-889"); await p.locator("#av-correos").fill(destino);
      await boton(p, /^\s*Vista previa/).click(); await c.espera(3500);
      const vp = await p.locator('[data-testid="vista-previa-pago"] iframe').getAttribute("srcdoc").catch(() => "") ?? "";
      const vpt = vp.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
      c.check("la vista previa muestra reservas, parcial acumulado, TRM y archivo", /DTM-2001/.test(vpt) && /DTM-2002/.test(vpt) && /DTM-2003/.test(vpt) && /DTM-2001[\s\S]*?COP 1\.500\.000[\s\S]*?COP 4\.000\.000[\s\S]*?COP 1\.500\.000/.test(vpt) && /TRM 4000/.test(vpt) && /TRM 4100/.test(vpt) && /\.pdf/.test(vp + vpt), vpt.slice(150, 1500));
      c.check("totales separados por moneda (COP 4.000.000 y USD 150,00)", /COP 4\.000\.000/.test(vpt) && /USD 150,00/.test(vpt), vpt.slice(-500));
      c.check("nada se envió con solo la vista previa", (await nuevosPara(destino, antes)) === 0);
      await boton(p, /Enviar aviso/).click(); await c.espera(5000);
      const ms = (await para(await mensajes(), destino)).slice(0, antes + 1);
      c.check("exactamente UN mensaje con el PDF adjunto del mismo tamaño y «AVISO DE PAGO»", (await nuevosPara(destino, antes)) === 1 && await (async () => { const d = await detalle(ms[0].ID), a = d.Attachments ?? []; return a.length === 1 && a[0].Size === pdf.length && /AVISO DE PAGO/.test(d.HTML ?? ""); })());
      if (await boton(p, /Enviar aviso/).isEnabled()) { await boton(p, /Enviar aviso/).click(); await c.espera(2500); }
      const tt = await c.texto();
      c.check("la segunda pulsación no envía otro y el historial dice «Enviada», no confirmada", (await nuevosPara(destino, antes)) === 1 && /Avisos enviados/.test(tt) && /Enviada/.test(tt) && !/Confirmada por el proveedor/.test(tt));
      const rel = c.sql("select string_agg(c.numero_contrato || ':' || c.servicio || ':' || (p.valor)::float8::text, '|' order by p.id) from public.solicitud_proveedor_pagos sp join public.cxp_pagos p on p.id = sp.cxp_pago_id join public.cuentas_por_pagar c on c.id = p.cuenta_por_pagar_id join public.solicitudes_proveedor s on s.id = sp.solicitud_id where s.tipo = 'pago'");
      c.check("la relación persistida es exacta: reserva, servicio y pago", rel === "DTM-2001:Hotel Prueba 103:1500000|DTM-2002:Traslados:2500000|DTM-2003:Tour Walk:100|DTM-2003:Tour Walk:50", rel);
      c.check("pagos, asientos contables y conciliación bancaria no cambiaron", huella() === h0);
    },
  },
  {
    id: "H103-11", entrega: "hotel103", rol: "venta", titulo: "Un asesor de ventas NO alcanza estas pantallas (acceso denegado)", ruta: "/dashboard/pagos/avisos", solo_lectura: true, desborde: false,
    accion: "Con la cuenta de venta intenta abrir: «Aviso de pago a proveedores» (/dashboard/pagos/avisos), la página del hotel (/dashboard/producto/hoteles/20301?tab=temporadas) y el contrato DTM-2001.",
    esperado: "El aviso de pago y la página del hotel se rechazan o redirigen (sin mostrar su contenido). En el contrato DTM-2001 NO existe la sección «Solicitudes a proveedores por correo» (un asesor no envía solicitudes a proveedores ni ve pagos a proveedores).",
    async verificar(c) {
      for (const [ruta, nombre] of [["/dashboard/pagos/avisos", "aviso de pago"], [HOTEL_TEMP, "página del hotel"]]) {
        await c.ir(ruta); const url = new URL(c.page.url()).pathname, t = await c.texto();
        c.check(`venta no usa: ${nombre}`, !url.startsWith(ruta.split("?")[0]) || /No tienes permisos|no tienes permiso|Sin acceso/i.test(t), `${url} · ${t.slice(0, 80)}`);
      }
      await c.ir("/dashboard/contratos/DTM-2001");
      c.check("en el contrato no existe «Solicitudes a proveedores por correo»", !/Solicitudes a proveedores por correo/.test(await c.texto()));
    },
  },
  {
    id: "H103-12", entrega: "hotel103", rol: "operaciones", titulo: "Ancho de teléfono (390 px): la página del hotel y el aviso de pago", ruta: HOTEL_TEMP, solo_lectura: true,
    accion: "Reduce la ventana del navegador a unos 390 px de ancho (o abre desde el celular) y recorre: la pestaña de temporadas del hotel y, después, «Aviso de pago a proveedores» con «Proveedor Pago 103» elegido.",
    esperado: "Ninguna de las dos páginas se desplaza de lado como un todo. En el aviso de pago, la tabla de pagos puede desplazarse de lado DENTRO de su tarjeta (hay que deslizar para ver valor y soportes): es aceptable, no está pulido.",
    async verificar(c) {
      const p = c.page; await c.ir(HOTEL_TEMP);
      c.check("la página del hotel no desborda en horizontal", (await desborde(p)) <= 1, String(await desborde(p)));
      await c.ir("/dashboard/pagos/avisos"); await p.selectOption("#av-proveedor", "Proveedor Pago 103"); await c.espera(2500);
      c.check("la página del aviso de pago no desborda en horizontal", (await desborde(p)) <= 1, String(await desborde(p)));
      const interno = await p.evaluate(() => { const t = document.querySelector('[data-testid="pagos-aviso"]'); const k = t?.parentElement; return k ? k.scrollWidth - k.clientWidth : -1; });
      if (c.ancho <= 400) c.check("a 390 px la tabla de pagos se desplaza dentro de su tarjeta", interno > 0, String(interno));
    },
  },
  {
    id: "H103-13b", entrega: "hotel103", rol: "administracion", titulo: "Mensaje de la solicitud al proveedor: qué se puede editar y qué no", ruta: "/dashboard/contratos/DTM-2001",
    accion: "Antes: el texto del correo a un proveedor («Les enviamos la solicitud de servicio de la reserva…», el asunto, las tablas) estaba escrito en el código; no había forma de cambiarlo desde la pantalla. Ahora hay un campo OPCIONAL por envío; las tablas, el código de promoción y el asunto siguen siendo automáticos.\n1. Abre el contrato DTM-2001, baja a «Solicitudes a proveedores por correo». Proveedor «Hotel Prueba 103»; Correo(s) «nota@walk.test».\n2. Pulsa «Vista previa» y elige el código «Promo Semana Santa» (igual que en el paso H103-06).\n3. En «Mensaje adicional para el proveedor (opcional)» escribe «Llegamos tarde: late check-in 22:00.» (puedes añadir una segunda línea). Mira que debajo aparece «El mensaje adicional cambió: genera de nuevo la vista previa» y «Enviar solicitud» se apaga.\n4. Pulsa «Vista previa» otra vez: tu nota aparece arriba de las tablas. Pulsa «Enviar solicitud».\n5. Revisa el correo en la bandeja local (nota@walk.test).",
    esperado: "El correo trae tu nota en un recuadro justo después de la frase inicial y ANTES de las tablas; el recuadro del código SS-2027-X, el proveedor, las tablas de alojamiento y pasajeros y la dirección de respuesta con token siguen igual que sin nota. Si no escribes nota, el correo es exactamente el de siempre. El campo acepta hasta 600 caracteres, solo texto (lo que escribas con símbolos < > no se interpreta como formato). Una respuesta del proveedor a este correo sigue siendo solo una respuesta: confirmar el servicio lo registra una persona, como antes. El aviso de pago a proveedores (Pagos → Avisos) tiene el mismo campo opcional.",
    async verificar(c) {
      const p = c.page, antes = await conteoPara("nota@walk.test");
      await abrirSolicitudes(c, "DTM-2001");
      await p.selectOption("#sp-proveedor", "Hotel Prueba 103"); await p.locator("#sp-correos").fill("nota@walk.test");
      await previsualizar(c); await elegirCodigo(c, /Semana Santa/);
      c.check("el campo del mensaje adicional existe, vacío, y dice que no reemplaza las tablas", (await p.locator("#sp-mensaje").inputValue()) === "" && /no las reemplaza/.test(await panel(p)));
      await p.locator("#sp-mensaje").fill("Llegamos tarde: late check-in 22:00.\nSegunda línea <b>x</b>"); await c.espera(400);
      c.check("al escribir la nota la vista previa queda desactualizada y el envío se apaga", !(await boton(p, /Enviar solicitud/).isEnabled()) && /genera de nuevo la vista previa/.test(await panel(p)));
      await previsualizar(c);
      c.check("la vista previa muestra la nota arriba de las tablas", /Llegamos tarde: late check-in 22:00/.test(await srcdocSolicitud(p)) && (await boton(p, /Enviar solicitud/).isEnabled()));
      await enviarSolicitud(c);
      c.check("llegó exactamente UN mensaje a la bandeja local", (await nuevosPara("nota@walk.test", antes)) === 1);
      const m = (await para(await mensajes(), "nota@walk.test"))[0];
      if (m) {
        const d = await detalle(m.ID), h = d.HTML ?? "";
        c.check("la nota va después de la frase inicial y antes de las tablas", h.indexOf("Les enviamos la solicitud") < h.indexOf("Llegamos tarde") && h.indexOf("Llegamos tarde") < h.indexOf("SOLICITUD DE SERVICIO"));
        c.check("lo escrito con < > no es formato (sale como texto)", /&lt;b&gt;x&lt;\/b&gt;/.test(h) && !/<b>x<\/b>/.test(h));
        c.check("el código SS-2027-X, el proveedor y las tablas siguen en el correo", /SS-2027-X/.test(h) && /Hotel Prueba 103/.test(h) && /Pasajeros/.test(h) && /Alojamiento/.test(h));
        c.check("la dirección de respuesta sigue llevando el token", (d.ReplyTo ?? []).some((r) => /^respuestas\+[A-Za-z0-9_-]{16,}@consolidada\.test$/.test(r.Address)), JSON.stringify(d.ReplyTo));
        c.check("el texto plano también lleva la nota", /Llegamos tarde: late check-in 22:00/.test(d.Text ?? ""));
      } else c.check("el mensaje existe en la bandeja", false, "sin mensaje");
    },
  },
  {
    id: "H103-13", entrega: "hotel103", rol: "superadmin", titulo: "Informativo: decisiones de correo que siguen ABIERTAS (no son pruebas)", ruta: "/dashboard/contratos/DTM-2001", solo_lectura: true, desborde: false,
    accion: "Lee esta lista. Nada se prueba aquí y ninguna se ha decidido. En esta revisión todo el correo sale a una bandeja local de pruebas y la respuesta del proveedor es simulada; el comportamiento del buzón real de Hostinger NO está verificado (si acepta direcciones respuestas+TOKEN@, qué contiene su notificación, límites de volumen).\nDecisiones pendientes tuyas: (1) remitente y dirección de respuesta (una dirección dedicada, nunca la bandeja de una persona); (2) cómo entran las respuestas (buzón Hostinger con notificación, Resend entrante, o marcar a mano); (3) quién recibe los avisos internos (hoy: quien envió la solicitud y operaciones de la agencia, más una lista interna opcional); (4) diseño y contenido de la solicitud al proveedor y el pago (campos, plantilla por proveedor, relación con el catálogo de hoteles y promociones: el hotel se empareja por nombre y lo confirma quien envía); (5) latencia del barrido diario (una respuesta perdida puede esperar hasta un día); (6) elegibilidad en la primera lectura del buzón (ignora respuestas de más de 72 horas); (7) ruta final de correo en producción y plan/costo de Resend; (8) si el aviso de pago seguirá siempre manual; (9) si quieres una plantilla de mensaje guardada por agencia con campos (hoy NO existe: el texto fijo vive en el código y lo único editable por envío es la nota opcional del paso H103-13b).",
    esperado: "En el contrato DTM-2001 la sección de solicitudes dice «Modo de captura local: el correo NO sale de esta máquina.» Ningún correo salió de este computador durante la revisión. Anota tus decisiones; hasta entonces el correo queda desactivado o en captura local, la entrada de Hostinger apagada y nada se envía en vivo.",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-2001"); const t = await c.texto();
      c.check("el contrato muestra el modo de captura local (nada sale del equipo)", /Modo de captura local: el correo NO sale de esta máquina/.test(t));
      c.check("la bandeja local de pruebas responde", (await fetch(`${CORREO}/api/v1/messages?limit=1`)).ok);
    },
  },
];
