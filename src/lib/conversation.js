// Máquina de estados conversacional del chatbot GPMD (orquestada por el backend).
// WATI reenvía cada mensaje entrante a /webhook/wati → processIncoming().
const fs = require('fs');
const path = require('path');
const supabase = require('./supabase');
const wati = require('./wati');
const ocr = require('./ocr');
const { logActivity } = require('../middleware/logger');

const PDF_AUTORIZACION = path.join(__dirname, '..', 'assets', 'legal', 'autorizacion-datos-gpmd-2026.pdf');

const TIPO_DOC = ['Cédula', 'Pasaporte', 'Otro'];
const RH = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const LIMITE_CONFIRMADOS = () => parseInt(process.env.LIMITE_CONFIRMADOS) || 150;

// Texto reutilizable para cuando la factura pasa a validación manual (incluye horario)
const MSG_EN_REVISION = 'Un asesor la validará: el proceso puede tardar entre *1 y 3 horas* en horario *lunes a viernes de 8:00am a 6:00pm* y *sábados de 8:00am a 1:00pm*. Apenas sea validada te avisamos por aquí. ⏳';

// ---------- Autorización de tratamiento de datos personales (primer mensaje) ----------
// Nota diagnóstica: el endpoint GET /getMessages de WATI no devuelve
// `interactiveData` para mensajes ya entregados (aunque hayan sido botones
// reales), así que ese campo NO sirve para confirmar si algo se renderizó
// como botón — hay que verificar visualmente en el dispositivo. Confirmado
// con captura real: sendInteractiveButtonsMessage SÍ renderiza botones
// táctiles nativos en este tenant.
const CONSENT_BOTONES = ['Sí, autorizo', 'No autorizo'];
const MSG_CONSENTIMIENTO = '📋 *Autorización de Tratamiento de Datos Personales*\n\n'
  + 'Antes de continuar con tu preinscripción al *Gran Premio Mobil Delvac 2026*, necesitamos tu autorización.\n\n'
  + 'TERPEL S.A. recolectará tus datos (nombre, documento, celular, RH e imagen de tu factura) para gestionar tu preinscripción, validar tu participación y contactarte durante el proceso, conforme a la Ley 1581 de 2012.\n\n'
  + 'Puedes conocer, actualizar, rectificar o revocar tus datos en cualquier momento.\n\n'
  + '¿Autorizas el tratamiento de tus datos personales?';

// Envía el PDF de Términos y Condiciones (solo la primera vez) + la pregunta con botones.
async function enviarConsentimiento(phone, { incluirPdf = true } = {}) {
  if (incluirPdf) {
    try {
      const buffer = fs.readFileSync(PDF_AUTORIZACION);
      await wati.sendSessionFile(phone, buffer, 'Terminos-y-condiciones-GPMD-2026.pdf', 'application/pdf',
        'Términos y Condiciones — Autorización de Tratamiento de Datos Personales, Gran Premio Mobil Delvac 2026');
    } catch (e) {
      console.error('[GPMD] no se pudo enviar el PDF de autorización:', e.message);
    }
  }
  await wati.sendInteractiveButtons(phone, MSG_CONSENTIMIENTO, CONSENT_BOTONES);
}

// ---------- Pasos del registro (en orden) ----------
// tras 'rh' (último campo del piloto) se crea el participante 'pre_registrado'.
const STEPS = [
  { field: 'nombre_piloto',
    q: 'Para empezar, ¿cuál es tu *nombre y apellidos completos* (piloto)?',
    validate: (v) => (v.trim().length >= 3 ? null : 'Escribe tu nombre completo:') },
  { field: 'novato', opciones: ['Novato', 'No novato'],
    q: '¿Eres piloto *NOVATO* o *NO NOVATO*?',
    normalize: (v) => v === 'Novato' },
  { field: 'tipo_documento_piloto', opciones: TIPO_DOC,
    q: '¿Qué *tipo de documento* tienes?' },
  { field: 'cedula',
    q: '¿Cuál es tu *número de documento*? (solo el número)',
    validate: (v) => (v.replace(/\s/g, '').length >= 4 ? null : 'Escribe un número de documento válido:'),
    normalize: (v) => v.replace(/\s/g, '') },
  { field: 'rh', opciones: RH,
    q: '¿Cuál es tu *grupo sanguíneo y RH*?',
    afterCreate: true },
];

