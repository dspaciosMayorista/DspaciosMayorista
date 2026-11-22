  // ── Datos sintéticos de esta base desechable ─────────────────────────────────────────────────────────────────────────
  sql(ficha(IDA, NOMA, "freelance") + ficha(IDB, NOMB, "freelance") + ficha(IDC, "Agencia Mar QA", "agencia") + ficha(IDX, "Xavi Minorista QA", "freelance"));
  sql("update public.agencias set rnt = 'RNT-PRUEBA-LOCAL' where tenant = 'mayorista' and coalesce(btrim(rnt), '') = ''");
  const sa = await crearU({ rol: "superadmin", nombre: "Super QA" });
  const ger = await crearU({ rol: "gerencia", nombre: "Gerente QA" });
  const adm = await crearU({ rol: "administracion", nombre: "Admin QA" });
  const ven = await crearU({ rol: "venta", nombre: "Venta QA" });
  const uA = await crearU({ rol: "freelance", nombre: NOMA, aliadoId: IDA });
  const uB = await crearU({ rol: "freelance", nombre: NOMB, aliadoId: IDB });
  const uC = await crearU({ rol: "agencia", nombre: "Agencia Mar QA", aliadoId: IDC });
  const uX = await crearU({ rol: "freelance", nombre: "Xavi Minorista QA", aliadoId: IDX, tenant: "minorista" });
  // Contrato del aliado A con su comisión: PVP 5.000.000, base 4.000.000 × 11 % = 440.000; retención 10 % = 44.000 → total a cobrar 396.000 (cálculo a mano).
  sql(`insert into public.ventas (numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, aliado_id, b2b_usuario_id, tipo_asesor, tenant) values ('${NUM}', 'Ana Gómez', 'SAN ANDRÉS', current_date + 60, 5000000, 'COP', 'confirmado', ${IDA}, '${uA.id}', 'freelance', 'mayorista');`);
  sql(`insert into public.aliados_b2b (numero_contrato, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, comision_valor, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, tenant, descontada_en_precio) values ('${NUM}', '${NOMA}', '${IDA}', 'freelance', ${IDA}, 5000000, 4000000, 0.11, 440000, 0, 0, true, 0.10, 'pendiente', 'mayorista', false);`);
  const idCom = Number(scalar(`select id from public.aliados_b2b where numero_contrato = '${NUM}'`));
  info("datos: aliados A/B/C/X, contrato y comisión", `${IDA}/${IDB}/${IDC}/${IDX} · ${NUM} · comisión id ${idCom}`);
  const aliadoDe = {}; // para las capturas y mensajes

  // ══ G1 · #98 firma + aceptación electrónica de una versión congelada ═════════════════════════════════════════════
  if (G("98")) {
    const png = PNGB(240, 90, [30, 58, 138]), shaPng = sha256(png);
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    const URLC = `${APP}/portal/comision/${NUM}`;
    // S1 · versión sin aceptar (valores a mano: comisión 440.000, retención 44.000, total 396.000)
    await pA.goto(URLC, { waitUntil: "networkidle" });
    let t = await textoPagina(pA);
    cierto("S1 la cuenta de cobro abre sin aceptar: «Versión sin aceptar» y total 396.000 (comisión 440.000 − retención 44.000)", /Versión sin aceptar/.test(t) && /396\.000/.test(t) && /440\.000/.test(t) && /44\.000/.test(t), t.replace(/\s+/g, " ").slice(0, 160));
    cierto("S1 aún no hay ninguna aceptación en la base", scalar("select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:" + idCom + "'") === "0");
    await capturas(pA, "98-cuenta-sin-aceptar");
    // S2 · el aliado sube su firma en el perfil (PNG real) → bucket privado + fila vigente con su huella
    await pA.goto(`${APP}/portal/b2b/perfil`, { waitUntil: "networkidle" });
    await pA.locator('input[type="file"]:not(#logo-aliado-archivo)').first().setInputFiles({ name: "firma.png", mimeType: "image/png", buffer: png });
    await pA.getByRole("button", { name: /Subir firma|Reemplazar firma/ }).click();
    await pA.getByText("Firma guardada.").waitFor({ timeout: 20000 });
    igual("S2 una sola firma vigente, con la huella del archivo subido", scalar(`select count(*) filter (where vigente) || '/' || bool_and(sha256 = '${shaPng}') from public.aliado_firmas where aliado_id = ${IDA}`), "1/true");
    const rutaFirma = scalar(`select storage_path from public.aliado_firmas where aliado_id = ${IDA} and vigente`);
    await capturas(pA, "98-perfil-firma");
    // S3 · acepta la versión 1: la acción real, con el id de la acción capturado de la interfaz
    await pA.goto(URLC, { waitUntil: "networkidle" });
    const btn = pA.getByRole("button", { name: "Aceptar y firmar esta versión" });
    cierto("S3 el botón de aceptar existe para el titular freelance", (await btn.count()) === 1, (await textoPagina(pA)).replace(/\s+/g, " ").slice(-500));
    await pA.locator('input[type="checkbox"]').first().check();
    ACCION.aceptar = await esperarAccion(pA, () => btn.click());
    await pA.getByText(/Aceptación electrónica — versión 1/).waitFor({ timeout: 20000 });
    const f1 = scalar(`select version || '|' || (firma_sha256 = '${shaPng}') || '|' || (length(snapshot_hash) > 0) || '|' || (aceptada_por = '${uA.id}') from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`);
    igual("S3 una aceptación: versión 1, huella de la imagen de firma, hash del snapshot y quién aceptó", f1, "1|true|true|true");
    const hash1 = scalar(`select snapshot_hash from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}' and version = 1`);
    t = await textoPagina(pA);
    cierto("S3 el documento firmado muestra versión, fecha y que NO es firma digital certificada, con el total congelado", /Aceptación electrónica — versión 1/.test(t) && /No es una firma digital certificada/.test(t) && /396\.000/.test(t), t.replace(/\s+/g, " ").slice(-260));
    const orden = await pA.evaluate(() => { const im = document.querySelector('[data-firma="aceptada"] img'); const nom = [...document.querySelectorAll('[data-firma="aceptada"] p, [data-firma="aceptada"] div')].find((e) => e.children.length === 0 && /Laura Pérez QA/.test(e.textContent ?? "") && im && e.getBoundingClientRect().top > im.getBoundingClientRect().bottom - 2); return { hayImg: !!im, cargada: !!im && im.complete && im.naturalWidth > 0, nombreDebajo: !!nom }; });
    cierto("S3 la imagen de la firma se ve (cargó) y queda ENCIMA del nombre del aliado", orden.hayImg && orden.cargada && orden.nombreDebajo, JSON.stringify(orden));
    await capturas(pA, "98-cuenta-aceptada");
    const pdf = await pA.pdf({ format: "Letter", printBackground: true }); writeFileSync(join(SALIDA, "98-cuenta-aceptada.pdf"), pdf);
    const pag = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    igual("S3 imprime en UNA hoja carta (PDF del navegador)", String(pag), "1");
    // S3b · recargar no duplica nada
    await pA.reload({ waitUntil: "networkidle" });
    igual("S3 recargar no crea otra aceptación", scalar(`select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`), "1");
    // S4 · aislamiento: B (otro aliado, misma agencia), C (agencia), X (otra agencia) y anónimo NO ven el documento ni pueden aceptar
    for (const [nombre, u] of [["B", uB], ["C(agencia)", uC], ["X(otra agencia)", uX]]) {
      const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await iniciarSesion(p, u);
      const r = await p.goto(URLC, { waitUntil: "networkidle" }); const tx = await textoPagina(p);
      cierto(`S4 ${nombre} no ve la cuenta de cobro de A (sin importes ni nombre)`, !/396\.000|440\.000|Laura Pérez QA|Aceptación electrónica/.test(tx), `${r?.status()} ${tx.replace(/\s+/g, " ").slice(0, 90)}`);
      const rp = await repetirAccion(ctx, URLC, ACCION.aceptar, [{ numero: NUM, comisionId: idCom, hash: hash1 }]);
      cierto(`S4 ${nombre}: la llamada DIRECTA a la acción de aceptar sobre el contrato de A es rechazada`, !/"ok":true/.test(rp.texto) && scalar(`select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`) === "1", `${rp.status} ${rp.texto.slice(0, 140).replace(/\s+/g, " ")}`);
      await ctx.close();
    }
    { const ctx = await nuevoContexto2(); const p = await ctx.newPage(); const r = await p.goto(URLC, { waitUntil: "networkidle" }); const tx = await textoPagina(p);
      cierto("S4 anónimo: no ve el documento", !/396\.000|Laura Pérez QA/.test(tx), `${r?.status()} ${p.url()}`); await ctx.close(); }
    // S5 · permisos de base: ni A ni B alcanzan las tablas ni el archivo de firma por la API (solo el servidor)
    for (const [nombre, u] of [["A", uA], ["B", uB]]) {
      const tk = await tokenDe(u);
      for (const tabla of ["cuenta_cobro_aceptaciones", "aliado_firmas"]) {
        const r = await rest(`${tabla}?select=*`, tk); const cuerpo = await r.text();
        cierto(`S5 ${nombre} no lee ${tabla} por la API (permiso denegado o sin filas)`, r.status === 401 || r.status === 403 || cuerpo === "[]", `${r.status} ${cuerpo.slice(0, 80)}`);
      }
      const o1 = await fetch(`${GW}/storage/v1/object/authenticated/aliado-firmas/${rutaFirma}`, { headers: { apikey: CFG.anonKey, authorization: `Bearer ${tk}` } });
      const o2 = await fetch(`${GW}/storage/v1/object/public/aliado-firmas/${rutaFirma}`);
      cierto(`S5 ${nombre} no descarga la imagen de firma del bucket (ni autenticado ni público)`, o1.status !== 200 && o2.status !== 200, `auth ${o1.status} · público ${o2.status}`);
    }
    // S6 · el personal cambia la comisión (12 %): la versión aceptada NO se altera; aparece una versión nueva SIN aceptar
    sql(`update public.aliados_b2b set pct_comision = 0.12, comision_valor = 480000 where id = ${idCom}`);
    await pA.goto(URLC, { waitUntil: "networkidle" }); t = await textoPagina(pA);
    cierto("S6 tras el cambio: la versión nueva (432.000 = 480.000 − 48.000) sale SIN aceptar", /Versión sin aceptar/.test(t) && /432\.000/.test(t), t.replace(/\s+/g, " ").slice(0, 150));
    cierto("S6 y ofrece la versión aceptada anterior", /versión 1|versi[oó]n aceptada/i.test(t) || (await pA.locator('a[href*="v=1"]').count()) > 0, t.replace(/\s+/g, " ").slice(-200));
    await capturas(pA, "98-cuenta-version-nueva");
    await pA.goto(`${URLC}?v=1`, { waitUntil: "networkidle" }); t = await textoPagina(pA);
    cierto("S6 la versión 1 sigue abriendo con SUS importes (396.000) y su firma, aunque la comisión viva ya cambió", /396\.000/.test(t) && !/432\.000/.test(t) && /Aceptación electrónica — versión 1/.test(t), t.replace(/\s+/g, " ").slice(-200));
    // S7 · aceptación vieja (hash de la versión 1) con la comisión ya cambiada: rechazada, nada se escribe
    const rv = await repetirAccion(ctxA, URLC, ACCION.aceptar, [{ numero: NUM, comisionId: idCom, hash: hash1 }]);
    cierto("S7 aceptar con el hash de una versión vieja (documento ya cambiado) es rechazado y no escribe", !/"ok":true/.test(rv.texto) && scalar(`select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`) === "1", `${rv.status} ${rv.texto.slice(0, 160).replace(/\s+/g, " ")}`);
    // S8 · acepta la versión 2 desde la pantalla; se conservan las dos
    await pA.goto(URLC, { waitUntil: "networkidle" });
    await pA.locator('input[type="checkbox"]').first().check();
    await pA.getByRole("button", { name: "Aceptar y firmar esta versión" }).click();
    await pA.getByText(/Aceptación electrónica — versión 2/).waitFor({ timeout: 20000 });
    igual("S8 dos versiones aceptadas conservadas (1 y 2), sin sobrescribir la primera", scalar(`select string_agg(version::text, ',' order by version) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`), "1,2");
    const hash2 = scalar(`select snapshot_hash from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}' and version = 2`);
    cierto("S8 los hashes de v1 y v2 son distintos", hash1 !== hash2 && hash1.length > 0 && hash2.length > 0);
    const rr = await repetirAccion(ctxA, URLC, ACCION.aceptar, [{ numero: NUM, comisionId: idCom, hash: hash2 }]);
    igual("S8 repetir la aceptación de la versión vigente es idempotente (no crea la 3)", scalar(`select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`), "2");
    info("S8 respuesta de la repetición", rr.texto.slice(0, 100).replace(/\s+/g, " "));
    // S9 · inmutabilidad en la base (incluso para un superusuario de la base)
    let upd = "sin error", del = "sin error";
    try { sql(`update public.cuenta_cobro_aceptaciones set version = 9 where clave = 'ab:${idCom}' and version = 1`); } catch (e) { upd = "rechazado"; }
    try { sql(`delete from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`); } catch (e) { del = "rechazado"; }
    igual("S9 UPDATE y DELETE de una aceptación quedan rechazados por la base", `${upd}/${del}`, "rechazado/rechazado");
    // Peticiones por acción (gateway)
    await limpiarRegistro(); await pA.goto(URLC, { waitUntil: "networkidle" });
    info("P1 peticiones al abrir la cuenta de cobro (gateway)", resumen((await registro())));
    await limpiarRegistro(); await dormir(4000); igual("P1 en reposo (4 s) no hay peticiones", String((await registro()).length), "0");
    await ctxA.close();
  }
