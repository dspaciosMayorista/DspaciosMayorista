// #339 — Soportes de pago del aliado con cupo adicional: máximo de soportes vigentes = pagos registrados + 1 adicional. Un soporte es EVIDENCIA, nunca un pago.
// Datos: semilla 05 (contratos DTM-8301…8306 de la agencia aliada de la revisión —ficha 9409— en los estados de cupo; DTM-8399 de la freelance —ficha 8102—). Las subidas usan archivos pequeños fabricados en el paso.
// OBSERVACIÓN para el dueño (no es una regla implementada): hoy la lista del aliado incluye todos sus contratos propios, también los cancelados; decidir si los cancelados deben seguir apareciendo.
import { cargarConfig } from "../responder_proveedor.mjs";
const CORREO = `http://127.0.0.1:${cargarConfig().puertos.correo}`;   // Mailpit local (captura): nada sale de este equipo
const PDF = (n) => ({ name: `comprobante-${n}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n" + `comprobante sintetico ${n} `.repeat(30)) });
// PNG de 1x1 píxel (válido) para probar un archivo de otro tipo.
// PDF determinista: mismo (nombre aparte) + misma «marca» = mismos bytes = mismo SHA-256 (sirve para probar «el mismo archivo rechazado»).
const PDFN = (nombre, marca) => ({ name: `${nombre}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(["%PDF-1.4", `soporte sintetico ${marca} `.repeat(30)].join(String.fromCharCode(10))) });
const PNG = (nombre) => ({ name: nombre, mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
const SOPORTES = "/portal/b2b/cartera?vista=soportes";
const txt = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const esperarTexto = (page, re, ms = 30000) => page.waitForFunction((s) => new RegExp(s).test(document.body.innerText), re.source, { timeout: ms });
const campana = (page) => page.locator('button[aria-label^="Avisos"]:visible').first();
const panelCampana = (page) => page.locator("[role=region][aria-label=Avisos]");
// Tarjeta del contrato en el portal del aliado (un <article> con su <h3>).
const articulo = (page, n) => page.locator("article").filter({ has: page.locator("h3", { hasText: new RegExp(`^${n}$`) }) }).first();
async function estado(page, n) {
  const a = articulo(page, n);
  if ((await a.count()) === 0) return null;
  const boton = a.getByRole("button", { name: /Subir soporte|Procesando/ });
  const caja = await a.boundingBox();
  return { texto: (await a.innerText()).replace(/\s+/g, " "), deshabilitado: await boton.isDisabled(), dentro: !!caja && caja.x >= -1 && caja.x + caja.width <= (page.viewportSize()?.width ?? 0) + 1 };
}
const vigentes = (c, n) => Number(c.sql(`select count(*) from public.contrato_soportes_pago where numero_contrato = '${n}' and vigente and archivado_en is null`));
const huella = (c, n) => c.sql(`select md5(to_jsonb(v)::text) || ':' || v.estado || ':' || (select count(*) from public.abonos a where a.numero_contrato = v.numero_contrato) || ':' || (select count(*) from public.asientos_contables) from public.ventas v where numero_contrato = '${n}'`);
// Espera a que la tarjeta deje de «Procesando…» y muestre el cupo esperado (el mensaje de éxito sale antes de que se refresquen los datos del servidor).
const esperarTarjeta = (page, n, re, ms = 60000) => page.waitForFunction(([num, s]) => { const a = [...document.querySelectorAll("article")].find((x) => x.querySelector("h3")?.textContent.trim() === num); const t = a ? a.innerText.replace(/\s+/g, " ") : ""; return !!a && !/Procesando/.test(t) && new RegExp(s).test(t); }, [n, re.source], { timeout: ms });
async function otraSesion(c, alias, ruta, fn) {
  const ctx = await c.page.context().browser().newContext({ viewport: { width: c.ancho, height: 900 }, locale: "es-CO", timezoneId: "America/Bogota" });
  const page = await ctx.newPage();
  try {
    await page.goto(`${c.APP}/login`, { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle").catch(() => {});
    await page.fill('input[name="email"]', `${alias}${c.cuentas}`); await page.fill('input[name="password"]', c.clave);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => null), page.click('button[type="submit"]')]);
    await page.waitForTimeout(800);
    await page.goto(`${c.APP}${ruta}`, { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1500);
    return await fn(page);
  } finally { await ctx.close(); }
}
// Último input de archivo de la tarjeta (el del botón «Subir soporte»; los de «Reemplazar» van dentro de cada soporte).
const inputNuevo = (page, n) => articulo(page, n).locator("input[type=file]").last();

export const pasos = [
  {
    id: "S339-01", entrega: "soportes339", rol: "aliado", titulo: "Portal del aliado: cupo de soportes según los pagos registrados", ruta: SOPORTES, solo_lectura: true,
    accion: "Con la cuenta de la agencia aliada abre Cartera → pestaña «Soportes de pago». Localiza las tarjetas DTM-8301 a DTM-8306 (en el celular van apiladas, sin tablas). Lee en cada una «Soportes vigentes: X de Y permitidos», la línea de pagos registrados y el estado del botón «Subir soporte».",
    esperado: "El texto superior dice que se permite un soporte por pago registrado MÁS uno adicional, y que «Subir un soporte no registra ni aprueba un pago, ni cambia el saldo». DTM-8301 «0 de 1 permitidos» (0 pagos registrados + 1 adicional): botón habilitado. DTM-8302 «1 de 1»: botón deshabilitado, «Ya usaste todos los soportes permitidos». DTM-8303 «1 de 2» (1 pago registrado + 1 adicional): habilitado, «este es el soporte adicional, para un pago aún sin registrar». DTM-8304 «2 de 2»: deshabilitado. "
      + "DTM-8305 «4 de 3 permitidos»: aviso «Hay más soportes vigentes de los permitidos (por ejemplo, tras corregir un pago)…»; se puede reemplazar o retirar, no agregar (EXCESO sobre pagos + 1, distinto del soporte adicional normal). DTM-8306 «3 de 3»: deshabilitado. El contrato DTM-8399 de otro aliado NO aparece. Nada se desborda a 390 px. Observación: los contratos cancelados siguen apareciendo en esta lista (decisión pendiente del dueño).",
    async verificar(c) {
      await c.ir(SOPORTES); await c.espera(2500);
      const t = await c.texto();
      c.check("explica el límite y que un soporte no es un pago", /un soporte vigente por cada pago registrado del contrato y uno adicional/.test(t) && /Subir un soporte no registra ni aprueba un pago, ni cambia el saldo/.test(t));
      const casos = [
        ["DTM-8301", /0 de 1 permitidos/, /0 pagos registrados \+ 1 adicional/, /Aún no hay pagos registrados: puedes adjuntar un soporte/, false],
        ["DTM-8302", /1 de 1 permitidos/, /0 pagos registrados \+ 1 adicional/, /Ya usaste todos los soportes permitidos/, true],
        ["DTM-8303", /1 de 2 permitidos/, /1 pago registrado \+ 1 adicional/, /este es el soporte adicional, para un pago aún sin registrar/, false],
        ["DTM-8304", /2 de 2 permitidos/, /1 pago registrado \+ 1 adicional/, /Ya usaste todos los soportes permitidos/, true],
        ["DTM-8305", /4 de 3 permitidos/, /2 pagos registrados \+ 1 adicional/, /Hay más soportes vigentes de los permitidos/, true],
        ["DTM-8306", /3 de 3 permitidos/, /2 pagos registrados \+ 1 adicional/, /Ya usaste todos los soportes permitidos/, true],
      ];
      for (const [n, resumen, pagos, msg, deshab] of casos) {
        const e = await estado(c.page, n);
        c.check(`${n}: cupo «${(e?.texto.match(/Soportes vigentes: \d+ de \d+ permitidos/) ?? [""])[0]}», mensaje y botón ${deshab ? "deshabilitado" : "habilitado"}`, !!e && resumen.test(e.texto) && pagos.test(e.texto) && msg.test(e.texto) && e.deshabilitado === deshab, e?.texto.slice(0, 200));
        c.check(`${n}: la tarjeta cabe en la pantalla`, !!e && e.dentro);
      }
      c.check("el exceso (8305) se distingue del soporte adicional normal (8303)", !/Hay más soportes vigentes de los permitidos/.test((await estado(c.page, "DTM-8303"))?.texto ?? "") && /Hay más soportes vigentes de los permitidos/.test((await estado(c.page, "DTM-8305"))?.texto ?? ""));
      c.check("no ve el contrato de otro aliado", !/DTM-8399|Cliente de otro aliado/.test(t));
    },
  },
  {
    id: "S339-02", entrega: "soportes339", rol: "gerencia", titulo: "Ficha interna: «adicional sin registrar» frente a «exceso» (gerencia, superadmin y administración)", ruta: "/dashboard/contratos/DTM-8304", solo_lectura: true, desborde: false,
    accion: "Con la cuenta de gerencia abre el contrato DTM-8304 y baja hasta «Soportes de pago del aliado». Después abre DTM-8305 y compara los avisos. (Superadmin y administración ven el mismo panel.)",
    esperado: "DTM-8304: «Vigentes 2 de 2 permitidos (1 abono registrado + 1 adicional)» y una nota azul «Hay más soportes vigentes que abonos registrados: el aliado puede haber adjuntado la evidencia de un pago aún sin registrar. Revisa los soportes y registra el abono que corresponda…» (informativa, no es un error). DTM-8305: «Vigentes 4 de 3 permitidos (2 abonos registrados + 1 adicional)» con un aviso ámbar «Hay más soportes vigentes de los permitidos (p. ej. tras anular un abono)…» y SIN la nota azul. En ambos: «Un soporte no registra ni aprueba un pago». A 390 px el panel cabe en la pantalla. (A 768 px la ficha de contrato tiene un desplazamiento horizontal ya conocido de la ficha, ajeno a esta entrega.)",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-8304");
      let t = await c.texto();
      c.check("DTM-8304: cupo con el desglose abonos + 1 adicional", /Vigentes 2 de 2 permitidos \(1 abono registrado \+ 1 adicional\)/.test(t), t.slice(0, 120));
      c.check("DTM-8304: nota azul de pago aún sin registrar y no el aviso de exceso", /Hay más soportes vigentes que abonos registrados: el aliado puede haber adjuntado la evidencia de un pago aún sin registrar/.test(t) && !/Hay más soportes vigentes de los permitidos/.test(t));
      c.check("aclara que un soporte no registra ni aprueba un pago", /Un soporte no registra ni aprueba un pago/.test(t));
      const caja = await c.page.locator('[aria-label="Soportes de pago del aliado"]').boundingBox();
      c.check("el panel cabe en la pantalla", !!caja && caja.x >= -1 && caja.x + caja.width <= c.ancho + 1, JSON.stringify(caja));
      await c.ir("/dashboard/contratos/DTM-8305");
      t = await c.texto();
      c.check("DTM-8305: «4 de 3» con aviso de exceso (ámbar) y sin la nota azul", /Vigentes 4 de 3 permitidos \(2 abonos registrados \+ 1 adicional\)/.test(t) && /Hay más soportes vigentes de los permitidos \(p\. ej\. tras anular un abono\)/.test(t) && !/el aliado puede haber adjuntado la evidencia/.test(t), t.slice(0, 120));
    },
  },
  {
    id: "S339-03", entrega: "soportes339", rol: "aliado", titulo: "Subir soportes: sin pagos permite uno; con un pago permite dos; al llenarse se rechaza otro", ruta: SOPORTES,
    accion: "En «Soportes de pago» pulsa «Subir soporte» en DTM-8301 (0 pagos) y elige un PDF pequeño (por ejemplo «comprobante-8301.pdf»). Repite en DTM-8303 (1 pago y 1 soporte): sube un segundo archivo. Mira el botón y los mensajes de cada tarjeta.",
    esperado: "DTM-8301 queda «1 de 1 permitidos» con «Soporte subido.» y el botón deshabilitado («Ya usaste todos los soportes permitidos…»). DTM-8303 pasa a «2 de 2 permitidos» y el botón también se deshabilita. Subir el soporte NO registra un pago ni cambia el saldo, ni el estado de la venta (DTM-8301 sigue «pendiente»), ni crea asientos contables. Si se fuerza otro archivo con el cupo lleno (el ensayo lo fuerza por el campo oculto), el sistema lo rechaza: «Este contrato ya tiene el máximo de soportes vigentes: uno por cada pago registrado y uno adicional».",
    async verificar(c) {
      await c.ir(SOPORTES); await c.espera(2500);
      for (const [n, antes, despues] of [["DTM-8301", 0, /1 de 1 permitidos/], ["DTM-8303", 1, /2 de 2 permitidos/]]) {
        const h0 = huella(c, n);
        c.check(`${n}: parte con ${antes} soporte(s) vigente(s)`, vigentes(c, n) === antes);
        await inputNuevo(c.page, n).setInputFiles(PDF(n.slice(4)));
        await esperarTexto(c.page, /Soporte subido\./, 40000);
        await esperarTarjeta(c.page, n, despues);
        const e = await estado(c.page, n);
        c.check(`${n}: pasa a «${(e?.texto.match(/Soportes vigentes: \d+ de \d+ permitidos/) ?? [""])[0]}» con «Soporte subido.»`, !!e && despues.test(e.texto) && /Soporte subido\./.test(e.texto), e?.texto.slice(0, 200));
        c.check(`${n}: el botón queda deshabilitado con el mensaje de máximo`, !!e && e.deshabilitado && /Ya usaste todos los soportes permitidos/.test(e.texto));
        c.check(`${n}: la base tiene ${antes + 1} soporte(s) vigente(s)`, vigentes(c, n) === antes + 1);
        c.check(`${n}: venta, estado, abonos y asientos idénticos tras la subida (un soporte no es un pago)`, huella(c, n) === h0, `${h0} → ${huella(c, n)}`);
        await inputNuevo(c.page, n).setInputFiles(PDF(n.slice(4) + "-extra"));
        await esperarTexto(c.page, /máximo de soportes vigentes: uno por cada pago registrado y uno adicional/, 40000);
        c.check(`${n}: el archivo de más se rechaza con el mensaje de máximo y la base no cambia`, vigentes(c, n) === antes + 1);
      }
      c.check("DTM-8301 sigue pendiente: subir evidencia no confirma el contrato", c.sql("select estado from public.ventas where numero_contrato = 'DTM-8301'") === "pendiente");
      c.check("ningún pago nació de las subidas (8301: 0 abonos; 8303: 1)", c.sql("select count(*) from public.abonos where numero_contrato = 'DTM-8301'") === "0" && c.sql("select count(*) from public.abonos where numero_contrato = 'DTM-8303'") === "1");
    },
  },
  {
    id: "S339-04", entrega: "soportes339", rol: "aliado", titulo: "Reemplazar y retirar conservan el historial", ruta: SOPORTES,
    accion: "En DTM-8303 pulsa «Reemplazar» en el soporte «comprobante-8303.pdf» (el que subiste) y elige una imagen PNG pequeña. En DTM-8305 (4 de 3) pulsa «Retirar» en «a.pdf» y acepta el aviso «¿Retirar este soporte?».",
    esperado: "Reemplazo: «Soporte reemplazado. El anterior queda en el historial del equipo.»; DTM-8303 sigue en «2 de 2». Retiro: «Soporte retirado.»; DTM-8305 pasa a «3 de 3 permitidos» y desaparece el aviso de exceso (el botón sigue deshabilitado hasta que se registre otro pago). Nada se borra: el equipo conserva el archivo anterior y quién/cuándo lo cambió.",
    async verificar(c) {
      await c.ir(SOPORTES); await c.espera(2500);
      const viejo = c.sql("select id from public.contrato_soportes_pago where numero_contrato = 'DTM-8303' and nombre_original = 'comprobante-8303.pdf' and vigente");
      c.check("existe el soporte subido en el paso anterior", !!viejo, viejo);
      const li = articulo(c.page, "DTM-8303").locator("li").filter({ hasText: "comprobante-8303.pdf" }).first();
      await li.locator("input[type=file]").setInputFiles(PNG("comprobante-8303-corregido.png"));
      await esperarTexto(c.page, /Soporte reemplazado\. El anterior queda en el historial del equipo/, 40000);
      await esperarTarjeta(c.page, "DTM-8303", /2 de 2 permitidos/);
      c.check("reemplazo: el anterior queda NO vigente (motivo reemplazo) y el nuevo lo referencia", c.sql(`select vigente || '|' || coalesce(motivo_retiro, '') from public.contrato_soportes_pago where id = ${viejo}`) === "false|reemplazo"
        && c.sql(`select count(*) from public.contrato_soportes_pago where reemplaza_id = ${viejo} and vigente and nombre_original = 'comprobante-8303-corregido.png'`) === "1" && vigentes(c, "DTM-8303") === 2);
      c.page.once("dialog", (d) => d.accept());
      await articulo(c.page, "DTM-8305").locator("li").filter({ hasText: "a.pdf" }).first().getByRole("button", { name: /Retirar/ }).click();
      await esperarTexto(c.page, /Soporte retirado\./, 40000);
      await esperarTarjeta(c.page, "DTM-8305", /3 de 3 permitidos/);
      const e = await estado(c.page, "DTM-8305");
      c.check("DTM-8305: «3 de 3 permitidos», sin aviso de exceso y botón aún deshabilitado", !!e && /3 de 3 permitidos/.test(e.texto) && !/Hay más soportes vigentes de los permitidos/.test(e.texto) && e.deshabilitado, e?.texto.slice(0, 200));
      c.check("retirar NO borra: la fila sigue, marcada como retiro", c.sql("select vigente || '|' || coalesce(motivo_retiro, '') from public.contrato_soportes_pago where numero_contrato = 'DTM-8305' and nombre_original = 'a.pdf'") === "false|retiro");
    },
  },
  {
    id: "S339-05", entrega: "soportes339", rol: "gerencia", titulo: "El equipo recibe el aviso, revisa la evidencia y ve el historial; subir no cambia nada financiero", ruta: "/dashboard/cotizaciones",
    accion: "Con gerencia pulsa la campana y busca «Nuevo soporte de pago en el contrato DTM-8301» y «Se reemplazó un soporte de pago en el contrato DTM-8303». Abre el de DTM-8301, pulsa «Abrir» en «comprobante-8301.pdf» y revisa «Cartera». Luego abre DTM-8303 y despliega «Historial conservado».",
    esperado: "La campana muestra los avisos normales (sin importes ni nombres de archivo) y cada uno lleva a la ficha del contrato. El panel «Soportes de pago del aliado» lista el archivo vigente con «Abrir» (se abre el archivo real). En Cartera de DTM-8301 el pagado sigue en $ 0 y el contrato pendiente: el soporte es evidencia; el pago real lo registra el equipo aparte (siguiente paso). En DTM-8303, «Historial conservado (1)» muestra el archivo reemplazado con su fecha y la marca «reemplazado» y la referencia «sustituye al soporte #…». También reciben el aviso superadmin, administración, operaciones y el asesor del contrato (venta).",
    async verificar(c) {
      await c.ir("/dashboard/cotizaciones"); await c.espera(2500);
      await campana(c.page).click(); await c.espera(900);
      const panel = await panelCampana(c.page).innerText();
      c.check("aviso de soporte nuevo (DTM-8301) y de reemplazo (DTM-8303)", /Nuevo soporte de pago en el contrato DTM-8301/.test(panel) && /Se reemplazó un soporte de pago en el contrato DTM-8303/.test(panel), panel.slice(0, 300));
      c.check("el aviso no trae importes ni nombres de archivo", !/comprobante-8301|\$ ?\d/.test(panel.split("\n").filter((l) => /DTM-8301|DTM-8303/.test(l)).join(" ")));
      const dest = c.sql("select string_agg(u.email, ',' order by u.email) from public.avisos a join public.usuarios u on u.id = a.usuario_id where a.tipo = 'soporte_pago_nuevo' and a.numero_contrato = 'DTM-8301'");
      c.check("reciben el aviso superadmin, gerencia, administración, operaciones y el asesor (venta); no el aliado", dest === ["administracion", "gerencia", "operaciones", "superadmin", "venta"].map((a) => `${a}@consolidada.test`).join(","), dest);
      const enlace = panelCampana(c.page).locator("a", { hasText: "DTM-8301" }).first();
      c.check("el aviso lleva a la ficha del contrato", (await enlace.getAttribute("href")) === "/dashboard/contratos/DTM-8301");
      await enlace.click(); await c.page.waitForURL(/\/dashboard\/contratos\/DTM-8301/, { timeout: 30000 }); await c.espera(2500);
      let t = await c.texto();
      c.check("el panel de soportes lista el archivo con «Abrir»", /Soportes de pago del aliado/.test(t) && /comprobante-8301\.pdf/.test(t));
      // «Abrir» llama a window.open con un enlace firmado de corta vida: se intercepta la llamada para leer el enlace y pedirlo (evita depender de cómo el navegador muestre el PDF).
      await c.page.evaluate(() => { window.__abierta = null; window.open = (u) => { window.__abierta = String(u); return null; }; });
      await c.page.locator('[aria-label="Soportes de pago del aliado"]').getByRole("button", { name: /Abrir/ }).first().click();
      await c.page.waitForFunction(() => !!window.__abierta, null, { timeout: 20000 }).catch(() => {});
      const real = await c.page.evaluate(() => window.__abierta);
      const respuesta = real ? await fetch(real).catch(() => null) : null;
      c.check("«Abrir» entrega el archivo real (enlace firmado que responde 200)", !!respuesta && respuesta.status === 200, real);
      await c.ir("/dashboard/contratos/DTM-8301?tab=cartera");
      t = await c.texto();
      c.check("el contrato sigue sin pagos registrados y pendiente", c.sql("select count(*) from public.abonos where numero_contrato = 'DTM-8301'") === "0" && c.sql("select estado from public.ventas where numero_contrato = 'DTM-8301'") === "pendiente");
      await c.ir("/dashboard/contratos/DTM-8303");
      await c.page.locator("summary", { hasText: /Historial conservado/ }).first().click(); await c.espera(500);
      t = await c.texto();
      c.check("el historial conserva el archivo reemplazado", /Historial conservado \(1\)/.test(t) && /comprobante-8303\.pdf/.test(t) && /reemplazado/.test(t) && /sustituye al soporte #\d+/.test(t), t.slice(0, 200));
    },
  },
  {
    id: "S339-06", entrega: "soportes339", rol: "gerencia", titulo: "Registrar el pago real es un acto aparte: abre el siguiente cupo", ruta: "/dashboard/contratos/DTM-8302?tab=cartera",
    accion: "Abre el contrato DTM-8302 (pestaña Cartera; tiene 0 pagos y 1 soporte). En «Registrar abono» pon 500.000, forma «Transferencia» y pulsa «Registrar abono». Mira el panel «Soportes de pago del aliado» de la misma ficha.",
    esperado: "El abono aparece en «Pagos registrados» y el pagado sube a $ 500.000. El panel de soportes pasa a «Vigentes 1 de 2 permitidos (1 abono registrado + 1 adicional)»: el soporte ya subido NO se convirtió en pago ni se asoció a ese abono (no se sabe cuál abono corresponde a qué archivo); registrar el pago fue lo que abrió un cupo nuevo. El estado del contrato depende de la regla normal de confirmación por abono, no del soporte.",
    async verificar(c) {
      const antes = vigentes(c, "DTM-8302");
      await c.ir("/dashboard/contratos/DTM-8302?tab=cartera");
      const f = c.page.locator("form").filter({ has: c.page.getByRole("button", { name: "Registrar abono" }) });
      await f.locator("input[type=number]").first().fill("500000"); await f.locator("select").first().selectOption({ label: "Transferencia" });
      await f.getByRole("button", { name: "Registrar abono" }).click();
      for (let i = 0; i < 40 && c.sql("select count(*) from public.abonos where numero_contrato = 'DTM-8302'") === "0"; i++) await c.espera(500);
      c.check("el pago real quedó registrado (un abono)", c.sql("select count(*) from public.abonos where numero_contrato = 'DTM-8302'") === "1");
      c.check("el soporte no se convirtió en pago ni se retiró", vigentes(c, "DTM-8302") === antes && antes === 1);
      await c.ir("/dashboard/contratos/DTM-8302?tab=cartera");
      const t = await c.texto();
      c.check("el panel pasa a «1 de 2 permitidos (1 abono registrado + 1 adicional)»", /Vigentes 1 de 2 permitidos \(1 abono registrado \+ 1 adicional\)/.test(t), t.slice(0, 160));
      c.check("el pagado muestra el abono registrado", /500\.000/.test(t));
    },
  },
  {
    id: "S339-07", entrega: "soportes339", rol: "aliado", titulo: "Tras registrarse el pago, el aliado puede subir el siguiente soporte", ruta: SOPORTES,
    accion: "En «Soportes de pago» mira DTM-8302 (el equipo registró un pago). Sube un segundo archivo PDF.",
    esperado: "DTM-8302 muestra «1 de 2 permitidos» y «1 pago registrado + 1 adicional», el botón «Subir soporte» está habilitado con «este es el soporte adicional, para un pago aún sin registrar». Tras subir queda «2 de 2 permitidos» y el botón se deshabilita de nuevo. La tarjeta cabe en el celular.",
    async verificar(c) {
      await c.ir(SOPORTES); await c.espera(2500);
      let e = await estado(c.page, "DTM-8302");
      c.check("DTM-8302: «1 de 2 permitidos», 1 pago registrado y botón habilitado", !!e && /1 de 2 permitidos/.test(e.texto) && /1 pago registrado \+ 1 adicional/.test(e.texto) && !e.deshabilitado && /este es el soporte adicional/.test(e.texto), e?.texto.slice(0, 220));
      await inputNuevo(c.page, "DTM-8302").setInputFiles(PDF("8302-2"));
      await esperarTexto(c.page, /Soporte subido\./, 40000);
      await esperarTarjeta(c.page, "DTM-8302", /2 de 2 permitidos/);
      e = await estado(c.page, "DTM-8302");
      c.check("DTM-8302: «2 de 2 permitidos» y botón deshabilitado otra vez", !!e && /2 de 2 permitidos/.test(e.texto) && e.deshabilitado, e?.texto.slice(0, 200));
      c.check("el pago registrado no cambió por la subida", c.sql("select count(*) from public.abonos where numero_contrato = 'DTM-8302'") === "1" && vigentes(c, "DTM-8302") === 2);
      c.check("la tarjeta cabe en la pantalla", !!e && e.dentro);
    },
  },
  {
    id: "S339-08", entrega: "soportes339", rol: "freelance", titulo: "Otro aliado (freelance) solo ve y usa sus propios contratos", ruta: SOPORTES, solo_lectura: true,
    accion: "Con la cuenta de la freelance abre Cartera → «Soportes de pago».",
    esperado: "Solo aparece SU contrato DTM-8399 («0 de 1 permitidos», botón habilitado). No aparece ninguno de la agencia aliada (DTM-8301 a DTM-8306) ni sus archivos.",
    async verificar(c) {
      await c.ir(SOPORTES); await c.espera(2500);
      const t = await c.texto();
      const e = await estado(c.page, "DTM-8399");
      c.check("ve su contrato DTM-8399 sin soportes y con el botón habilitado", !!e && /0 de 1 permitidos/.test(e.texto) && !e.deshabilitado, e?.texto.slice(0, 160));
      c.check("no ve ningún contrato ni archivo de la otra agencia", !/DTM-83(0[1-6])|DTM-98|comprobante-83|COMPROBANTE_TRANSFERENCIA/.test(t), t.slice(0, 200));
    },
  },
  {
    id: "S339-09", entrega: "soportes339", rol: "venta", titulo: "El asesor del contrato ve y recibe lo suyo; otro asesor no ve los soportes", ruta: "/dashboard/contratos/DTM-8304", solo_lectura: true, desborde: false,
    accion: "Con la cuenta de venta (asesor «Rev Venta» de estos contratos) abre DTM-8304, baja a «Soportes de pago del aliado» y pulsa la campana. Después entra con «venta2» (otro asesor) y abre el mismo contrato.",
    esperado: "El asesor del contrato ve el panel con «Vigentes 2 de 2 permitidos (1 abono registrado + 1 adicional)» y los archivos, y en la campana tiene «Nuevo soporte de pago en el contrato DTM-8301» (el que subió el aliado en el paso 3). El otro asesor puede consultar la ficha comercial del contrato pero NO ve el panel de soportes del aliado.",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-8304");
      const t = await c.texto();
      const i = t.indexOf("Soportes de pago del aliado");
      c.check("el asesor del contrato ve el panel con sus archivos", i >= 0 && /Vigentes 2 de 2 permitidos/.test(t) && /captura-pago-sin-registrar.png/.test(t), i >= 0 ? t.slice(i, i + 200) : t.slice(0, 160));
      c.check("el panel cuenta el abono registrado de DTM-8304 (1 abono + 1 adicional)", /Vigentes 2 de 2 permitidos \(1 abono registrado \+ 1 adicional\)/.test(t), i >= 0 ? t.slice(i, i + 200) : "sin panel");
      await campana(c.page).click(); await c.espera(800);
      c.check("tiene el aviso de soporte nuevo en la campana", /Nuevo soporte de pago en el contrato DTM-8301/.test(await panelCampana(c.page).innerText()));
      const otro = await otraSesion(c, "venta2", "/dashboard/contratos/DTM-8304", async (p) => ({ t: await txt(p), url: new URL(p.url()).pathname }));
      c.check("el otro asesor ve la ficha pero no el panel de soportes del aliado ni sus archivos", /DTM-8304/.test(otro.t) && !/Soportes de pago del aliado/.test(otro.t) && !/captura-pago-sin-registrar/.test(otro.t), `${otro.url} · ${otro.t.slice(0, 120)}`);
    },
  },
  // ══ S339-02 ampliado (migración 345): rechazo interno con motivo + correo al aliado + corrección. Datos: semillas/rev2/s339reject.sql (DTM-8310 con 1 pago; DTM-8311 sin pagos, de la agencia aliada).
  // Archivos reales y deterministas (mismos bytes = mismo contenido): «equivocado» se sube, se rechaza y luego se intenta re-subir idéntico.
  {
    id: "S339-10", entrega: "soportes339", rol: "aliado", titulo: "Rechazo (preparación): el aliado sube dos soportes reales a DTM-8310, uno equivocado", ruta: SOPORTES,
    accion: "En «Soportes de pago» busca la tarjeta DTM-8310 («0 de 2 permitidos»: 1 pago registrado + 1 adicional). Pulsa «Subir soporte» y elige un PDF pequeño que llamarás «equivocado-8310.pdf». Pulsa «Subir soporte» otra vez y elige otro PDF, «correcto-8310.pdf».",
    esperado: "La tarjeta pasa a «2 de 2 permitidos» y el botón se deshabilita. Subir no registra ningún pago, no cambia el saldo ni el estado del contrato (sigue «confirmado»).",
    async verificar(c) {
      await c.ir(SOPORTES); await c.espera(2500);
      let e = await estado(c.page, "DTM-8310");
      c.check("DTM-8310 existe en el portal (semilla rev2/s339reject.sql cargada): «0 de 2 permitidos», 1 pago registrado", !!e && /0 de 2 permitidos/.test(e.texto) && /1 pago registrado \+ 1 adicional/.test(e.texto), e?.texto.slice(0, 160) ?? "no existe DTM-8310");
      if (!e) return;
      const antes = huella(c, "DTM-8310");
      await inputNuevo(c.page, "DTM-8310").setInputFiles(PDFN("equivocado-8310", "eq8310"));
      await esperarTexto(c.page, /Soporte subido\./, 40000); await esperarTarjeta(c.page, "DTM-8310", /1 de 2 permitidos/);
      await inputNuevo(c.page, "DTM-8310").setInputFiles(PDFN("correcto-8310", "ok8310"));
      await esperarTarjeta(c.page, "DTM-8310", /2 de 2 permitidos/);
      e = await estado(c.page, "DTM-8310");
      c.check("DTM-8310: «2 de 2 permitidos» y botón deshabilitado", !!e && /2 de 2 permitidos/.test(e.texto) && e.deshabilitado, e?.texto.slice(0, 200));
      c.check("los dos soportes están vigentes con los nombres elegidos", vigentes(c, "DTM-8310") === 2 && c.sql("select count(*) from public.contrato_soportes_pago where numero_contrato = 'DTM-8310' and nombre_original in ('equivocado-8310.pdf', 'correcto-8310.pdf')") === "2");
      c.check("subir no cambió nada financiero (venta, estado, pagos, asientos)", huella(c, "DTM-8310") === antes);
    },
  },
  {
    id: "S339-11", entrega: "soportes339", rol: "gerencia", titulo: "El equipo rechaza un soporte con motivo obligatorio; el archivo y el historial se conservan", ruta: "/dashboard/contratos/DTM-8310", desborde: false,
    accion: "Con gerencia (también pueden superadmin, administración y operaciones) abre el contrato DTM-8310 y baja a «Soportes de pago del aliado». En la fila de «equivocado-8310.pdf» pulsa «Rechazar». Mira el botón de confirmar sin escribir nada; luego escribe «Este comprobante es de otro contrato.» y pulsa «Confirmar rechazo». Después despliega «Rechazados» y pulsa «Abrir» en el soporte rechazado. Finalmente entra con «venta» (asesor del contrato) y abre el mismo contrato.",
    esperado: "Sin motivo el botón «Confirmar rechazo» está deshabilitado, y el formulario aclara que rechazar «no registra ni cambia ningún pago». Al confirmar aparece «Soporte rechazado. Aviso enviado a 1 cuenta(s) del aliado.» El panel pasa a «Vigentes 1 de 2 permitidos» y «equivocado-8310.pdf» ya NO está entre los vigentes: figura en «Rechazados (1) · 1 pendiente(s) de corrección» con la fecha y quién lo rechazó, el motivo entre comillas, «Pendiente de corrección por el aliado» y «Aviso al aliado: enviado por correo»; «Abrir» abre el archivo real (se conserva). En Cartera el pagado, el saldo y el estado («confirmado») no cambian. El asesor «venta» ve el panel pero NO tiene botón «Rechazar».",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-8310");
      const panel = c.page.locator('[aria-label="Soportes de pago del aliado"]');
      const fila = panel.locator("li", { hasText: "equivocado-8310.pdf" }).first();
      c.check("el panel muestra los 2 vigentes y el botón «Rechazar» (gerencia puede)", (await fila.count()) === 1 && (await fila.getByRole("button", { name: /Rechazar/ }).count()) === 1 && /Vigentes 2 de 2 permitidos/.test(await panel.innerText()));
      const antes = huella(c, "DTM-8310");
      await fila.getByRole("button", { name: /^\s*Rechazar/ }).click(); await c.espera(400);
      const confirmar = c.page.getByRole("button", { name: /Confirmar rechazo/ });
      c.check("sin motivo no se puede confirmar, y el formulario aclara que no cambia ningún pago", (await confirmar.isDisabled()) && /Rechazar no registra ni cambia ningún pago/.test(await c.texto()));
      await c.page.locator("textarea").first().fill("   "); await c.espera(200);
      c.check("un motivo de solo espacios tampoco habilita confirmar", await confirmar.isDisabled());
      await c.page.locator("textarea").first().fill("Este comprobante es de otro contrato.");
      c.check("con motivo se habilita «Confirmar rechazo»", !(await confirmar.isDisabled()));
      await confirmar.click();
      await esperarTexto(c.page, /Soporte rechazado\./, 40000);
      for (let i = 0; i < 30 && vigentes(c, "DTM-8310") !== 1; i++) await c.espera(500);
      await esperarTexto(c.page, /Vigentes 1 de 2 permitidos/, 30000).catch(() => {});   // el mensaje sale al instante; el panel se refresca después desde el servidor
      const t = await c.texto();
      c.check("mensaje con el resultado del aviso por correo", /Soporte rechazado\. Aviso enviado a 1 cuenta\(s\) del aliado\./.test(t), t.slice(t.indexOf("Soporte rechazado") - 10, t.indexOf("Soporte rechazado") + 120));
      c.check("en la base: retirado por rechazo, con motivo, quién y cuándo; el archivo y la fila se conservan", c.sql("select (not vigente)::text || '|' || motivo_retiro || '|' || nota_retiro || '|' || (retirado_por is not null)::text || '|' || (retirado_en is not null)::text from public.contrato_soportes_pago where nombre_original = 'equivocado-8310.pdf' and numero_contrato = 'DTM-8310'") === "true|rechazo|Este comprobante es de otro contrato.|true|true" && vigentes(c, "DTM-8310") === 1);
      c.check("el panel pasa a «Vigentes 1 de 2» y el rechazado ya no está entre los vigentes", /Vigentes 1 de 2 permitidos/.test(t));
      const enActivos = await panel.locator(":scope > ul").first().innerText();
      c.check("«equivocado-8310.pdf» no aparece en la lista activa pero sí «correcto-8310.pdf»", !/equivocado-8310/.test(enActivos) && /correcto-8310/.test(enActivos), enActivos.slice(0, 120));
      // Recién rechazado, el desplegable «Rechazados» ya viene ABIERTO (hay una corrección pendiente y acaba de aparecer el aviso): solo se abre si está cerrado.
      if (!(await panel.locator("details", { has: c.page.locator("summary", { hasText: /Rechazados/ }) }).first().evaluate((d) => d.open))) { await panel.locator("summary", { hasText: /Rechazados/ }).first().click(); await c.espera(400); }
      const rech = await panel.locator('[data-testid^="rechazado-"]').first().innerText();
      c.check("«Rechazados (1) · 1 pendiente(s) de corrección» con archivo, quién/cuándo, motivo, estado de corrección y aviso", /Rechazados \(1\) · 1 pendiente\(s\) de corrección/.test(await panel.innerText()) && /equivocado-8310\.pdf/.test(rech) && /Rechazado .+ por /.test(rech) && /«Este comprobante es de otro contrato\.»/.test(rech) && /Pendiente de corrección por el aliado/.test(rech) && /Aviso al aliado: enviado por correo/.test(rech), rech.slice(0, 260));
      await c.page.evaluate(() => { window.__abierta = null; window.open = (u) => { window.__abierta = String(u); return null; }; });
      await panel.locator('[data-testid^="rechazado-"]').first().getByRole("button", { name: /Abrir/ }).click();
      await c.page.waitForFunction(() => !!window.__abierta, null, { timeout: 20000 }).catch(() => {});
      const real = await c.page.evaluate(() => window.__abierta); const resp = real ? await fetch(real).catch(() => null) : null;
      c.check("el archivo rechazado se conserva: «Abrir» entrega el archivo real (200)", !!resp && resp.status === 200, real);
      c.check("rechazar no cambió nada financiero (venta, estado «confirmado», pagos, asientos)", huella(c, "DTM-8310") === antes && c.sql("select estado from public.ventas where numero_contrato = 'DTM-8310'") === "confirmado");
      const venta = await otraSesion(c, "venta", "/dashboard/contratos/DTM-8310", async (p) => ({ t: await txt(p), botones: await p.getByRole("button", { name: /^\s*Rechazar/ }).count() }));
      c.check("el asesor (venta) ve el panel pero NO puede rechazar", /Soportes de pago del aliado/.test(venta.t) && venta.botones === 0, `${venta.botones} botones «Rechazar»`);
    },
  },
  {
    id: "S339-12", entrega: "soportes339", rol: "aliado", titulo: "El aliado recibe el correo (en la captura local) y ve el rechazo con su motivo en el portal", ruta: SOPORTES,
    accion: "Abre el correo de pruebas (Mailpit, la dirección está en la sección «Antes de empezar» de esta guía): debe haber un mensaje para aliado@consolidada.test. Léelo. Luego, con la cuenta del aliado, abre «Soportes de pago» y mira la tarjeta DTM-8310.",
    esperado: "Correo: asunto «Soporte de pago rechazado · Contrato DTM-8310», con el nombre «equivocado-8310.pdf», «Motivo: Este comprobante es de otro contrato.», el enlace a «Soportes de pago» (http://localhost:3090/portal/b2b/cartera?vista=soportes) y la frase «Este mensaje no confirma ni cambia ningún pago». NO lleva montos ni el nombre del cliente. Es UN solo mensaje y solo para esa cuenta de aliado. Portal: sobre los vigentes hay un recuadro rojo «Soporte rechazado por el equipo» con el archivo, la fecha, «Motivo: Este comprobante es de otro contrato.» y el botón «Corregir soporte»; «correcto-8310.pdf» sigue vigente («1 de 2 permitidos»). A 390 px el recuadro cabe en la pantalla.",
    async verificar(c) {
      const todos = (await (await fetch(`${CORREO}/api/v1/messages?limit=500`)).json()).messages ?? [];
      const mios = todos.filter((m) => /Soporte de pago rechazado · Contrato DTM-8310/.test(m.Subject ?? ""));
      c.check("hay UN solo correo de este rechazo y va solo a aliado@consolidada.test", mios.length === 1 && mios[0].To.length === 1 && mios[0].To[0].Address === `aliado${c.cuentas}`, JSON.stringify(mios.map((m) => [m.Subject, m.To.map((x) => x.Address)])));
      if (mios.length) {
        const d = await (await fetch(`${CORREO}/api/v1/message/${mios[0].ID}`)).json();
        const texto = d.Text ?? "", html = d.HTML ?? "";
        c.check("el correo trae archivo, motivo y el enlace absoluto a «Soportes de pago»", /«equivocado-8310\.pdf»/.test(texto) && /Motivo: Este comprobante es de otro contrato\./.test(texto) && texto.includes(`${c.APP}${SOPORTES}`) && html.includes(`href="${c.APP}${SOPORTES}"`), texto.slice(0, 300));
        c.check("aclara que no confirma ni cambia ningún pago y no revela cliente ni montos", /no confirma ni cambia ningún pago/.test(texto) && !/Cliente Rechazo 8310|2\.?400\.?000|500\.?000/.test(texto + html));
      }
      await c.ir(SOPORTES); await c.espera(2500);
      const a = articulo(c.page, "DTM-8310");
      const caja = a.locator('[data-testid^="rechazado-"]').first();
      const t = (await caja.innerText().catch(() => "")).replace(/\s+/g, " ");
      c.check("recuadro rojo con el archivo, el motivo y «Corregir soporte»", /Soporte rechazado por el equipo/.test(t) && /equivocado-8310\.pdf/.test(t) && /Motivo: Este comprobante es de otro contrato\./.test(t) && /Corregir soporte/.test(t), t.slice(0, 240));
      const e = await estado(c.page, "DTM-8310");
      c.check("«correcto-8310.pdf» sigue vigente (1 de 2) y la tarjeta cabe en la pantalla", !!e && /1 de 2 permitidos/.test(e.texto) && /correcto-8310\.pdf/.test(e.texto) && !/equivocado-8310\.pdf[^«]{0,40}Abrir/.test(e.texto.replace(t, "")) && e.dentro, e?.texto.slice(0, 200));
    },
  },
  {
    id: "S339-13", entrega: "soportes339", rol: "aliado", titulo: "El aliado corrige el soporte rechazado (no vale subir el mismo archivo)", ruta: SOPORTES,
    accion: "En el recuadro rojo de DTM-8310 pulsa «Corregir soporte» y elige OTRA VEZ el mismo archivo «equivocado-8310.pdf». Mira el mensaje. Luego pulsa «Corregir soporte» y elige un PDF distinto, «corregido-8310.pdf».",
    esperado: "Con el mismo archivo: «Es el mismo archivo que se rechazó. Sube el archivo corregido.» y no cambia nada. Con el archivo nuevo: «Soporte corregido enviado. El equipo lo revisará.»; el recuadro rojo desaparece y la tarjeta queda «2 de 2 permitidos»: rechazado + corregido ocupan UN solo cupo. Corregir no registra ni aprueba ningún pago ni cambia el saldo.",
    async verificar(c) {
      await c.ir(SOPORTES); await c.espera(2500);
      const antes = huella(c, "DTM-8310");
      const entrada = () => articulo(c.page, "DTM-8310").locator('[data-testid^="rechazado-"] input[type=file]').first();
      await entrada().setInputFiles(PDFN("equivocado-otra-vez-8310", "eq8310"));
      await esperarTexto(c.page, /Es el mismo archivo que se rechazó/, 40000);
      c.check("el mismo archivo no sirve de corrección y no se crea nada", /Es el mismo archivo que se rechazó\. Sube el archivo corregido\./.test(await c.texto()) && vigentes(c, "DTM-8310") === 1 && c.sql("select count(*) from public.contrato_soportes_pago where numero_contrato = 'DTM-8310'") === "2");
      await entrada().setInputFiles(PDFN("corregido-8310", "bueno8310"));
      await esperarTexto(c.page, /Soporte corregido enviado\./, 40000);
      await esperarTarjeta(c.page, "DTM-8310", /2 de 2 permitidos/);
      const e = await estado(c.page, "DTM-8310");
      c.check("la tarjeta queda «2 de 2 permitidos» (la cadena rechazado → corregido ocupa un solo cupo) y el recuadro rojo desaparece", !!e && /2 de 2 permitidos/.test(e.texto) && !/Soporte rechazado por el equipo/.test(e.texto) && e.deshabilitado, e?.texto.slice(0, 220));
      c.check("en la base: la corrección apunta al rechazado, y hay 2 vigentes (correcto + corregido)", c.sql("select count(*) from public.contrato_soportes_pago c join public.contrato_soportes_pago r on r.id = c.corrige_id where c.nombre_original = 'corregido-8310.pdf' and r.nombre_original = 'equivocado-8310.pdf' and r.motivo_retiro = 'rechazo'") === "1" && vigentes(c, "DTM-8310") === 2);
      c.check("corregir no cambió nada financiero", huella(c, "DTM-8310") === antes);
    },
  },
  {
    id: "S339-14", entrega: "soportes339", rol: "gerencia", titulo: "El equipo ve la corrección vigente y el rechazado con su historia", ruta: "/dashboard/contratos/DTM-8310", desborde: false,
    accion: "Con gerencia pulsa la campana y busca «Se reemplazó un soporte de pago en el contrato DTM-8310». Abre DTM-8310 y mira «Soportes de pago del aliado»; despliega «Rechazados».",
    esperado: "La campana avisa de la corrección (sin importes ni nombres de archivo). Entre los vigentes están «correcto-8310.pdf» y «corregido-8310.pdf» (este dice «corrige el soporte rechazado #…»). «Rechazados (1) · todos corregidos» muestra «equivocado-8310.pdf» con su motivo, quién y cuándo, y «Corregido con el soporte #… (fecha)». Cartera, pagado y estado siguen igual que antes de rechazar.",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-8310"); await c.espera(2500);
      await campana(c.page).click(); await c.espera(800);
      c.check("la campana tiene el aviso de la corrección", /Se reemplazó un soporte de pago en el contrato DTM-8310/.test(await panelCampana(c.page).innerText()));
      await c.page.keyboard.press("Escape").catch(() => {});
      const panel = c.page.locator('[aria-label="Soportes de pago del aliado"]');
      let t = await panel.innerText();
      c.check("vigentes: «correcto-8310.pdf» y «corregido-8310.pdf» con «corrige el soporte rechazado #»", /Vigentes 2 de 2 permitidos/.test(t) && /correcto-8310\.pdf/.test(t) && /corregido-8310\.pdf/.test(t) && /corrige el soporte rechazado #\d+/.test(t), t.slice(0, 260));
      await panel.locator("summary", { hasText: /Rechazados/ }).first().click(); await c.espera(400);
      t = await panel.innerText();
      c.check("«todos corregidos» y el rechazado conserva motivo, quién/cuándo y la referencia a su corrección", /Rechazados \(1\) · todos corregidos/.test(t) && /«Este comprobante es de otro contrato\.»/.test(t) && /Corregido con el soporte #\d+/.test(t), t.slice(t.indexOf("Rechazados"), t.indexOf("Rechazados") + 300));
      c.check("el pago registrado, el saldo y el estado no cambiaron en todo el recorrido (1 abono, «confirmado»)", c.sql("select count(*) from public.abonos where numero_contrato = 'DTM-8310'") === "1" && c.sql("select estado from public.ventas where numero_contrato = 'DTM-8310'") === "confirmado");
    },
  },
  {
    id: "S339-15", entrega: "soportes339", rol: "aliado", titulo: "Cupo: rechazar libera el cupo, la corrección no se salta el tope y siempre hay salida", ruta: SOPORTES,
    accion: "En DTM-8311 (0 pagos, cabe 1) sube «unico-8311.pdf». Pide a gerencia que lo rechace con el motivo «Ilegible» (el ensayo lo hace por la pantalla de gerencia). Antes de corregir, sube «otro-8311.pdf» con «Subir soporte» (el cupo liberado se usa). Mira el botón «Corregir soporte». Después pulsa «Reemplazar» en «otro-8311.pdf» y elige el archivo correcto. Nota informativa: la prueba automática de la base lanza 3 correcciones simultáneas del mismo rechazo y exactamente una gana (no es una acción tuya).",
    esperado: "Tras el rechazo DTM-8311 queda sin vigentes («0 de 1») y el recuadro rojo dice «Ilegible». Subir «otro-8311.pdf» se permite (el cupo estaba libre): «1 de 1 permitidos». Entonces «Corregir soporte» aparece DESHABILITADO con «Ya tienes todos los soportes permitidos: reemplaza uno de ellos con el archivo correcto…»: la corrección no salta el tope. «Reemplazar» sí funciona y el contrato nunca supera «1 de 1». Ningún paso cambió pagos, saldo ni el estado del contrato.",
    async verificar(c) {
      await c.ir(SOPORTES); await c.espera(2500);
      let e = await estado(c.page, "DTM-8311");
      c.check("DTM-8311 existe sin soportes: «0 de 1 permitidos», botón habilitado", !!e && /0 de 1 permitidos/.test(e.texto) && !e.deshabilitado, e?.texto.slice(0, 160) ?? "no existe DTM-8311");
      if (!e) return;
      const antes = huella(c, "DTM-8311");
      await inputNuevo(c.page, "DTM-8311").setInputFiles(PDFN("unico-8311", "u8311"));
      await esperarTexto(c.page, /Soporte subido\./, 40000); await esperarTarjeta(c.page, "DTM-8311", /1 de 1 permitidos/);
      const id = c.sql("select id from public.contrato_soportes_pago where numero_contrato = 'DTM-8311' and nombre_original = 'unico-8311.pdf'");
      // gerencia rechaza por la pantalla real (otra sesión del navegador)
      const r = await otraSesion(c, "gerencia", "/dashboard/contratos/DTM-8311", async (p) => {
        const fila = p.locator('[aria-label="Soportes de pago del aliado"] li', { hasText: "unico-8311.pdf" }).first();
        await fila.getByRole("button", { name: /^\s*Rechazar/ }).click();
        await p.locator("textarea").first().fill("Ilegible");
        await p.getByRole("button", { name: /Confirmar rechazo/ }).click();
        await esperarTexto(p, /Soporte rechazado\./, 40000);
        return await txt(p);
      });
      c.check("gerencia rechazó «unico-8311.pdf» con el motivo «Ilegible» por la pantalla", /Soporte rechazado\./.test(r) && c.sql(`select motivo_retiro || '|' || nota_retiro from public.contrato_soportes_pago where id = ${id}`) === "rechazo|Ilegible");
      await c.ir(SOPORTES); await c.espera(2500);
      e = await estado(c.page, "DTM-8311");
      c.check("DTM-8311 queda «0 de 1 permitidos» (el rechazo liberó el cupo) y el recuadro rojo dice «Ilegible»", !!e && /0 de 1 permitidos/.test(e.texto) && /Motivo: Ilegible/.test(e.texto) && /Corregir soporte/.test(e.texto), e?.texto.slice(0, 220));
      await inputNuevo(c.page, "DTM-8311").setInputFiles(PDFN("otro-8311", "o8311"));
      await esperarTexto(c.page, /Soporte subido\./, 40000); await esperarTarjeta(c.page, "DTM-8311", /1 de 1 permitidos/);
      const corregir = articulo(c.page, "DTM-8311").locator('[data-testid^="rechazado-"] input[type=file]').first();
      const t = (await articulo(c.page, "DTM-8311").innerText()).replace(/\s+/g, " ");
      c.check("con el cupo ocupado «Corregir soporte» queda DESHABILITADO y explica que se reemplace uno vigente", await corregir.isDisabled() && /reemplaza uno de ellos con el archivo correcto/.test(t), t.slice(0, 260));
      c.check("la base también topa con el tope (llamada directa de corrección sin pasar por la pantalla)", (() => { try { c.sql(`select public.soporte_corregir(${id}, (select id from public.usuarios where email = 'aliado${c.cuentas}'), 'DTM-8311/directo-corr.pdf', 'directo.pdf', 'application/pdf', 10, repeat('ef', 32))`); return false; } catch (err) { return /SOPORTE_LIMITE/.test(String(err.stderr ?? err.message ?? err)); } })() && vigentes(c, "DTM-8311") === 1);
      const otro = c.sql("select id from public.contrato_soportes_pago where numero_contrato = 'DTM-8311' and nombre_original = 'otro-8311.pdf'");
      await articulo(c.page, "DTM-8311").locator("li", { hasText: "otro-8311.pdf" }).locator("input[type=file]").first().setInputFiles(PDFN("otro-8311-bueno", "ob8311"));
      await esperarTexto(c.page, /Soporte reemplazado\./, 40000); await esperarTarjeta(c.page, "DTM-8311", /1 de 1 permitidos/);
      c.check("salida: «Reemplazar» funciona y el contrato nunca supera «1 de 1»", vigentes(c, "DTM-8311") === 1 && c.sql(`select motivo_retiro from public.contrato_soportes_pago where id = ${otro}`) === "reemplazo");
      c.check("ningún paso cambió pagos, saldo ni estado del contrato (0 pagos, «pendiente»)", huella(c, "DTM-8311") === antes && c.sql("select count(*) from public.abonos where numero_contrato = 'DTM-8311'") === "0" && c.sql("select estado from public.ventas where numero_contrato = 'DTM-8311'") === "pendiente");
    },
  },
];
