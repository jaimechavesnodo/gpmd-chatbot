// Código de preregistro GPMD-XXXXXX (sin caracteres ambiguos).
function genCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = 'GPMD-';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
module.exports = { genCodigo };
