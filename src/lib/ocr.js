// OCR de facturas con Claude Vision. Reusa el prompt validado en n8n.
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = 'Eres un experto en lectura de facturas electronicas de venta de lubricantes en Colombia. La factura suele contener VARIOS productos en distintas lineas; tu tarea es identificar UNICAMENTE el producto Mobil Delvac participante e ignorar el resto (filtros, refrigerantes, limpiadores, aceites de otras marcas, aditivos, etc.). El nombre Mobil Delvac puede venir abreviado o con variaciones (ej: M.DELVAC, DELVAC MX, MOBIL DELVAC MODERN 15W40 CK4, MD 1300). Extrae los datos en JSON. Si no puedes leer un campo con certeza usa null. Evalua la confianza (0.0 a 1.0) segun legibilidad y completitud. Responde SOLO con el JSON, sin texto adicional ni markdown.';

const USER_TEXT = 'Extrae en JSON los campos: establecimiento (negocio emisor de la factura), ciudad, fecha_compra (formato YYYY-MM-DD), referencia_producto (nombre EXACTO del producto Mobil Delvac tal como aparece en la factura), presentacion (normaliza a una sola palabra: Balde, Galon, Cuarto, Tambor, Caneca, Litro u Otro), cantidad (numero), valor_total (valor total de la linea del Mobil Delvac, numero sin simbolos ni puntos de miles), es_producto_valido (true solo si el producto es Mobil Delvac), confianza (0.0 a 1.0), motivo_baja_confianza (string o null). Si hay varias lineas Mobil Delvac, reporta la de mayor valor_total.';

// Ejecuta el OCR sobre una imagen (Buffer). Devuelve { ocr, confianza, pasaAuto, motivo, estado }.
async function analizarFactura(buffer, contentType = 'image/jpeg') {
  const base64 = buffer.toString('base64');
  const media_type = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType)
    ? contentType : 'image/jpeg';

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system: SYSTEM,
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
    const text = resp.content?.[0]?.text || '{}';
    ocr = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
  } catch {
    ocr = { confianza: 0.0, motivo_baja_confianza: 'No se pudo parsear la respuesta del OCR' };
  }

  return evaluar(ocr);
}

// Aplica las reglas configurables (env vars) sobre el resultado del OCR.
function evaluar(ocr) {
  const confianza = parseFloat(ocr.confianza) || 0.0;
  const esProductoValido = ocr.es_producto_valido === true;
  const fechaOk = !!ocr.fecha_compra;

  const presRaw = (process.env.PRESENTACIONES_VALIDAS || '').trim();
  const presValidas = presRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const pres = (ocr.presentacion || '').trim().toLowerCase();
  const esPresentacionValida = presRaw === '' || presRaw === '*' || presValidas.includes(pres);

  const CONFIANZA_MIN = parseFloat(process.env.OCR_CONFIANZA_MINIMA) || 0.70;
  const pasaAuto = confianza >= CONFIANZA_MIN && esProductoValido && esPresentacionValida && fechaOk;

  let motivo = null;
  if (!pasaAuto) {
    const r = [];
    if (confianza < CONFIANZA_MIN) r.push(`Confianza OCR baja (${Math.round(confianza * 100)}%)`);
    if (!esProductoValido) r.push('Producto no identificado como Mobil Delvac');
    if (!esPresentacionValida) r.push(`Presentación "${ocr.presentacion || '?'}" no participante`);
    if (!fechaOk) r.push('Fecha de compra no legible');
    motivo = r.join('; ');
  }

  return {
    ocr,
    confianza,
    pasaAuto,
    motivo,
    estado: pasaAuto ? 'aprobada_auto' : 'en_revision',
  };
}

module.exports = { analizarFactura, evaluar };
