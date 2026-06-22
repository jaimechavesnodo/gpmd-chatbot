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

const UMBRAL = () => parseFloat(process.env.OCR_CONFIANZA_MINIMA) || 0.95;

// ---------- Catálogos (cacheados en memoria, refrescables) ----------
let _catalogo = null, _pdvs = null, _cacheAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function getCatalogos(force = false) {
  if (!force && _catalogo && Date.now() - _cacheAt < CACHE_MS) return;
  const [{ data: prods }, { data: pdvs }] = await Promise.all([
    supabase.from('gpmd_productos').select('producto, presentacion').eq('participa', true),
    supabase.from('gpmd_pdv').select('cliente, nit, agente, departamento, ciudad').eq('activo', true),
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
  + 'match_confianza (0.0-1.0, que tan seguro estas del mapeo al catalogo), confianza (0.0-1.0, legibilidad general). '
  + 'Si hay varias lineas Mobil Delvac participantes, reporta la de mayor valor_total.';

// ---------- OCR + evaluación ----------
async function analizarFactura(buffer, contentType = 'image/jpeg') {
  await getCatalogos();
  const base64 = buffer.toString('base64');
  const media_type = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType) ? contentType : 'image/jpeg';

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system: buildSystem(_catalogo),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type, data: base64 } },
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
  const confianza = parseFloat(ocr.confianza) || 0.0;
  const matchConf = parseFloat(ocr.match_confianza) || 0.0;
  const fechaOk = !!ocr.fecha_compra;

  // PDV: filas cuyo NIT coincide con el de la factura
  const matches = (_pdvs || []).filter((p) => nitCoincide(ocr.nit, p.nit));
  const clientesUnicos = [...new Set(matches.map((m) => m.cliente))];
  const pdvUnico = clientesUnicos.length === 1 ? matches.find((m) => m.cliente === clientesUnicos[0]) : null;

  // Producto: debe haber mapeado a un item del catálogo participante con confianza alta
  const productoOk = !!ocr.producto_catalogo && matchConf >= min;

  const pdvOk = matches.length > 0 && pdvUnico != null;
  const pasaAuto = pdvOk && productoOk && confianza >= min && fechaOk;

  const razones = [];
  if (matches.length === 0) razones.push('Establecimiento (NIT) no participante o ilegible');
  else if (!pdvUnico) razones.push(`NIT con ${clientesUnicos.length} clientes posibles — elegir cliente`);
  if (!productoOk) razones.push(`Producto/presentación no confirmados (match ${Math.round(matchConf * 100)}%)`);
  if (confianza < min) razones.push(`Legibilidad baja (${Math.round(confianza * 100)}%)`);
  if (!fechaOk) razones.push('Fecha de compra no legible');

  return {
    ocr,
    confianza,
    matchConfianza: matchConf,
    pdv: {
      candidatos: matches,                 // para el dropdown del aprobador
      cliente: pdvUnico ? pdvUnico.cliente : null,
      agente: pdvUnico ? pdvUnico.agente : null,
      departamento: pdvUnico ? pdvUnico.departamento : null,
      ciudad: pdvUnico ? pdvUnico.ciudad : null,
    },
    pasaAuto,
    motivo: pasaAuto ? null : razones.join('; '),
    estado: pasaAuto ? 'aprobada_auto' : 'en_revision',
  };
}

module.exports = { analizarFactura, evaluar, getCatalogos, nitCoincide };
