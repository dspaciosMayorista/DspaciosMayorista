const f = globalThis.fetch; const de = "http://127.0.0.1:1"; const a = "http://127.0.0.1:" + process.env.VC_PROXY_PORT;
globalThis.fetch = (input, init) => { const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (u.startsWith(de)) { const n = a + u.slice(de.length); input = typeof input === "string" || input instanceof URL ? n : new Request(n, input); } return f(input, init); };
