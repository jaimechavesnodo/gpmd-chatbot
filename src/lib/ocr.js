// OCR de facturas con Claude Vision + validación contra catálogo y PDV.
const Anthropic = require('@anthropic-ai/sdk');
const { Agent, fetch: undiciFetch } = require('undici');
const supabase = require('./supabase');

// Dispatcher dedicado: evita reusar conexiones keep-alive muertas hacia
// api.anthropic.com (causa del error "Premature close" en el contenedor).
const dispatcher = new Agent({
  connectTimeout: 30000, headersTimeout: 120000, bodyTimeout: 120000,
  keepAliveTimeout: 1000, keepAliveMaxTimeout: 1000, pipelining: 0,
});
const robustFetch = (url, opts = {}) => undiciFetch(url, { ...opts, dispatcher });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, fetch: robustFetch, maxRetries: 4, timeout: 120000,
});

// Calibrado con lote real de 34 facturas de entrenamiento (jul/2026): los matches
// genuinos de producto se autoevalúan en 0.80-0.95, los ambiguos/incorrectos en
// ≤0.55 — 0.85 separa ambos grupos con margen sin dejar pasar falsos positivos.
const UMBRAL = () => parseFloat(process.env.OCR_CONFIANZA_MINIMA) || 0.85;       // producto vs catálogo
const UMBRAL_NIT = () => parseFloat(process.env.OCR_NIT_CONFIANZA_MINIMA) || 0.75; // NIT + Cliente

// ---------- Catálogos (cacheados en memoria, refrescables) ----------
let _catalogo = null, _pdvs = null, _cacheAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function getCatalogos(force = false) {
  if (!force && _catalogo && Date.now() - _cacheAt < CACHE_MS) return;
  const [{ data: prods }, { data: pdvs }] = await Promise.all([
    supabase.from('gpmd_productos').select('producto, presentacion').eq('participa', true),
    supabase.from('gpmd_pdv').select('id, cliente, nit, agente, departamento, ciudad, canal, razon_social').eq('activo', true),
  ]);
  _catalogo = prods || [];
  _pdvs = pdvs || [];
  _cacheAt = Date.now();
}

// ---------- Matching de NIT (tolera dígito de verificación) ----------
const soloDigitos = (s) => String(s || '').replace(/\D/g, '');
function nitCoincide(facturaNit, pdvNit) {
  const a = soloDigitos(facturaNit), b = soloDigitos(pdvNit);
  if (!a || !b) return false;
  return a === b || a.slice(0, -1) === b || a === b.slice(0, -1);
}

// ---------- Prompt ----------
function buildSystem(catalogo) {
  const lista = catalogo.map((c) => `- ${c.producto} | ${c.presentacion}`).join('\n');
  return 'Eres un experto en lectura de facturas electronicas de venta de lubricantes en Colombia. '
    + 'La factura suele tener VARIOS productos; identifica UNICAMENTE el producto Mobil Delvac participante e ignora el resto '
    + '(filtros, refrigerantes, otras marcas, etc.). Los nombres y presentaciones vienen MUY abreviados en las facturas '
    + '(ej: "M-DEL MODERN 15W40 FULL PROTEC BALDE", "MOBIL DELVAC 1350 BDE", "M.DELVAC 1340 GRANEL"). '
    + 'Debes mapear la linea de la factura al producto MAS PARECIDO de este CATALOGO de productos participantes:\n'
    + lista + '\n\n'
    + 'Tambien extrae el NIT del EMISOR/vendedor (aparece arriba en la factura, puede traer digito de verificacion como 822000851-3). '
    + 'Responde SOLO con un JSON, sin markdown ni texto adicional.';
}
const USER_TEXT = 'Devuelve un JSON con: nit (NIT del emisor, string solo con el numero), establecimiento (razon social del emisor), '
  + 'fecha_compra (YYYY-MM-DD), producto_factura (texto crudo de la linea Mobil Delvac tal cual aparece), '
  + 'producto_catalogo (el item del catalogo que mejor corresponde, EXACTO como "Producto | Presentacion", o null si ninguno aplica), '
  + 'presentacion (Balde, Granel, Galon, Cuartos u Otro), cantidad (numero), valor_total (numero sin simbolos ni puntos de miles), '
  + 'match_confianza (0.0-1.0, que tan seguro estas del mapeo al catalogo), nit_confianza (0.0-1.0, que tan seguro estas de haber leido bien el NIT del emisor), '
  + 'confianza (0.0-1.0, legibilidad general). '
  + 'Si hay varias lineas Mobil Delvac participantes, reporta la de mayor valor_total.';

