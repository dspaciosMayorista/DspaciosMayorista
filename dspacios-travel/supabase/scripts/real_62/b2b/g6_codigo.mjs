  // ══ G6 · #62 verificación del correo POR CÓDIGO antes de pedir la aprobación B2B (Auth real + correo en Mailpit local) ═════════════════════
  if (G("62")) {
    globalThis.__huellaExistentes = scalar("select md5(string_agg(id::text || '|' || coalesce(email_confirmed_at::text, 'null'), ',' order by id)) from auth.users where email not like 'reg%'");
    const mails = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((t) => t.Address === para)).sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
    async function codigoDe(para, antes = 0) {
      for (let i = 0; i < 40; i++) {
        const l = await mails(para);
        if (l.length > antes) { const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json(); const m = ((c.Text ?? "") + " " + (c.HTML ?? "")).match(/\b(\d{6})\b/); if (m) return m[1]; }
        await dormir(300);
      }
      return null;
    }
    const llenarRegistro = async (page, { email, nombre, doc }) => {
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
    const solicitudes = (email) => scalar(`select count(*) from public.b2b_solicitudes where lower(email) = '${email}'`);
    const confirmado = (email) => scalar(`select coalesce(email_confirmed_at is not null, false) from auth.users where lower(email) = '${email}'`);
    // R1 · flujo correcto
    const e1 = `reg1.${TAG}@v1.test`;
    const ctx = await nuevoContexto2(); const p = await ctx.newPage();
    const m0 = (await mails(e1)).length;
    await llenarRegistro(p, { email: e1, nombre: `Registro QA ${TAG}`, doc: `90${String(Date.now()).slice(-7)}` });
    const codigo = await codigoDe(e1, m0);
    cierto("R1 el correo con el código de 6 dígitos llegó SOLO a la captura local (Mailpit)", /^\d{6}$/.test(codigo ?? ""), String(codigo));
    igual("R1 antes del código: NO existe solicitud de aprobación y el correo sigue sin confirmar", solicitudes(e1) + "/" + confirmado(e1), "0/f");
    const tcod = (await textoPagina(p)).replace(/\s+/g, " ");
    cierto("R1 el reenvío queda en espera de 60 s (temporizador local, sin petición)", /Reenviar código en \d+ s/.test(tcod), tcod.slice(-160));
    await capturas(p, "62-paso-codigo");
    // R1b · ENMIENDA ADL-040: un registro NUEVO no inicia sesión hasta verificar el código (Auth real: email_not_confirmed); tras verificar, sí
    const g = await grant(e1, "ClaveRegistro1");
    cierto("R1b registro nuevo SIN verificar: Auth rechaza el inicio de sesión (email_not_confirmed) — verificar por código es previo al login (ADL-040)", g.ok === false && /email_not_confirmed/.test(JSON.stringify(g.json)), `${g.ok ? 200 : "≠200"} ${JSON.stringify(g.json).slice(0, 120)}`);
    // R2 · código incorrecto: se rechaza, sigue sin solicitud
    await p.locator("#codigo-correo").fill("000000");
    await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
    await p.getByRole("alert").first().waitFor({ timeout: 20000 });
    cierto("R2 un código incorrecto se rechaza con mensaje y no crea la solicitud", solicitudes(e1) === "0", (await p.getByRole("alert").first().innerText()).slice(0, 100));
    // R3 · código correcto: ahora sí existe la solicitud y el correo queda confirmado
    await p.locator("#codigo-correo").fill(codigo);
    await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
    await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
    igual("R3 con el código correcto: la solicitud de aprobación se crea y el correo queda verificado en Auth", solicitudes(e1) + "/" + confirmado(e1), "1/t");
    await capturas(p, "62-solicitud-enviada");
    const g3 = await grant(e1, "ClaveRegistro1");
    cierto("R3b tras verificar el código, el inicio de sesión en Auth funciona", g3.ok === true, JSON.stringify(g3.json).slice(0, 80));
    // R3c · verificada y con la solicitud pendiente: entrar por la pantalla NO da acceso a datos del portal (la cuenta sigue inactiva hasta la aprobación)
    { const pl = await ctx.newPage(); await pl.goto(`${APP}/login`, { waitUntil: "networkidle" }); await pl.fill("#email", e1); await pl.fill("#password", "ClaveRegistro1"); await pl.click('form button[type="submit"]'); await dormir(5000);
      const tl = (await textoPagina(pl)).replace(/\s+/g, " "); const url = new URL(pl.url()).pathname + new URL(pl.url()).search;
      cierto("R3c verificada pero pendiente de aprobación: no ve cotizaciones, ventas ni cartera del portal", !/Mis ventas|Cartera|Cotizaciones/.test(tl.replace(/Aún no tienes/g, "")) || /pendiente|aprobaci|inactiv/i.test(tl), `${url} :: ${tl.slice(0, 200)}`);
      info("R3c destino y mensaje al entrar con la cuenta pendiente", `${url} :: ${tl.slice(0, 160)}`); await capturas(pl, "62-pendiente-login"); }
    await ctx.close();
    // R4 · tope de intentos: 5 códigos equivocados bloquean el código correcto (nueva cuenta)
    const e2 = `reg2.${TAG}@v1.test`;
    const ctx2 = await nuevoContexto2(); const p2 = await ctx2.newPage(); const mm = (await mails(e2)).length;
    await llenarRegistro(p2, { email: e2, nombre: `Registro Tope QA ${TAG}`, doc: `91${String(Date.now()).slice(-7)}` });
    const cod2 = await codigoDe(e2, mm);
    for (let i = 0; i < 5; i++) { await p2.locator("#codigo-correo").fill(String(100000 + i)); await p2.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p2.getByRole("alert").first().waitFor({ timeout: 20000 }); await dormir(400); }
    await p2.locator("#codigo-correo").fill(cod2 ?? "123456");
    await p2.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
    await dormir(2500);
    cierto("R4 tras 5 intentos fallidos, ni el código correcto crea la solicitud ni confirma el correo (tope de intentos)", solicitudes(e2) === "0" && confirmado(e2) !== "t", `solicitudes=${solicitudes(e2)} confirmado=${confirmado(e2) || "(cuenta pendiente retirada)"}`);
    // R6 · volver más tarde con el mismo correo: ¿se puede reanudar (código nuevo) o queda atrapado?
    { const ctx3 = await nuevoContexto2(); const p3 = await ctx3.newPage(); const m3 = (await mails(e2)).length;
      let reanuda = "no"; try { await llenarRegistro(p3, { email: e2, nombre: `Registro Tope QA ${TAG}`, doc: `91${String(Date.now()).slice(-7)}` }); reanuda = "sí"; } catch { reanuda = "no: " + (await textoPagina(p3)).replace(/\s+/g, " ").slice(-160); }
      cierto("R6 volver a registrar el mismo correo tras el tope permite empezar de nuevo (se envía un código nuevo)", reanuda === "sí" && (await codigoDe(e2, m3)) !== null, reanuda); await ctx3.close(); }
    const t2 = (await textoPagina(p2)).replace(/\s+/g, " ");
    info("R4 mensaje tras el tope", t2.slice(-200));
    await ctx2.close();
    // R5 · un usuario ya existente NO se bloquea: los creados con email_confirm=true siguen entrando (usuarios de las secciones anteriores)
    const gx = await grant(uA.email, uA.clave);
    cierto("R5 un usuario existente (correo ya confirmado) inicia sesión igual que antes", gx.ok === true);
    for (const [n, u] of [["staff (gerencia)", ger], ["aliado B", uB], ["agencia C", uC]]) { const gg = await grant(u.email, u.clave); cierto(`R5 ${n}: usuario existente, mismo inicio de sesión de siempre`, gg.ok === true); }
    const huellaExistentes = () => scalar("select md5(string_agg(id::text || '|' || coalesce(email_confirmed_at::text, 'null'), ',' order by id)) from auth.users where email not like 'reg%'");
    cierto("R5 sin retroactividad: la verificación de los usuarios ya existentes no se tocó durante el recorrido (huella estable)", huellaExistentes() === (globalThis.__huellaExistentes ?? huellaExistentes()), huellaExistentes());
    await limpiarRegistro(); await dormir(3000); igual("P6 en reposo (3 s) no hay peticiones", String((await registro()).length), "0");
  }
  // R7 · abandonó el registro tras recibir el código (no llegó al tope) y vuelve con el MISMO correo: ¿puede continuar o queda atrapado? (con Auth real, sin iniciar sesión mientras no verifique)
  if (G("62")) {
    const mails7 = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((t) => t.Address === para)).sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
    const e3 = `reg3.${TAG}@v1.test`; const doc3 = `92${String(Date.now()).slice(-7)}`;
    const campos = async (page) => {
      await page.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await page.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await page.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(`Registro Reanuda QA ${TAG}`);
      await page.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await page.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(doc3);
      await page.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(e3);
      await page.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
    };
    const c1 = await nuevoContexto2(); const q1 = await c1.newPage(); await campos(q1); await q1.getByTestId("paso-codigo").waitFor({ timeout: 25000 }); await c1.close(); // cierra sin verificar
    const tReg2 = Date.now(); const c2 = await nuevoContexto2(); const q2 = await c2.newPage(); await campos(q2);
    await dormir(4000); const t7 = (await textoPagina(q2)).replace(/\s+/g, " ");
    const llegoCodigo = (await q2.getByTestId("paso-codigo").count()) > 0;
    cierto("R7 quien abandonó tras recibir el código y vuelve con el mismo correo puede continuar (se le pide un código nuevo), no queda atrapado en «ya existe una cuenta»", llegoCodigo, t7.slice(-220));
    await capturas(q2, "62-reanudar-registro");
    // R8 · reanudado: con el código NUEVO se verifica y se crea UNA solicitud
    const sol3 = () => scalar(`select count(*) from public.b2b_solicitudes where lower(email) = '${e3}'`);
    const conf3 = () => scalar(`select coalesce(email_confirmed_at is not null, false) from auth.users where lower(email) = '${e3}'`);
    const cod7 = await (async () => { for (let i = 0; i < 80; i++) { const l = (await mails7(e3)).filter((m) => new Date(m.Created).getTime() >= tReg2 - 2000); if (l.length >= 1) { const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json(); const m = ((c.Text ?? "") + " " + (c.HTML ?? "")).match(/\b(\d{6})\b/); if (m) return m[1]; } await dormir(300); } return null; })();
    igual("R8 antes del código nuevo, la cuenta abandonada sigue sin verificar y sin solicitud", sol3() + "/" + conf3(), "0/f");
    info("R8 código usado y correos recibidos", `${cod7} · ${(await mails7(e3)).length} correos`);
    await q2.locator("#codigo-correo").fill(cod7 ?? "000000"); await q2.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
    await q2.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 }).catch(() => undefined);
    const t8 = (await textoPagina(q2)).replace(/\s+/g, " "); info("R8 pantalla tras enviar el código nuevo", t8.slice(-220));
    igual("R8 reanudado con el código nuevo: se verifica y se crea UNA solicitud", sol3() + "/" + conf3(), "1/t");
    cierto("R8 ya verificada, entra a Auth (login permitido tras verificar)", (await grant(e3, "ClaveRegistro1")).ok === true);
    // R9 · interrupción DESPUÉS de verificar y ANTES de la solicitud (se simula borrando la fila): volver con el mismo correo no atrapa a la persona
    sql(`delete from public.b2b_solicitudes where lower(email) = '${e3}'`);
    const c4 = await nuevoContexto2(); const q4 = await c4.newPage(); await campos(q4); await dormir(4000);
    const t9 = (await textoPagina(q4)).replace(/\s+/g, " ");
    const salida9 = (await q4.getByTestId("paso-codigo").count()) > 0 ? "pide un código nuevo" : /Revisaremos tu registro/.test(t9) ? "crea la solicitud" : "mensaje: " + t9.slice(-140);
    info("R9 cuenta verificada sin solicitud, vuelve con el mismo correo", salida9);
    info("R9 LIMITACIÓN observada: cuenta verificada SIN solicitud (interrupción simulada entre verificar y crearla) — el registro dice «Ya existe una cuenta, inicia sesión» y no reanuda; se resuelve con ayuda del personal", salida9);
    await c4.close(); await c2.close();
  }
