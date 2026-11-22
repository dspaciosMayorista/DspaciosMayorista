  // ══ G2 · #32 logo del aliado en SUS cotizaciones (emisor legal intacto, archivo privado servido por rutas autorizadas) ══════════════
  if (G("32")) {
    const logoPng = PNGB(320, 110, [124, 45, 18]), shaLogo = sha256(logoPng);
    const crearCot = async (page, { cliente, doc, aliado }) => {
      await llenarCotizacion(page, { cliente, doc, tipoAliado: "freelance", aliado });
      await page.locator(`${X("Base no comisionable (BNC) *")}/following-sibling::input[1]`).fill("0");
      await Promise.all([page.waitForURL(/\/dashboard\/cotizaciones\/\d+$/, { timeout: 45000 }), page.getByRole("button", { name: "Generar cotización", exact: true }).click()]);
      const id = Number(new URL(page.url()).pathname.split("/").pop());
      if (scalar(`select coalesce(share_token::text, '') from public.cotizaciones where id = ${id}`) === "") sql(`update public.cotizaciones set share_token = gen_random_uuid() where id = ${id}`);
      return { id, token: scalar(`select share_token::text from public.cotizaciones where id = ${id}`) };
    };
    const ctxAdm = await nuevoContexto2(); const pAdm = await ctxAdm.newPage(); await iniciarSesion(pAdm, adm);
    const cotA = await crearCot(pAdm, { cliente: "Cliente Logo A", doc: "81000111", aliado: NOMA });
    const cotB = await crearCot(pAdm, { cliente: "Cliente Logo B", doc: "81000222", aliado: NOMB });
    info("G2 cotizaciones creadas por la pantalla real", `A: id ${cotA.id} · B: id ${cotB.id}`);
    // Antes de subir logo: documento «de siempre» (sin franja ni logo del aliado)
    { const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await p.goto(`${APP}/cot/${cotA.token}`, { waitUntil: "networkidle" }); const tx = await textoPagina(p);
      cierto("L1 sin logo cargado: el documento no presenta ninguna marca de aliado (comportamiento de siempre)", !/Cotización presentada por/.test(tx) && (await p.locator(`img[src*="/cot/${cotA.token}/logo"]`).count()) === 0, tx.replace(/\s+/g, " ").slice(0, 100)); await ctx.close(); }
    // A sube su logo (validación por bytes: un SVG con script se rechaza; el PNG se acepta)
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    await pA.goto(`${APP}/portal/b2b/perfil`, { waitUntil: "networkidle" });
    await pA.locator("#logo-aliado-archivo").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: SVG });
    await pA.getByRole("alert").first().waitFor({ timeout: 20000 });
    igual("L2 un SVG (con script) NO se acepta como logo: no queda ninguna fila", scalar(`select count(*) from public.aliado_logos where aliado_id = ${IDA}`), "0");
    await pA.locator("#logo-aliado-archivo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logoPng });
    await pA.getByText("Logo actualizado.").waitFor({ timeout: 20000 });
    igual("L2 el PNG queda como único logo vigente, con su huella, en el bucket privado", scalar(`select count(*) filter (where vigente) || '/' || bool_and(sha256 = '${shaLogo}') || '/' || bool_and(via = 'portal') from public.aliado_logos where aliado_id = ${IDA}`), "1/true/true");
    await capturas(pA, "32-perfil-logo");
    const pathLogo = scalar(`select path from public.aliado_logos where aliado_id = ${IDA} and vigente`);
    // Documento público por token (sin sesión)
    const ctxP = await nuevoContexto2(); const pP = await ctxP.newPage();
    await pP.goto(`${APP}/cot/${cotA.token}`, { waitUntil: "networkidle" });
    const img = await pP.evaluate((tk) => { const i = document.querySelector(`img[src*="/cot/${tk}/logo"]`); return { hay: !!i, cargada: !!i && i.complete && i.naturalWidth > 0, alt: i?.alt }; }, cotA.token);
    cierto("L3 el documento público muestra el logo del aliado (servido por la ruta autorizada) y carga de verdad", img.hay && img.cargada, JSON.stringify(img));
    const tp = await textoPagina(pP);
    const ag = scalar("select coalesce(razon_social,'') || '|' || coalesce(nit,'') || '|' || coalesce(rnt,'') from public.agencias where tenant = 'mayorista'").split("|");
    cierto("L3 el emisor legal sigue identificado y sin cambios: «presentada por <aliado>, emitida por» + razón social, NIT y RNT de la agencia", /Cotización presentada por/.test(tp) && tp.includes(NOMA) && tp.includes(ag[0]) && tp.includes(ag[1]) && tp.includes(ag[2]), `${ag.join(" · ")} :: ${tp.replace(/\s+/g, " ").slice(0, 200)}`);
    await capturas(pP, "32-cot-publica-con-logo");
    const pdf = await pP.pdf({ format: "Letter", printBackground: true }); writeFileSync(join(SALIDA, "32-cot-con-logo.pdf"), pdf);
    info("L3 páginas del PDF de la cotización con logo", String((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length));
    // Rutas del archivo: cabeceras privadas y rechazo de lo ajeno
    const rl = await fetch(`${APP}/cot/${cotA.token}/logo`); const bytes = Buffer.from(await rl.arrayBuffer());
    cierto("L4 /cot/<token>/logo entrega los bytes del logo con tipo de imagen y SIN caché compartida", rl.status === 200 && /image\/png/.test(rl.headers.get("content-type") ?? "") && /private/.test(rl.headers.get("cache-control") ?? "") && /no-store/.test(rl.headers.get("cache-control") ?? "") && sha256(bytes) === shaLogo, `${rl.status} ${rl.headers.get("content-type")} ${rl.headers.get("cache-control")} sha=${sha256(bytes).slice(0, 8)}`);
    igual("L4 un token que no existe → 404", String((await fetch(`${APP}/cot/token-inexistente-${TAG}/logo`)).status), "404");
    igual("L4 la cotización de B (sin logo): su ruta de logo → 404 (no se le da el logo de A)", String((await fetch(`${APP}/cot/${cotB.token}/logo`)).status), "404");
    { const p2 = await ctxP.newPage(); await p2.goto(`${APP}/cot/${cotB.token}`, { waitUntil: "networkidle" }); const tb = await textoPagina(p2);
      cierto("L4 el documento de B (sin logo) es el de siempre: sin franja ni imagen de aliado, con la marca de la agencia", !/Cotización presentada por/.test(tb) && (await p2.locator(`img[src*="/cot/${cotB.token}/logo"]`).count()) === 0 && (await p2.locator(`img[src*="/marca/"]`).count()) >= 1, tb.replace(/\s+/g, " ").slice(0, 90));
      await capturas(p2, "32-cot-publica-sin-logo");
      const pdfB = await p2.pdf({ format: "Letter", printBackground: true }); info("L4 páginas del PDF de B (sin logo)", String((pdfB.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length)); }
    const pub = await fetch(`${GW}/storage/v1/object/public/aliado-logos/${pathLogo}`);
    const aut = await fetch(`${GW}/storage/v1/object/authenticated/aliado-logos/${pathLogo}`, { headers: { apikey: CFG.anonKey, authorization: `Bearer ${await tokenDe(uB)}` } });
    cierto("L4 el archivo del bucket no se alcanza directo: ni por URL pública ni autenticado como B", pub.status !== 200 && aut.status !== 200, `público ${pub.status} · B ${aut.status}`);
    // Portal: la vista previa del propio perfil
    igual("L5 /portal/b2b/perfil/logo: A recibe su logo", String((await pA.request.get(`${APP}/portal/b2b/perfil/logo`)).status()), "200");
    { const ctxB = await nuevoContexto2(); const pB = await ctxB.newPage(); await iniciarSesion(pB, uB);
      igual("L5 /portal/b2b/perfil/logo: B (sin logo) recibe 404, no el de A", String((await pB.request.get(`${APP}/portal/b2b/perfil/logo`)).status()), "404");
      await ctxB.close(); }
    igual("L5 anónimo en la ruta del perfil: no entrega el logo", String((await ctxP.request.get(`${APP}/portal/b2b/perfil/logo`, { maxRedirects: 0 })).status() !== 200), "true");
    // Documento interno de la cotización (personal)
    await pAdm.goto(`${APP}/cotizacion/${cotA.id}`, { waitUntil: "networkidle" });
    const imgI = await pAdm.evaluate((id) => { const i = document.querySelector(`img[src*="/cotizacion/${id}/logo"]`); return !!i && i.complete && i.naturalWidth > 0; }, cotA.id);
    cierto("L6 el documento interno de la cotización también muestra el logo del aliado dueño", imgI === true);
    await capturas(pAdm, "32-cot-interna-con-logo");
    // El logo es solo presentación: la identidad de la agencia (razón social/NIT/RNT) es la misma con y sin logo
    cierto("L6 el emisor legal impreso es el mismo con y sin logo (A vs B)", (await textoPagina(pP)).includes(ag[1]));
    await limpiarRegistro(); await pP.goto(`${APP}/cot/${cotA.token}`, { waitUntil: "networkidle" });
    info("P2 peticiones al abrir la cotización pública con logo", resumen(await registro()).slice(0, 400));
    await ctxAdm.close(); await ctxA.close(); await ctxP.close();
  }