function parseOpcion(text, opciones) {
  const s = text.trim().toLowerCase();
  const n = parseInt(s);
  if (n >= 1 && n <= opciones.length) return opciones[n - 1];
  const m = opciones.find((o) => o.toLowerCase() === s || o.toLowerCase().includes(s) && s.length >= 2);
  return m || null;
}
function formatOpciones(opciones) {
  const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
  return opciones.map((o, i) => `${nums[i] || (i + 1) + '.'} ${o}`).join('\n');
}
function preguntar(step) {
  if (step.opciones) return `${step.q}\n\n${formatOpciones(step.opciones)}\n\nResponde con el número.`;
  return step.q;
}
function genCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = 'GPMD-';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

// ---------- Persistencia de conversación ----------
async function loadConv(phone) {
  const { data, error: e1 } = await supabase.from('gpmd_conversaciones').select('*').eq('phone', phone).maybeSingle();
  if (e1) console.error(`[conversation] error leyendo conversación ${phone}:`, e1.message);
  if (data) return data;
  const nuevo = { phone, step: 'inicio', data: {} };
  const { error: e2 } = await supabase.from('gpmd_conversaciones').insert(nuevo);
  if (e2) console.error(`[conversation] error creando conversación ${phone}:`, e2.message);
  return nuevo;
}
async function saveConv(phone, patch) {
  const { error } = await supabase.from('gpmd_conversaciones').update(patch).eq('phone', phone);
  if (error) console.error(`[conversation] error guardando conversación ${phone}:`, error.message);
}
function stepIndex(field) { return STEPS.findIndex((s) => s.field === field); }
function nextStep(fromIdx, data) {
  for (let i = fromIdx; i < STEPS.length; i++) {
    if (STEPS[i].skipIf && STEPS[i].skipIf(data)) continue;
    return STEPS[i];
  }
  return null;
}

// ---------- Procesamiento principal ----------
async function processIncoming(msg, send = wati.sendSessionMessage) {
  const phone = (msg.phone || '').replace(/\D/g, '');
  const text = (msg.text || '').trim();
  if (!phone) return;

  const conv = await loadConv(phone);

  const forzarReinicio = /^(reiniciar|empezar de nuevo|reset)$/i.test(text);
  if (forzarReinicio) {
    await saveConv(phone, { step: 'inicio', data: {} });
    conv.step = 'inicio'; conv.data = {};
  }

  // --- INICIO ---
  if (conv.step === 'inicio') {
    const { data: part } = await supabase
      .from('gpmd_participants').select('estado, codigo_preregistro, nombre_piloto')
      .eq('phone', phone).maybeSingle();

    // Usuario que regresa (ya tiene preregistro) y no pidió reiniciar → responder según su estado
    if (part && !forzarReinicio) {
      return responderSegunEstado(phone, part, conv, send);
    }

    // Nuevo usuario (o reinicio): primero pedir autorización de tratamiento de datos
    await saveConv(phone, { step: 'consentimiento', data: {} });
    conv.step = 'consentimiento'; conv.data = {};
    await enviarConsentimiento(phone);
    return conv;
  }

  // --- CONSENTIMIENTO DE TRATAMIENTO DE DATOS ---
  if (conv.step === 'consentimiento') {
    if (!text) { await enviarConsentimiento(phone, { incluirPdf: false }); return conv; }

    const op = parseOpcion(text, CONSENT_BOTONES);
    if (!op) {
      await enviarConsentimiento(phone, { incluirPdf: false });
      return conv;
    }

    if (op === CONSENT_BOTONES[1]) { // "No autorizo"
      await logActivity({ entidad: 'consentimiento', entidadId: phone, accion: 'no_autorizo', detalle: { phone }, fuente: 'automatico' });
      await saveConv(phone, { step: 'inicio', data: {} });
      await send(phone, 'Entendido. Sin tu autorización no podemos continuar con la preinscripción. Si cambias de opinión, escríbenos de nuevo cuando quieras. ¡Gracias! 🙏');
      return conv;
    }

    // "Sí, autorizo"
    await logActivity({ entidad: 'consentimiento', entidadId: phone, accion: 'autorizo', detalle: { phone }, fuente: 'automatico' });
    return iniciarRegistro(phone, conv, send);
  }

  // --- RECOLECCIÓN DE DATOS ---
  if (conv.step.startsWith('reg:')) {
    const field = conv.step.slice(4);
    const step = STEPS[stepIndex(field)];
    if (!text) { await send(phone, preguntar(step)); return conv; }

    let valor;
    if (step.opciones) {
      const op = parseOpcion(text, step.opciones);
      if (!op) { await send(phone, '⚠️ Responde con el número de una de las opciones:\n\n' + formatOpciones(step.opciones)); return conv; }
      valor = step.normalize ? step.normalize(op) : op;
    } else {
      const err = step.validate ? step.validate(text) : null;
      if (err) { await send(phone, '⚠️ ' + err); return conv; }
      valor = step.normalize ? step.normalize(text) : text.trim();
    }
    conv.data[field] = valor;

    // Tras completar el bloque del piloto (email) → crear participante pre_registrado
    if (step.afterCreate) {
      const err = await crearParticipante(phone, conv.data);
      if (err) { await send(phone, '⚠️ ' + err); return conv; }
      wati.updateContactAttributes(phone, [{ name: 'registrado', value: 'true' }]).catch(() => {});
      await send(phone, '✅ ¡Datos del piloto guardados!');
    }

    const next = nextStep(stepIndex(field) + 1, conv.data);
    if (next) {
      await saveConv(phone, { step: `reg:${next.field}`, data: conv.data });
      await send(phone, preguntar(next));
      return conv;
    }
    return finalizarRegistro(phone, conv, send); // guarda opcionales y pide factura
  }

  // --- ESPERANDO FACTURA ---
  if (conv.step === 'factura') {
    if ((msg.type === 'image' || msg.type === 'document') && msg.mediaFileName) return procesarFactura(phone, conv, msg.mediaFileName, send);
    await send(phone, '📸 Por favor envíame la *foto (o el PDF) de tu factura* de compra del producto Mobil Delvac participante. Debe verse clara, completa y legible.');
    return conv;
  }

  // --- COMPLETO ---
  if (conv.step === 'completo') {
    const { data: part } = await supabase.from('gpmd_participants')
      .select('estado, codigo_preregistro, nombre_piloto').eq('phone', phone).maybeSingle();

    if ((msg.type === 'image' || msg.type === 'document') && msg.mediaFileName) {
      if (part && part.estado === 'confirmado') {
        await send(phone, '✅ Tu cupo ya está *confirmado*, no necesitas enviar más facturas. 🏁');
        return conv;
      }
      return procesarFactura(phone, conv, msg.mediaFileName, send);
    }
    return responderSegunEstado(phone, part, conv, send);
  }

  return conv;
}