// ---------- OCR + evaluación ----------
// Las facturas pueden llegar como imagen (foto de WhatsApp) o como PDF
// (documento adjunto). Claude soporta ambos con bloques de contenido distintos.
async function analizarFactura(buffer, contentType = 'image/jpeg') {
  await getCatalogos();
  const base64 = buffer.toString('base64');
  const esPdf = (contentType || '').includes('pdf');
  const media_type = esPdf ? 'application/pdf'
    : ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType) ? contentType : 'image/jpeg';
  const archivo = esPdf
    ? { type: 'document', source: { type: 'base64', media_type, data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type, data: base64 } };

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system: buildSystem(_catalogo),
    messages: [{
      role: 'user',
      content: [
        archivo,
        { type: 'text', text: USER_TEXT },
      ],
    }],
  });

  let ocr = {};
  try {
    ocr = JSON.parse((resp.content?.[0]?.text || '{}').replace(/```json\n?|```/g, '').trim());
  } catch {
    ocr = { confianza: 0.0, motivo_baja_confianza: 'No se pudo parsear la respuesta del OCR' };
  }
  return evaluar(ocr);
}

// Resuelve PDV por NIT y decide si la factura pasa automáticamente.
function evaluar(ocr) {
  const min = UMBRAL();
  const minNit = UMBRAL_NIT();
  const confianza = parseFloat(ocr.confianza) || 0.0;
  const matchConf = parseFloat(ocr.match_confianza) || 0.0;
  // confianza específica de lectura del NIT; si el modelo no la da, usa la general
  const nitConf = ocr.nit_confianza != null ? parseFloat(ocr.nit_confianza) : confianza;
  const fechaOk = !!ocr.fecha_compra;

  // PDV: filas cuyo NIT coincide con el de la factura
  const matches = (_pdvs || []).filter((p) => nitCoincide(ocr.nit, p.nit));
  const clientesUnicos = [...new Set(matches.map((m) => m.cliente))];
  const pdvUnico = clientesUnicos.length === 1 ? matches.find((m) => m.cliente === clientesUnicos[0]) : null;

  // NIT+Cliente reconocidos con certeza ≥75% (umbral configurable) y un único cliente
  const nitOk = pdvUnico != null && nitConf >= minNit;
  // Producto: mapeado a un item del catálogo participante con confianza alta
  const productoOk = !!ocr.producto_catalogo && matchConf >= min;

  const pasaAuto = nitOk && productoOk && fechaOk;

  const razones = [];
  if (matches.length === 0) razones.push('Establecimiento (NIT) no participante o ilegible');
  else if (!pdvUnico) razones.push(`NIT con ${clientesUnicos.length} clientes posibles — elegir cliente`);
  else if (nitConf < minNit) razones.push(`Lectura de NIT poco confiable (${Math.round(nitConf * 100)}%)`);
  if (!productoOk) razones.push(`Producto/presentación no confirmados (match ${Math.round(matchConf * 100)}%)`);
  if (!fechaOk) razones.push('Fecha de compra no legible');

  // Canal/Razón Social: informativos, derivados del PDV resuelto (no editables)
  const fila = pdvUnico || null;
  return {
    ocr,
    confianza,
    matchConfianza: matchConf,
    nitConfianza: nitConf,
    pdv: {
      candidatos: matches,                 // para el dropdown del aprobador (incluyen canal/razon_social)
      pdv_id: fila ? fila.id : null,
      cliente: fila ? fila.cliente : null,
      agente: fila ? fila.agente : null,
      departamento: fila ? fila.departamento : null,
      ciudad: fila ? fila.ciudad : null,
      canal: fila ? fila.canal : null,
      razon_social: fila ? fila.razon_social : null,
    },
    pasaAuto,
    motivo: pasaAuto ? null : razones.join('; '),
    estado: pasaAuto ? 'aprobada_auto' : 'en_revision',
  };
}

module.exports = { analizarFactura, evaluar, getCatalogos, nitCoincide };
