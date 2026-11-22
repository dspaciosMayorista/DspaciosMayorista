  // ══ G4 · #78 «Solicitar contrato» (aparte de guardar): evento persistido, aviso DENTRO de la plataforma, sin mensajes externos ═════════════
  if (G("78")) {
    const mailTotal = async () => (await (await fetch(`${MAIL}/api/v1/messages`)).json()).total ?? 0;
    const insCot = (codigo) => scalar(`insert into public.cotizaciones (tenant, codigo, modo, estado, creado_por, precio_venta, moneda, destino, cliente, fecha_salida, fecha_regreso, vigencia_hasta, tipo, pax, payload, share_token) values ('mayorista', '${codigo}-${TAG}', 'simple', 'abierta', '${uA.email}', 1800000, 'COP', 'CARTAGENA', 'Ana Gómez', current_date + 60, current_date + 64, current_date + 30, 'tarifario', 2, '{}', gen_random_uuid()) returning id`).split("\n")[0];
    const idC1 = Number(insCot("COT-78"));
    sql(`update public.config_solicitudes set emails = '${adm.email}' where id = 1`);
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    const eventos = (id) => scalar(`select count(*) || '/' || coalesce(max(estado), '-') || '/' || coalesce(max(notificados), -1) from public.cotizacion_solicitudes_contrato where cotizacion_id = ${id}`);
    const avisos = (id, u) => scalar(`select count(*) from public.avisos where cotizacion_id = ${id} and tipo = 'solicitud_contrato'${u ? ` and usuario_id = '${u.id}'` : ""}`);
    igual("N1 la cotización existe (guardada) y NO hay ningún evento de solicitud: guardar no es solicitar", eventos(idC1), "0/-/-1");
    await pA.goto(`${APP}/portal/b2b/cotizaciones`, { waitUntil: "networkidle" });
    const boton = pA.getByRole("button", { name: "Solicitar contrato" });
    cierto("N1 la lista ofrece «Solicitar contrato» sobre la cotización vigente", (await boton.count()) >= 1);
    await capturas(pA, "78-lista-antes");
    const m0 = await mailTotal();
    await limpiarRegistro();
    ACCION.solicitar = await esperarAccion(pA, () => boton.first().click());
    await pA.getByText(/Contrato solicitado/).first().waitFor({ timeout: 20000 });
    igual("N2 se persiste UN evento «solicitada», con 1 responsable notificado (el configurado)", eventos(idC1), "1/solicitada/1");
    igual("N2 el aviso va SOLO al responsable configurado (administración), dentro de la plataforma", avisos(idC1, adm) + "/" + avisos(idC1, ger) + "/" + avisos(idC1, sa), "1/0/0");
    igual("N2 NO se envió ningún correo ni mensaje externo (Mailpit sin mensajes nuevos)", String((await mailTotal()) - m0), "0");
    info("N2 peticiones de la acción (gateway)", resumen(await registro()).slice(0, 420));
    await capturas(pA, "78-lista-solicitada");
    // Repetir: idempotente (mismo estado de la cotización → no duplica evento ni aviso)
    await pA.reload({ waitUntil: "networkidle" });
    await pA.getByRole("button", { name: "Volver a solicitar" }).first().click();
    await dormir(2500);
    igual("N3 repetir la solicitud sin cambios es idempotente: sigue 1 evento y 1 aviso", eventos(idC1) + " · " + avisos(idC1), "1/solicitada/1 · 1");
    // Aislamiento: B llama DIRECTO a la acción sobre la cotización de A
    { const ctxB = await nuevoContexto2(); const pB = await ctxB.newPage(); await iniciarSesion(pB, uB);
      const rp = await repetirAccion(ctxB, `${APP}/portal/b2b/cotizaciones`, ACCION.solicitar, [idC1]);
      cierto("N4 B no puede solicitar el contrato de la cotización de A (llamada directa rechazada, nada se escribe)", !/"ok":true/.test(rp.texto) && eventos(idC1) === "1/solicitada/1" && avisos(idC1) === "1", `${rp.status} ${rp.texto.slice(0, 150).replace(/\s+/g, " ")}`);
      await pB.goto(`${APP}/portal/b2b/cotizaciones`, { waitUntil: "networkidle" }); const tb = await textoPagina(pB);
      cierto("N4 B no ve ni el botón ni la cotización de A", !/COT-78/.test(tb) && (await pB.getByRole("button", { name: /solicitar contrato/i }).count()) === 0);
      await ctxB.close(); }
    // Sin responsables configurados: se guarda igual y se dice la verdad (nadie fue avisado)
    sql("update public.config_solicitudes set emails = null where id = 1");
    const idC2 = Number(insCot("COT-78b"));
    await pA.goto(`${APP}/portal/b2b/cotizaciones`, { waitUntil: "networkidle" });
    await pA.locator("tr", { hasText: `COT-78b-${TAG}` }).getByRole("button", { name: "Solicitar contrato" }).click();
    await pA.getByText(/responsables/).first().waitFor({ timeout: 20000 });
    igual("N5 sin responsables configurados: evento guardado con 0 notificados y ningún aviso inventado", eventos(idC2) + " · " + avisos(idC2), "1/solicitada/0 · 0");
    const tn = (await textoPagina(pA)).replace(/\s+/g, " ");
    cierto("N5 la pantalla dice honestamente que aún no hay responsables configurados", /aún no hay responsables configurados/.test(tn), tn.slice(-220));
    await capturas(pA, "78-lista-sin-responsables");
    await limpiarRegistro(); await dormir(4000); igual("P4 en reposo (4 s) no hay peticiones", String((await registro()).length), "0");
    sql(`update public.config_solicitudes set emails = '${adm.email}' where id = 1`);
    await ctxA.close();
  }
