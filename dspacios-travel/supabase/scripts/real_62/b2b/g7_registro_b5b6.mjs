  // ══ G7 · #62 correcciones B5/B6 con Auth REAL + PostgREST REAL + la app compilada (fallos inyectados en el gateway, entrelazados de verdad entre dos navegadores) ═════════════════════════
  if (G("regb5b6")) {
    const mailsB = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((t) => t.Address === para)).sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
    async function codigoB(para, antes = 0) {
      for (let i = 0; i < 40; i++) {
        const l = await mailsB(para);
        if (l.length > antes) { const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json(); const m = ((c.Text ?? "") + " " + (c.HTML ?? "")).match(/\b(\d{6})\b/); if (m) return m[1]; }
        await dormir(300);
      }
      return null;
    }
    const llenarB = async (page, { email, nombre, doc }) => {
      await page.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await page.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await page.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(nombre);
      await page.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await page.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(doc);
      await page.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(email);
      await page.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
      await page.getByTestId("paso-codigo").waitFor({ timeout: 25000 });
    };
    const solB = (email) => scalar(`select count(*) from public.b2b_solicitudes where lower(email) = '${email}'`);
    const confB = (email) => scalar(`select coalesce(email_confirmed_at is not null, false) from auth.users where lower(email) = '${email}'`);
    const cuentaB = (email) => scalar(`select count(*) from auth.users where lower(email) = '${email}'`);
    const estadoB = (email) => scalar(`select coalesce((select estado from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where lower(u.email) = '${email}'), 'sin fila')`);
    const enviarCodigo = async (page, codigo) => { await page.locator("#codigo-correo").fill(codigo); await page.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); };
    const docB = (p) => `${p}${String(Date.now()).slice(-7)}`;

    // R10 · B6: el código se acepta (Auth confirma) y falla la creación de la solicitud (500 REAL en la RPC): la cuenta verificada NO se borra y se continúa con la contraseña
    { const e = `b6a.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B6a QA ${TAG}`, doc: docB("93") });
      const cod = await codigoB(e, m0);
      igual("R10 antes del código: cuenta sin verificar, sin solicitud y con estado pendiente en la base", `${cuentaB(e)}/${confB(e)}/${solB(e)}/${estadoB(e)}`, "1/f/0/pendiente");
      await inyectar("/rest/v1/rpc/registro_b2b_completar", "500", 1);
      await enviarCodigo(p, cod);
      await p.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      const t = (await textoPagina(p)).replace(/\s+/g, " ");
      cierto("R10 tras fallar la creación de la solicitud la pantalla ofrece CONTINUAR con la contraseña (no «código inválido», no «ya existe»)", /Continúa tu registro/.test(t) && /contraseña/.test(t) && !/no es válido/.test(t), t.slice(-200));
      igual("R10 la cuenta verificada se CONSERVA (no se borra): existe, confirmada, sin solicitud, estado «verificado»", `${cuentaB(e)}/${confB(e)}/${solB(e)}/${estadoB(e)}`, "1/t/0/verificado");
      await capturas(p, "62-b6-continuar");
      // contraseña incorrecta: no autoriza
      await p.locator("#continuar-password").fill("ClaveEquivocada9");
      await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
      await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 });
      const tm = (await p.locator('p[role="alert"]').first().innerText()).replace(/\s+/g, " ");
      cierto("R10 contraseña equivocada: se rechaza y NO se crea la solicitud (saber el correo no basta)", /No pudimos confirmar tu identidad/.test(tm) && solB(e) === "0", tm.slice(0, 110));
      // contraseña correcta: completa; repetir (otra pestaña, mismo registro) no duplica
      await p.locator("#continuar-password").fill("ClaveRegistro1");
      await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R10 con la contraseña correcta se crea UNA solicitud y la cuenta sigue verificada", `${cuentaB(e)}/${confB(e)}/${solB(e)}/${estadoB(e)}`, "1/t/1/completado");
      await ctx.close(); }

    // R11 · B6: la respuesta de la RPC «completar» se PIERDE (la solicitud sí se creó): continuar responde ok y NO duplica
    { const e = `b6b.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B6b QA ${TAG}`, doc: docB("94") });
      const cod = await codigoB(e, m0);
      await inyectar("/rest/v1/rpc/registro_b2b_completar", "perdida", 1);
      await enviarCodigo(p, cod);
      await p.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      igual("R11 respuesta perdida: la solicitud SÍ se creó en la base aunque el navegador no lo supo", `${confB(e)}/${solB(e)}/${estadoB(e)}`, "t/1/completado");
      await p.locator("#continuar-password").fill("ClaveRegistro1");
      await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R11 continuar tras la respuesta perdida responde éxito SIN duplicar la solicitud", `${cuentaB(e)}/${solB(e)}`, "1/1");
      await ctx.close(); }

    // R12 · B6: falla la ANOTACIÓN del intento exitoso (500 real) pero Auth ya confirmó: se completa igual (la base revalida con Auth)
    { const e = `b6c.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B6c QA ${TAG}`, doc: docB("95") });
      const cod = await codigoB(e, m0);
      await inyectar("/rest/v1/rpc/registro_b2b_resolver_intento", "500", 1);
      await enviarCodigo(p, cod);
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R12 si falla anotar el intento exitoso, la solicitud se crea igual y la cuenta se conserva", `${cuentaB(e)}/${confB(e)}/${solB(e)}`, "1/t/1");
      await ctx.close(); }
    await sinFallos();

    // R13 · B5: cuatro códigos incorrectos y luego el CORRECTO y uno INCORRECTO A LA VEZ (dos peticiones HTTP reales a la MISMA Server Action, en paralelo): la cuenta verificada y su solicitud sobreviven
    for (const orden of ["correcto-primero", "incorrecto-primero"]) {
      const k = orden === "correcto-primero" ? "a" : "b"; const e = `b5${k}.${TAG}@v1.test`; const nombre = `Registro B5 ${k} QA ${TAG}`; const doc = docB(k === "a" ? "96" : "97");
      const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre, doc });
      const cod = await codigoB(e, m0);
      let idAccion = null;
      for (let i = 0; i < 4; i++) {
        await p.locator("#codigo-correo").fill(String(200000 + i));
        idAccion = await esperarAccion(p, () => p.getByRole("button", { name: "Verificar y enviar solicitud" }).click());
        await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 }); await dormir(300);
      }
      igual(`R13 (${orden}) tras 4 intentos incorrectos: cuenta presente, sin verificar, sin solicitud y 4 fallos contados por la base`, `${cuentaB(e)}/${confB(e)}/${solB(e)}/${scalar(`select fallos from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where lower(u.email) = '${e}'`)}`, "1/f/0/4");
      const datos = { tipo: "freelance", nombre, nit: doc, contacto: "", email: e, telefono: "", ciudad: "", notas: "", aceptaNotificaciones: true, tipoDocumento: "CC" };
      const peticion = (codigo) => repetirAccion(ctx, `${APP}/portal/registro`, idAccion, [{ ...datos, codigo }]);
      const lanzadas = orden === "correcto-primero" ? [peticion(cod), peticion("000000")] : [peticion("000000"), peticion(cod)];
      const [r1, r2] = await Promise.all(lanzadas);
      const resultados = [r1, r2].map((r) => (/"ok":true/.test(r.texto) ? "ok" : /Superaste los intentos/.test(r.texto) ? "agotado" : /otro intento/.test(r.texto) ? "en_curso" : /contraseña/.test(r.texto) ? "continuar" : "invalido"));
      info(`R13 (${orden}) respuestas de las dos peticiones simultáneas`, resultados.join(" · "));
      await dormir(1500);
      const sobrevive = `${cuentaB(e)}/${confB(e)}/${solB(e)}` === "1/t/1";
      const agotada = `${cuentaB(e)}/${solB(e)}` === "0/0" && resultados.includes("agotado");
      // El orden de LLEGADA al servidor de dos peticiones lanzadas a la vez no lo controla el cliente: cualquiera de las dos puede tomar el quinto y último cupo. Ambos desenlaces son correctos; lo que NUNCA puede pasar es una cuenta verificada borrada.
      info(`R13 (${orden}) desenlace observado`, sobrevive ? "el correcto tomó el cupo: cuenta verificada con su solicitud" : agotada ? "el incorrecto tomó el último cupo: registro sin verificar descartado (cinco intentos reales)" : "inesperado");
      cierto(`R13 (${orden}) invariante: o sobrevive la cuenta VERIFICADA con UNA solicitud y exactamente UN éxito, o se descarta una cuenta que NUNCA se verificó (0 solicitudes, sin éxitos); jamás una verificada borrada`,
        (sobrevive && resultados.filter((x) => x === "ok").length === 1) || (agotada && resultados.filter((x) => x === "ok").length === 0), `${cuentaB(e)}/${confB(e)}/${solB(e)}/${estadoB(e)} · ${resultados.join(",")}`);
      await ctx.close();
    }

    // R14 · B5: una limpieza/reinicio frente a una cuenta ya VERIFICADA (volver a registrar el mismo correo tras verificar) no borra nada y pide continuar o indica que ya existe
    { const e = `b5c.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 c QA ${TAG}`, doc: docB("98") });
      const cod = await codigoB(e, m0);
      await inyectar("/rest/v1/rpc/registro_b2b_completar", "500", 1);
      await enviarCodigo(p, cod);
      await p.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      await sinFallos();
      const uid = scalar(`select id from auth.users where lower(email) = '${e}'`);
      // El mismo correo vuelve a empezar el registro en otra pestaña: NO se reemplaza la cuenta verificada
      const ctx2 = await nuevoContexto(); const p2 = await ctx2.newPage();
      await p2.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await p2.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await p2.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(`Registro B5 c QA ${TAG}`);
      await p2.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await p2.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(docB("98"));
      await p2.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(e);
      await p2.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("OtraClaveNueva9");
      await p2.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("OtraClaveNueva9");
      await p2.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
      await p2.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      igual("R14 reiniciar el registro de un correo YA VERIFICADO no borra ni reemplaza la cuenta (mismo id, sigue confirmada)", `${scalar(`select id from auth.users where lower(email) = '${e}'`) === uid}/${confB(e)}/${cuentaB(e)}`, "true/t/1");
      cierto("R14 la contraseña original NO se pisa: la nueva no inicia sesión y la original sí", (await grant(e, "OtraClaveNueva9")).ok === false && (await grant(e, "ClaveRegistro1")).ok === true);
      await ctx2.close(); await ctx.close(); }

    // R15 · peticiones reales por acción con la coordinación nueva (medido en el gateway, sin sondeos ni reintentos) y reposo
    { const e = `b5d.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 d QA ${TAG}`, doc: docB("99") });
      const cod = await codigoB(e, m0);
      const resumen = (l) => { const c = {}; for (const x of l) { const k = x.ruta.split("?")[0].replace("/rest/v1/rpc/", "rpc:").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id"); c[k] = (c[k] ?? 0) + 1; } return JSON.stringify(c); };
      await limpiarRegistro();
      await p.locator("#codigo-correo").fill("000000"); await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 }); await dormir(600);
      const lm = await registro();
      info("R15 una verificación INCORRECTA: peticiones al gateway por tipo", `${lm.length} · ${resumen(lm)}`);
      cierto("R15 una verificación incorrecta cuesta como máximo 8 peticiones (3 lecturas + reservar + verificar + resolver + margen)", lm.length <= 8, String(lm.length));
      await limpiarRegistro();
      await p.locator("#codigo-correo").fill(cod); await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 }); await dormir(600);
      const lc = await registro();
      info("R15 una verificación CORRECTA con solicitud: peticiones al gateway por tipo", `${lc.length} · ${resumen(lc)}`);
      cierto("R15 una verificación correcta cuesta como máximo 10 peticiones", lc.length <= 10, String(lc.length));
      await limpiarRegistro(); await dormir(3000);
      igual("R15 en reposo (3 s) no hay peticiones", String((await registro()).length), "0");
      await ctx.close(); }

    // ══ B5 residual · verificación TARDÍA / resultado desconocido / reinicio, con GoTrue REAL ═════════════════════════════════════════════════════════════════════════════════════════
    const verifyDirecto = async (email, token) => { const r = await fetch(`${GW}/auth/v1/verify`, { method: "POST", headers: { apikey: CFG.anonKey, "content-type": "application/json" }, body: JSON.stringify({ type: "signup", email, token }) }); return { status: r.status, texto: (await r.text()).slice(0, 160) }; };
    const idDe = (email) => scalar(`select coalesce((select id::text from auth.users where lower(email) = '${email}'), 'sin cuenta')`);
    const sesionesDe = (id) => scalar(`select (select count(*) from auth.identities where user_id = '${id}') || '/' || (select count(*) from auth.sessions where user_id = '${id}')`);
    const faltaDe = (email) => scalar(`select coalesce((select fallos::text from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where lower(u.email) = '${email}'), 'sin fila')`);

    // R16 · la respuesta de verificación se PIERDE (Auth SÍ confirmó): resultado desconocido → no cuenta como intento y el registro se completa preguntando a la base
    { const e = `b5e.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 e QA ${TAG}`, doc: docB("81") });
      const cod = await codigoB(e, m0);
      await inyectar("/auth/v1/verify", "perdida", 1);
      await enviarCodigo(p, cod);
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 30000 });
      igual("R16 respuesta de verificación perdida (Auth sí confirmó): se completa; cuenta confirmada, UNA solicitud, 0 fallos contados", `${cuentaB(e)}/${confB(e)}/${solB(e)}/${faltaDe(e)}`, "1/t/1/0");
      await sinFallos(); await ctx.close(); }

    // R17 · Auth responde 500 SIN aplicar nada: resultado desconocido → no cuenta, no borra, se puede reintentar (y seis así no agotan el registro)
    { const e = `b5f.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 f QA ${TAG}`, doc: docB("82") });
      const cod = await codigoB(e, m0);
      await inyectar("/auth/v1/verify", "500", 6);
      for (let i = 0; i < 6; i++) { await p.locator("#codigo-correo").fill(cod); await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 }); await dormir(400); }
      const tx = (await p.locator('p[role="alert"]').first().innerText()).replace(/\s+/g, " ");
      cierto("R17 con Auth caído la pantalla pide reintentar (no «código inválido», no «intentos agotados»)", /No pudimos procesar/.test(tx) && !/Superaste/.test(tx), tx.slice(0, 120));
      igual("R17 seis respuestas 500: cuenta intacta, sin verificar, 0 fallos y nada en vuelo", `${cuentaB(e)}/${confB(e)}/${faltaDe(e)}/${scalar(`select r.en_vuelo from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where lower(u.email) = '${e}'`)}`, "1/f/0/0");
      await sinFallos();
      await enviarCodigo(p, cod);
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R17 al volver Auth el mismo código completa el registro", `${confB(e)}/${solB(e)}`, "t/1");
      await ctx.close(); }

    // R18 · el reinicio REEMPLAZA una cuenta sin verificar con borrado atómico en la base: nada queda colgando en Auth y el código viejo ya no sirve
    { const e = `b5g.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 g QA ${TAG}`, doc: docB("83") });
      const codViejo = await codigoB(e, m0); const idViejo = idDe(e);
      const ctx2 = await nuevoContexto(); const p2 = await ctx2.newPage(); const m1 = (await mailsB(e)).length;
      await llenarB(p2, { email: e, nombre: `Registro B5 g QA ${TAG}`, doc: docB("83") });
      const codNuevo = await codigoB(e, m1); const idNuevo = idDe(e);
      cierto("R18 el reinicio crea otra cuenta (otro id) y la anterior desapareció junto con su identidad y sesiones de Auth", idNuevo !== idViejo && idViejo !== "sin cuenta" && idNuevo !== "sin cuenta" && idDe(e) === idNuevo && scalar(`select count(*) from auth.users where id = '${idViejo}'`) === "0" && sesionesDe(idViejo) === "0/0", `${idViejo} → ${idNuevo} · ${sesionesDe(idViejo)}`);
      await enviarCodigo(p, codViejo);   // la pantalla vieja manda el código viejo
      await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 });
      igual("R18 el código de la cuenta reemplazada no confirma ni la cuenta nueva ni nada", `${confB(e)}/${solB(e)}/${idDe(e) === idNuevo}`, "f/0/true");
      await enviarCodigo(p2, codNuevo);
      await p2.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R18 el código nuevo completa el registro de la cuenta nueva", `${confB(e)}/${solB(e)}`, "t/1");
      await ctx.close(); await ctx2.close(); }

    // R19 · verificación TARDÍA real: la reserva «vence» (3 minutos lógicos) y GoTrue confirma el correo DESPUÉS (verify directo con el código correcto), luego llega el reinicio
    { const e = `b5h.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 h QA ${TAG}`, doc: docB("84") });
      const cod = await codigoB(e, m0); const id = idDe(e);
      sql(`select public.registro_b2b_reclamar_intento('${id}'); update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = '${id}'`);
      const v = await verifyDirecto(e, cod);                               // la verificación que «seguía en vuelo» completa ahora, tras vencer la reserva
      igual("R19 GoTrue confirma tarde (verify con el código correcto)", `${v.status}/${confB(e)}`, "200/t");
      const ctx2 = await nuevoContexto(); const p2 = await ctx2.newPage();
      await p2.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await p2.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await p2.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(`Registro B5 h QA ${TAG}`);
      await p2.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await p2.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(docB("84"));
      await p2.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(e);
      await p2.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("OtraClaveNueva9");
      await p2.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("OtraClaveNueva9");
      await p2.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
      await p2.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      igual("R19 el reinicio tras la confirmación tardía NO borra: mismo id, sigue confirmada, sin solicitud todavía", `${idDe(e) === id}/${confB(e)}/${solB(e)}`, "true/t/0");
      await p2.locator("#continuar-password").fill("ClaveRegistro1");
      await p2.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
      await p2.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R19 continuar con la contraseña original completa el registro (una solicitud)", `${solB(e)}/${idDe(e) === id}`, "1/true");
      await ctx.close(); await ctx2.close(); }

    // R20 · al revés: el reinicio gana la carrera (cuenta sin verificar con reserva vencida); la verificación tardía con el código viejo ya no puede confirmar nada
    { const e = `b5i.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 i QA ${TAG}`, doc: docB("85") });
      const codViejo = await codigoB(e, m0); const idViejo = idDe(e);
      sql(`select public.registro_b2b_reclamar_intento('${idViejo}'); update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = '${idViejo}'`);
      const ctx2 = await nuevoContexto(); const p2 = await ctx2.newPage(); const m1 = (await mailsB(e)).length;
      await llenarB(p2, { email: e, nombre: `Registro B5 i QA ${TAG}`, doc: docB("85") });   // reinicio con la reserva vencida: la base borra la cuenta sin verificar
      const idNuevo = idDe(e);
      const v = await verifyDirecto(e, codViejo);                                            // la verificación vieja llega tarde
      cierto("R20 el reinicio ganó (otro id) y la verificación tardía con el código viejo es rechazada por GoTrue", idNuevo !== idViejo && v.status >= 400 && confB(e) === "f", `${v.status} ${v.texto}`);
      igual("R20 la cuenta nueva sigue sin confirmar y sin solicitud (no se contaminó)", `${confB(e)}/${solB(e)}/${faltaDe(e)}`, "f/0/0");
      await ctx.close(); await ctx2.close(); }
    await sinFallos();
    await limpiarRegistro();
  }