// Envía el mensaje de bienvenida y arranca el bloque de preguntas del piloto.
async function iniciarRegistro(phone, conv, send) {
  await send(phone,
    '🏁 *¡Bienvenido al Gran Premio Mobil Delvac 2026!* 🚛\n\n'
    + 'Te ayudaré con tu *preregistro*. Te haré unas preguntas y al final subirás la *foto de tu factura* de compra de producto Mobil Delvac participante.\n\n'
    + 'Tu cupo quedará *confirmado* cuando validemos la factura.\n\n'
    + 'En cualquier momento puedes escribir *reiniciar*.');
  const first = nextStep(0, conv.data);
  await saveConv(phone, { step: `reg:${first.field}`, data: conv.data });
  conv.step = `reg:${first.field}`;
  await send(phone, preguntar(first));
  return conv;
}

// Responde a un usuario que regresa, según el estado real de su preregistro.
// Para 'rechazado' y 'pre_registrado' deja la conversación lista para (re)enviar la factura.
async function responderSegunEstado(phone, part, conv, send) {
  if (!part) { // sin preregistro: arrancar de cero
    await saveConv(phone, { step: 'inicio', data: {} });
    conv.step = 'inicio';
    return processIncoming({ phone, text: '' }, send);
  }
  const nombre = part.nombre_piloto ? ', ' + part.nombre_piloto.split(' ')[0] : '';

  if (part.estado === 'confirmado') {
    await send(phone, `✅ ¡Hola de nuevo${nombre}! Tu cupo en el *Gran Premio Mobil Delvac 2026* ya está *CONFIRMADO*. 🏁\n\n🏁 Código: *${part.codigo_preregistro}*`);
    return conv;
  }
  if (part.estado === 'lista_espera') {
    await send(phone, `🙏 ¡Hola${nombre}! Tu factura fue validada, pero los cupos ya se completaron y estás en *lista de espera*. Te avisaremos por aquí si se habilita un cupo.`);
    return conv;
  }
  if (part.estado === 'en_revision') {
    await send(phone, `⏳ ¡Hola${nombre}! Tu factura está *en revisión*. ${MSG_EN_REVISION}`);
    return conv;
  }

  // rechazado o pre_registrado → solo falta (re)enviar la factura
  await saveConv(phone, { step: 'factura' });
  conv.step = 'factura';
  const intro = part.estado === 'rechazado'
    ? `Tu *preregistro ya está hecho* ✅, pero aún no hemos podido validar tu factura.`
    : `Tu *preregistro ya está hecho* ✅. Solo falta validar tu factura.`;
  await send(phone, `${intro}\n\n📸 Envíame la *foto (o el PDF) de tu factura* de compra de producto Mobil Delvac participante (clara, completa y legible) para validarla y *completar tu registro* para la revisión tecnomecánica.`);
  return conv;
}

