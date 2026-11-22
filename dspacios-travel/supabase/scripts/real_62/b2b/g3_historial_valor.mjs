  // ══ G3 · #25 corrección por el personal + historial propio · #84 valor actual del contrato ═════════════════════════════════════════
  if (G("25")) {
    // El personal (gerencia) corrige teléfono y nombre desde Aliados; administración NO puede
    const ctxG = await nuevoContexto2(); const pG = await ctxG.newPage(); await iniciarSesion(pG, ger);
    const corregir = async (page, { tel, nombre }) => {
      await page.goto(`${APP}/dashboard/aliados`, { waitUntil: "networkidle" });
      await page.locator("tr", { hasText: scalar(`select nombre from public.aliados where id = ${IDA}`) }).first().locator("button").first().click();
      await page.getByRole("button", { name: "Corregir", exact: true }).first().click();
      if (tel) await page.locator(`#cor-tel-${IDA}`).fill(tel);
      if (nombre) { await page.locator(`#cor-nombre-${IDA}`).fill(nombre); await page.locator('label:has-text("Entiendo que el nuevo nombre") input[type="checkbox"]').check(); }
      await page.getByRole("button", { name: "Guardar corrección" }).click();
      await page.locator('[role="status"],[role="alert"]').filter({ hasText: /.+/ }).first().waitFor({ timeout: 20000 });
      return (await page.locator('[role="status"],[role="alert"]').first().innerText()).trim();
    };
    const msgAdm = await (async () => { const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await iniciarSesion(p, adm); const m = await corregir(p, { tel: "+57 300 000 0000" }); await ctx.close(); return m; })();
    igual("H1 administración NO puede corregir la ficha: el teléfono no cambia", scalar(`select telefono from public.aliados where id = ${IDA}`), "+573001112233");
    info("H1 mensaje a administración", msgAdm.slice(0, 120));
    const msgG = await corregir(pG, { tel: "+573009998888", nombre: `Laura Pérez Gómez QA ${TAG}` });
    igual("H1 gerencia corrige teléfono y nombre (se guardan)", scalar(`select telefono || '|' || nombre from public.aliados where id = ${IDA}`), `+573009998888|Laura Pérez Gómez QA ${TAG}`);
    const aud = scalar(`select count(*) || '|' || bool_and(actor_email = '${ger.email}') || '|' || bool_and(actor_rol = 'gerencia') from public.auditoria where tabla = 'aliados' and registro_id = '${IDA}' and accion = 'UPDATE' and cambios::text like '%telefono%'`);
    igual("H1 la auditoría registra la corrección con el actor real (gerencia) y los campos", aud.endsWith("|true|true") ? "con actor" : aud, "con actor");
    info("H1 mensaje a gerencia", msgG.slice(0, 120));
    await capturas(pG, "25-correccion-gerencia");
    // Historial propio del aliado (con la cuenta bancaria enmascarada)
    sql(`update public.aliados set numero_cuenta = '1234567890' where id = ${IDA}`);
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    await pA.goto(`${APP}/portal/b2b/perfil`, { waitUntil: "networkidle" });
    const th = await textoPagina(pA);
    cierto("H2 el aliado ve SU historial: aparecen el teléfono y el nombre corregidos", /Historial/i.test(th) && /9998888|Laura Pérez Gómez QA/.test(th), th.replace(/\s+/g, " ").slice(-300));
    cierto("H2 la cuenta bancaria se ve enmascarada (****7890) y nunca completa", /\*{2,}7890/.test(th) && !/1234567890/.test(th), th.replace(/\s+/g, " ").slice(-200));
    cierto("H2 no muestra quién del personal hizo el cambio ni el correo del actor", !th.includes(ger.email) && !/Gerente QA/.test(th));
    await capturas(pA, "25-perfil-historial");
    { const ctxB = await nuevoContexto2(); const pB = await ctxB.newPage(); await iniciarSesion(pB, uB);
      await pB.goto(`${APP}/portal/b2b/perfil`, { waitUntil: "networkidle" }); const tb = await textoPagina(pB);
      cierto("H2 aislamiento: B no ve nada del historial de A (ni teléfono, ni nombre, ni cuenta)", !/9998888|Laura Pérez Gómez|7890/.test(tb), tb.replace(/\s+/g, " ").slice(-160)); await ctxB.close(); }
    // Un cambio hecho en el portal por el propio aliado sin aprobación
    await pA.locator("#ed-telefono, input[name='telefono']").first().waitFor({ timeout: 5000 }).catch(() => undefined);
    await ctxG.close(); await ctxA.close();
  }

  if (G("84")) {
    // #84 — valor ACTUAL del contrato con enlace; el cotizado queda como histórico. Marcadores de costo para probar que no se filtran.
    sql(`insert into public.ventas (numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, aliado_id, tipo_asesor, tenant, costo_hotel, costo_aereo) values ('${NUM84}', 'Cliente Uno', 'SAN ANDRÉS', current_date + 60, 4700000, 'COP', 'confirmado', ${IDA}, 'freelance', 'mayorista', 3217654, 813579);`);
    sql(`insert into public.cotizaciones (tenant, codigo, modo, estado, numero_contrato, creado_por, payload, precio_venta, moneda, destino, cliente, fecha_salida, vigencia_hasta, tipo, pax) values ('mayorista', 'COT-84-${TAG}', 'simple', 'convertida', '${NUM84}', 'interno@dspacios.test', '{"b2bAsistido":{"aliado_id":${IDA},"modo_compra":"neta","total_exigible":4520000}}', 5000000, 'COP', 'SAN ANDRÉS', 'Cliente Uno', current_date + 60, current_date + 30, 'tarifario', 2);`);
    const huellaVenta = () => scalar(`select md5(v::text) from public.ventas v where numero_contrato = '${NUM84}'`);
    const antes = huellaVenta();
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    await pA.goto(`${APP}/portal/b2b/cotizaciones?vista=asistidas`, { waitUntil: "networkidle" });
    let t = await textoPagina(pA); const html = await pA.content();
    cierto("V1 muestra «Valor del contrato» ACTUAL ($ 4.700.000) y, aparte, «Valor cotizado» 4.520.000 como histórico", /Valor del contrato\s*\$\s?4\.700\.000/i.test(t.replace(/\s+/g, " ")) && /Valor cotizado:[^$]*\$\s?4\.520\.000/i.test(t.replace(/\s+/g, " ")), t.replace(/\s+/g, " ").slice(-260));
    cierto("V1 enlaza al contrato", (await pA.locator(`a[href*="#contrato-${NUM84}"]`).count()) >= 1);
    cierto("V1 ninguna columna de costo llega a la página (3.217.654 / 813.579 no aparecen)", !/3\.217\.654|813\.579|3217654|813579/.test(html));
    await capturas(pA, "84-cotizaciones-asistidas");
    sql(`update public.ventas set precio_venta = 1950000 where numero_contrato = '${NUM84}'`);
    await pA.reload({ waitUntil: "networkidle" }); t = (await textoPagina(pA)).replace(/\s+/g, " ");
    cierto("V1 una edición interna del contrato se ve en la carga siguiente (1.950.000) y el valor cotizado NO se altera (4.520.000)", /Valor del contrato\s*\$\s?1\.950\.000/i.test(t) && /Valor cotizado:[^$]*\$\s?4\.520\.000/i.test(t), t.slice(-240));
    igual("V2 los hechos financieros no se tocaron al mostrarlo: la cotización conserva 5.000.000 y el contrato solo cambió por la edición interna", scalar(`select (select precio_venta from public.cotizaciones where numero_contrato = '${NUM84}') || '|' || (select precio_venta from public.ventas where numero_contrato = '${NUM84}')`), "5000000.00|1950000.00");
    { const ctxB = await nuevoContexto2(); const pB = await ctxB.newPage(); await iniciarSesion(pB, uB);
      await pB.goto(`${APP}/portal/b2b/cotizaciones?vista=asistidas`, { waitUntil: "networkidle" }); const tb = (await textoPagina(pB)).replace(/\s+/g, " ");
      cierto("V3 B no ve el contrato de A ni su valor", !/DTM-9|1\.950\.000|4\.520\.000|SAN ANDRÉS/.test(tb), tb.slice(-160)); await ctxB.close(); }
    await limpiarRegistro(); await pA.reload({ waitUntil: "networkidle" });
    info("P3 peticiones al abrir la lista de cotizaciones asistidas", resumen(await registro()).slice(0, 500));
    await limpiarRegistro(); await dormir(4000); igual("P3 en reposo (4 s) no hay peticiones", String((await registro()).length), "0");
    void antes;
    await ctxA.close();
  }
