  // ══ G8 · pestaña «Agentes» del propietario de una agencia (la SÉPTIMA pestaña del portal): visible, alcanzable y sin desbordar en 1280 / 820 / 390 px ═════════════════════════════════════════
  if (G("agentes")) {
    const NAV = 'nav[aria-label="Secciones del portal"]';
    // El propietario de una agencia (rol agencia sin agencia_id) ve 7 pestañas; un freelance, 6.
    const medirNav = async (page) => page.evaluate((sel) => {
      const nav = document.querySelector(sel); const ancho = document.documentElement.clientWidth;
      const enlaces = [...(nav?.querySelectorAll("a") ?? [])].map((a) => { const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return { t: (a.textContent ?? "").trim(), visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none", izq: Math.round(r.left), der: Math.round(r.right), alto: Math.round(r.height), arriba: Math.round(r.top), abajo: Math.round(r.bottom) }; });
      const navR = nav?.getBoundingClientRect();
      return { ancho, scroll: document.documentElement.scrollWidth, enlaces, navDer: navR ? Math.round(navR.right) : null, navScrollX: nav ? (nav.scrollWidth > nav.clientWidth + 1) : null };
    }, NAV);
    const ctx = await nuevoContexto(); const p = await ctx.newPage();
    await iniciarSesion(p, uC);
    await p.goto(`${APP}/portal/b2b`, { waitUntil: "networkidle" });
    const aliasAnchos = [["escritorio", 1280, 800], ["intermedio", 820, 1000], ["movil", 390, 800]];
    for (const [et, w, h] of aliasAnchos) {
      await p.setViewportSize({ width: w, height: h }); await dormir(300);
      const m = await medirNav(p);
      igual(`T7 ${et} (${w} px): el propietario de agencia ve SIETE pestañas, incluida «Agentes»`, `${m.enlaces.length}/${m.enlaces.some((x) => /Agentes/.test(x.t))}`, "7/true");
      cierto(`T7 ${et}: las siete son visibles y NINGUNA queda fuera del ancho de pantalla`, m.enlaces.length === 7 && m.enlaces.every((x) => x.visible && x.izq >= -1 && x.der <= m.ancho + 1), JSON.stringify(m.enlaces.map((x) => `${x.t}:${x.izq}-${x.der}`)).slice(0, 240));
      cierto(`T7 ${et}: la página no tiene scroll horizontal (documento ${m.scroll} px ≤ pantalla ${m.ancho} px)`, m.scroll <= m.ancho + 1, `${m.scroll}/${m.ancho}`);
      cierto(`T7 ${et}: cada pestaña es tocable (alto ≥ 36 px)`, m.enlaces.every((x) => x.alto >= 36), JSON.stringify(m.enlaces.map((x) => x.alto)));
      await p.screenshot({ path: join(SALIDA, `7tab-inicio-${et}.png`), fullPage: false });
    }
    // Se llega a «Agentes» con un toque y la pestaña queda marcada como la actual (aria-current) en cada ancho
    for (const [et, w, h] of aliasAnchos) {
      await p.setViewportSize({ width: w, height: h }); await p.goto(`${APP}/portal/b2b`, { waitUntil: "networkidle" }); await dormir(250);
      await p.locator(`${NAV} a`, { hasText: "Agentes" }).first().click();
      await p.waitForURL((u) => u.pathname === "/portal/b2b/agentes", { timeout: 20000 });
      await p.waitForLoadState("networkidle");
      const marcada = await p.evaluate((sel) => { const a = [...document.querySelectorAll(`${sel} a`)].find((x) => x.getAttribute("aria-current")); return a ? (a.textContent ?? "").trim() : null; }, NAV);
      const m = await medirNav(p);
      cierto(`T7 ${et}: «Agentes» abre /portal/b2b/agentes, queda marcada como actual y mantiene las siete pestañas sin desbordar`, /Agentes/.test(marcada ?? "") && m.enlaces.length === 7 && m.scroll <= m.ancho + 1 && m.enlaces.every((x) => x.der <= m.ancho + 1), `${marcada}/${m.enlaces.length}/${m.scroll}/${m.ancho}`);
      await p.screenshot({ path: join(SALIDA, `7tab-agentes-${et}.png`), fullPage: false });
    }
    await ctx.close();
    // Contraste: un freelance (titular sin agencia propia) NO ve la séptima pestaña
    { const c2 = await nuevoContexto(); const q = await c2.newPage(); await iniciarSesion(q, uA); await q.goto(`${APP}/portal/b2b`, { waitUntil: "networkidle" });
      const m = await medirNav(q);
      igual("T7 un freelance ve SEIS pestañas y ninguna «Agentes»", `${m.enlaces.length}/${m.enlaces.some((x) => /Agentes/.test(x.t))}`, "6/false");
      await c2.close(); }
  }