// Crea el participante con los datos del piloto (estado pre_registrado).
async function crearParticipante(phone, d) {
  const codigo = genCodigo();
  const row = {
    phone, cedula: d.cedula, nombre_piloto: d.nombre_piloto,
    tipo_documento_piloto: d.tipo_documento_piloto, novato: !!d.novato,
    rh: d.rh, codigo_preregistro: codigo, estado: 'pre_registrado',
  };
  const { error } = await supabase.from('gpmd_participants').upsert(row, { onConflict: 'phone' }).select('id').single();
  if (error) {
    console.error('[GPMD] crearParticipante:', error.message);
    if (String(error.message).includes('cedula')) return 'Ese documento ya está registrado con otro número. Si crees que es un error, escribe a un asesor.';
    return 'Hubo un problema guardando tus datos. Intenta de nuevo en unos minutos.';
  }
  return null;
}

// Pasa a pedir la factura tras completar los datos del piloto.
async function finalizarRegistro(phone, conv, send) {
  await saveConv(phone, { step: 'factura' });
  conv.step = 'factura';
  await send(phone, '📸 *Último paso:* envíame la *foto (o el PDF) de tu factura* de compra del producto Mobil Delvac participante. Asegúrate de que se vea clara, completa y legible.');
  return conv;
}

