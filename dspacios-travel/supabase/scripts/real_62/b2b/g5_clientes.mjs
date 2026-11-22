  // ══ G5 · #76/#77 clientes del aliado: propiedad, aislamiento y acceso del personal; el CRM central no se toca ═══════════════════════════
  if (G("7677")) {
    const conteoCrm = () => scalar("select (select count(*) from public.crm_contactos) || '/' || (select count(*) from public.personas)");
    const antes = conteoCrm();
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    await pA.goto(`${APP}/portal/b2b/clientes`, { waitUntil: "networkidle" });
    await capturas(pA, "7677-clientes-vacio");
    await pA.getByRole("button", { name: "Agregar cliente" }).first().click();
    await pA.locator("#nom-n").fill(`QA Cliente de Laura ${TAG}`);
    await pA.locator("#tel-n").fill("3105550101");
    await pA.locator("#em-n").fill(`cliente.${TAG}@qa.test`);
    await pA.locator('input[type="checkbox"]').first().check();
    ACCION.cliente = await esperarAccion(pA, () => pA.getByRole("button", { name: "Guardar cliente" }).first().click());
    await pA.getByText(`QA Cliente de Laura ${TAG}`).first().waitFor({ timeout: 20000 });
    const fila = scalar(`select aliado_id || '|' || tenant || '|' || autorizacion_datos || '|' || coalesce(creado_por::text, '') from public.aliado_clientes where nombre = 'QA Cliente de Laura ${TAG}'`);
    igual("C1 el cliente queda asociado al aliado A (por id), en su agencia, con la autorización registrada y quién lo creó", fila, `${IDA}|mayorista|true|${uA.id}`);
    const idCli = scalar(`select id from public.aliado_clientes where nombre = 'QA Cliente de Laura ${TAG}'`);
    igual("C1 el CRM central NO se tocó (crm_contactos / personas sin filas nuevas)", conteoCrm(), antes);
    await capturas(pA, "7677-clientes-lista");
    // Aislamiento: B y X no lo ven; la API no expone la tabla; B no puede editar por llamada directa
    for (const [nombre, u] of [["B", uB], ["X(otra agencia)", uX]]) {
      const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await iniciarSesion(p, u);
      await p.goto(`${APP}/portal/b2b/clientes`, { waitUntil: "networkidle" }); const tx = await textoPagina(p);
      cierto(`C2 ${nombre} no ve al cliente de A`, !tx.includes(`QA Cliente de Laura ${TAG}`) && !tx.includes("3105550101"), tx.replace(/\s+/g, " ").slice(0, 100));
      if (nombre === "B") {
        const tk = await tokenDe(u); const r = await rest("aliado_clientes?select=*", tk); const cuerpo = await r.text();
        cierto("C2 B no lee la tabla por la API (permiso denegado o sin filas)", r.status === 401 || r.status === 403 || cuerpo === "[]", `${r.status} ${cuerpo.slice(0, 70)}`);
        const rp = await repetirAccion(ctx, `${APP}/portal/b2b/clientes`, ACCION.cliente, [{ id: Number(idCli), nombre: "Hackeado por B", telefono: "1", autorizacion: true }]);
        cierto("C2 B no puede EDITAR el cliente de A con una llamada directa a la acción (nada cambia)", !/"ok":true/.test(rp.texto) && scalar(`select nombre from public.aliado_clientes where id = ${idCli}`) === `QA Cliente de Laura ${TAG}`, `${rp.status} ${rp.texto.slice(0, 150).replace(/\s+/g, " ")}`);
      }
      await ctx.close();
    }
    // Personal: lo consulta en el CRM (solo lectura), por aliado; venta no
    for (const [nombre, u, debeVer] of [["superadmin", sa, true], ["gerencia", ger, true], ["administración", adm, true], ["venta", ven, false]]) {
      const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await iniciarSesion(p, u);
      await p.goto(`${APP}/crm/clientes-aliados`, { waitUntil: "networkidle" });
      const sel = p.locator("select").first();
      if (debeVer && (await sel.count()) > 0) {
        const opciones = await sel.locator("option").allInnerTexts();
        const op = opciones.find((t) => t.includes(NOMA) || t.includes(`Gómez QA ${TAG}`));
        if (op) await sel.selectOption({ label: op });
        await p.getByRole("button", { name: "Ver", exact: true }).click();
      }
      await dormir(800); const tx = await textoPagina(p);
      if (debeVer) cierto(`C3 ${nombre} (personal) ve al cliente del aliado en el CRM`, tx.includes(`QA Cliente de Laura ${TAG}`), tx.replace(/\s+/g, " ").slice(0, 160));
      else cierto(`C3 ${nombre} NO accede a los clientes de aliados`, !tx.includes(`QA Cliente de Laura ${TAG}`), tx.replace(/\s+/g, " ").slice(0, 120));
      if (nombre === "gerencia") await capturas(p, "7677-crm-clientes-aliados");
      await ctx.close();
    }
    // Contratos antiguos sin id de aliado (solo el nombre en texto): no se listan ni se les asigna nada por inferencia
    sql(`insert into public.ventas (numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, tipo_asesor, tenant, freelance_nombre) values ('DTM-7${String(Date.now()).slice(-6)}', 'Cliente Legado Solo Nombre ${TAG}', 'CARTAGENA', current_date + 60, 1000000, 'COP', 'confirmado', 'freelance', 'mayorista', '${NOMA}');`);
    await pA.goto(`${APP}/portal/b2b/clientes`, { waitUntil: "networkidle" });
    const tl = await textoPagina(pA);
    cierto("C4 un contrato antiguo que solo nombra al aliado en texto NO se lista como cliente suyo (sin asignación por inferencia)", !tl.includes(`Cliente Legado Solo Nombre ${TAG}`));
    igual("C4 y no se escribió ninguna fila de cliente por ese contrato", scalar(`select count(*) from public.aliado_clientes where nombre like 'Cliente Legado%'`), "0");
    await limpiarRegistro(); await pA.reload({ waitUntil: "networkidle" });
    info("P5 peticiones al abrir Mis clientes", resumen(await registro()).slice(0, 420));
    await limpiarRegistro(); await dormir(4000); igual("P5 en reposo (4 s) no hay peticiones", String((await registro()).length), "0");
    await ctxA.close();
  }
