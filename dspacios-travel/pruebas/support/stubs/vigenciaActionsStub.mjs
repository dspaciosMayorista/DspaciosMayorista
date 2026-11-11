// Stub de "contratos/[numero]/vigencia-actions" (la real es "use server"). Configurable con __setImpls.
let impls = {};
export function __setImpls(next) { impls = { ...impls, ...next }; }
export const contratoSigueVigente = (...a) => (impls.contratoSigueVigente ?? (async () => null))(...a);