async function procesarFactura(phone, conv, mediaFileName, send) {
  await send(phone, '🔎 Recibí tu factura, dame un momento mientras la verifico...');

  const { data: part } = await supabase.from('gpmd_participants')
    .select('id, nombre_piloto, codigo_preregistro').eq('phone', phone).maybeSingle();
  if (!part) { await send(phone, '⚠️ No encuentro tu registro. Escribe *reiniciar*.'); return conv; }

  // 1. Descargar media de WATI (requiere auth)
  let buffer, contentType;
  try {
    ({ buffer, contentType } = await wati.downloadMedia(mediaFileName));
  } catch (e) {
    console.error('[GPMD] descarga media WATI falló:', e.message, '| file:', mediaFileName);
    await send(phone, '⚠️ No pude descargar tu imagen. Por favor envíala de nuevo.');
    return conv;
  }

  // 1.b Validar que el archivo llegó completo y no es un placeholder/bookmark roto
  // (visto en la práctica: PDFs compartidos desde iCloud/Files sin descargar en el
  // iPhone del remitente llegan como un "bplist" de ~200 bytes en vez del PDF real).
  if (!archivoValido(buffer, contentType)) {
    console.warn(`[GPMD] archivo dañado/incompleto de ${phone} (${buffer.length} bytes, contentType=${contentType})`);
    const urlRoto = await subirImagen(buffer, contentType, part.id); // se guarda igual, para poder auditar qué llegó
    await guardarFactura(part.id, {
      imagen_url: urlRoto || mediaFileName,
      ocr_motivo_revision: 'Archivo dañado o incompleto al llegar (no es un PDF/imagen válido) — pedir reenvío',
      estado: 'en_revision',
    });
    await supabase.from('gpmd_participants').update({ estado: 'en_revision' }).eq('id', part.id);
    await saveConv(phone, { step: 'completo' }); conv.step = 'completo';
    await send(phone, '⚠️ Tu archivo llegó dañado o incompleto (esto pasa a veces con PDFs compartidos desde iCloud/Archivos sin descargar). Por favor envíame la factura de nuevo, si puede ser como *foto* mejor que como PDF.');
    return conv;
  }

  // 2. Guardar imagen (no bloquea)
  const imagenUrl = await subirImagen(buffer, contentType, part.id);

  // 3. OCR + validación (catálogo + PDV)
  let r;
  try {
    r = await ocr.analizarFactura(buffer, contentType);
  } catch (e) {
    console.error('[GPMD] OCR Claude falló:', e.message);
    await guardarFactura(part.id, { imagen_url: imagenUrl || mediaFileName, ocr_motivo_revision: 'Error técnico OCR: ' + e.message, estado: 'en_revision' });
    await supabase.from('gpmd_participants').update({ estado: 'en_revision' }).eq('id', part.id);
    await saveConv(phone, { step: 'completo' }); conv.step = 'completo';
    await send(phone, `📩 Recibí tu factura. ${MSG_EN_REVISION}`);
    return conv;
  }

  const o = r.ocr;
  const autoAprobada = r.pasaAuto || r.pasaAutoValor;
  await guardarFactura(part.id, {
    imagen_url: imagenUrl || mediaFileName, ocr_raw: o,
    ocr_establecimiento: o.establecimiento || null, ocr_fecha_compra: o.fecha_compra || null,
    ocr_referencia_producto: o.producto_factura || null, ocr_presentacion: o.presentacion || null,
    ocr_cantidad: o.cantidad || null, ocr_valor_total: o.valor_total || null,
    ocr_confianza: r.confianza, ocr_motivo_revision: r.motivo,
    nit: o.nit || null, cliente: r.pdv.cliente, agente: r.pdv.agente,
    departamento: r.pdv.departamento, ciudad_pdv: r.pdv.ciudad,
    canal: r.pdv.canal, razon_social: r.pdv.razon_social,
    producto_catalogo: o.producto_catalogo || null, match_confianza: r.matchConfianza,
    establecimiento: autoAprobada ? o.establecimiento || null : null,
    fecha_compra: autoAprobada ? o.fecha_compra || null : null,
    referencia_producto: autoAprobada ? o.producto_catalogo || null : null,
    presentacion: autoAprobada ? o.presentacion || null : null,
    cantidad: autoAprobada ? o.cantidad || null : null,
    valor_total: autoAprobada ? o.valor_total || null : null,
    estado: r.estado,
  });

  await saveConv(phone, { step: 'completo' }); conv.step = 'completo';

  if (!autoAprobada) {
    await supabase.from('gpmd_participants').update({ estado: 'en_revision' }).eq('id', part.id);
    await send(phone, `📩 Recibí tu factura. ${MSG_EN_REVISION}`);
    return conv;
  }

  // Pasa OCR → revisar cupo de confirmados
  const { count } = await supabase.from('gpmd_participants').select('*', { count: 'exact', head: true }).eq('estado', 'confirmado');
  if ((count || 0) >= LIMITE_CONFIRMADOS()) {
    await supabase.from('gpmd_participants').update({ estado: 'lista_espera' }).eq('id', part.id);
    await send(phone, '✅ ¡Tu factura es válida! Sin embargo los cupos ya se completaron, así que quedas en *lista de espera*. Te avisaremos si se habilita un cupo. 🙏');
    return conv;
  }

  await supabase.from('gpmd_participants').update({ estado: 'confirmado' }).eq('id', part.id);
  wati.updateContactAttributes(phone, [{ name: 'confirmado', value: 'true' }]).catch(() => {});
  await send(phone, `✅ *¡Felicitaciones, ${(part.nombre_piloto || '').split(' ')[0] || 'piloto'}!*\n\nTu factura fue verificada y tu cupo en el *Gran Premio Mobil Delvac 2026* está *CONFIRMADO*. 🏁\n\n🏁 Código: *${part.codigo_preregistro}*\n\n¡Nos vemos en la pista! 🚛💨`);
  return conv;
}

async function guardarFactura(participantId, campos) {
  await supabase.from('gpmd_facturas').insert({ participant_id: participantId, ...campos });
}

// Verifica que el buffer descargado sea realmente un PDF/imagen y no un
// placeholder roto (ej. bookmark de iOS de ~200 bytes en vez del PDF real).
function archivoValido(buffer, contentType) {
  if (!buffer || buffer.length < 500) return false;
  if ((contentType || '').includes('pdf')) return buffer.slice(0, 5).toString('latin1') === '%PDF-';
  const hex = buffer.slice(0, 4).toString('hex');
  return hex.startsWith('ffd8ff') || hex === '89504e47' || hex.startsWith('47494638') || hex.startsWith('52494646');
}

async function subirImagen(buffer, contentType, participantId) {
  const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
  const p = `${participantId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('facturas').upload(p, buffer, { contentType, upsert: true });
  if (error) { console.warn('[GPMD] storage upload:', error.message); return null; }
  return supabase.storage.from('facturas').getPublicUrl(p).data?.publicUrl || null;
}

module.exports = { processIncoming, STEPS, crearParticipante, procesarFactura, loadConv, saveConv };
