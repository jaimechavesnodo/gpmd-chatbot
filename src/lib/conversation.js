// Máquina de estados conversacional del chatbot GPMD (orquestada por el backend).
// WATI reenvía cada mensaje entrante a /webhook/wati → processIncoming().
const supabase = require('./supabase');
const wati = require('./wati');
const ocr = require('./ocr');

// ---------- Catálogo de pasos de registro (en orden) ----------
const RH = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

const STEPS = [
  { field: 'cedula',
    q: 'Para empezar, ¿cuál es tu *número de cédula*? (solo números)',
    validate: (v) => (/^\d{5,12}$/.test(v.replace(/\D/g, '')) ? null : 'La cédula debe tener entre 5 y 12 dígitos. Inténtalo de nuevo:'),
    normalize: (v) => v.replace(/\D/g, '') },
  { field: 'nombre_piloto',
    q: '¿Cuál es tu *nombre completo* (piloto)?',
    validate: (v) => (v.trim().length >= 3 ? null : 'Por favor escribe tu nombre completo:') },
  { field: 'edad',
    q: '¿Qué *edad* tienes?',
    validate: (v) => { const n = parseInt(v); return n >= 18 && n <= 99 ? null : 'Indica una edad válida (18-99):'; },
    normalize: (v) => parseInt(v) },
  { field: 'tipo_participacion',
    q: '¿Eres piloto *novato* o *experto*?\n\n1️⃣ Novato\n2️⃣ Experto\n\nResponde *1* o *2*.',
    validate: (v) => { const t = parseTipo(v); return t ? null : 'Responde *1* (Novato) o *2* (Experto):'; },
    normalize: (v) => parseTipo(v) },
  { field: 'participaciones_anteriores',
    q: '¿En *cuántas* ediciones anteriores del Gran Premio has participado?',
    skipIf: (d) => d.tipo_participacion === 'novato',
    default: 0,
    validate: (v) => { const n = parseInt(v); return n >= 0 && n <= 50 ? null : 'Indica un número válido:'; },
    normalize: (v) => parseInt(v) },
  { field: 'rh',
    q: '¿Cuál es tu *grupo sanguíneo y RH*? (ej: O+, A-, B+)',
    validate: (v) => (RH.includes(normRH(v)) ? null : 'Indica un RH válido (O+, O-, A+, A-, B+, B-, AB+, AB-):'),
    normalize: (v) => normRH(v) },
  { field: 'eps',
    q: '¿A qué *EPS* estás afiliado?',
    validate: (v) => (v.trim().length >= 2 ? null : 'Escribe el nombre de tu EPS:') },
  { field: 'ciudad',
    q: '¿En qué *ciudad* resides?',
    validate: (v) => (v.trim().length >= 2 ? null : 'Escribe tu ciudad:') },
  { field: 'departamento',
    q: '¿En qué *departamento*?',
    validate: (v) => (v.trim().length >= 2 ? null : 'Escribe tu departamento:') },
  { field: 'email',
    q: '¿Cuál es tu *correo electrónico*? (si no tienes, escribe *no*)',
    optional: true,
    validate: (v) => (/^no$/i.test(v.trim()) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? null : 'Escribe un correo válido o *no*:'),
    normalize: (v) => (/^no$/i.test(v.trim()) ? '' : v.trim()) },
  { field: 'nombre_copiloto',
    q: '¿Cuál es el *nombre de tu copiloto*? (si no tienes, escribe *no*)',
    optional: true,
    normalize: (v) => (/^no$/i.test(v.trim()) ? '' : v.trim()) },
  { field: 'vehiculo_marca',
    q: 'Ahora los datos del *vehículo*. ¿Cuál es la *marca*? (ej: Kenworth, International, Freightliner)',
    validate: (v) => (v.trim().length >= 2 ? null : 'Escribe la marca del vehículo:') },
  { field: 'vehiculo_modelo',
    q: '¿Cuál es el *modelo / línea* del vehículo?',
    validate: (v) => (v.trim().length >= 1 ? null : 'Escribe el modelo:') },
  { field: 'vehiculo_cilindrada',
    q: '¿Cuál es la *cilindrada* del motor? (ej: 12000 cc, 15L)' },
  { field: 'vehiculo_empresa',
    q: '¿A qué *empresa de transporte* perteneces? (si eres independiente, escribe *independiente*)',
    optional: true },
  { field: 'vehiculo_placa',
    q: 'Por último, ¿cuál es la *placa* del vehículo?',
    validate: (v) => (v.replace(/\s/g, '').length >= 5 ? null : 'Escribe una placa válida:'),
    normalize: (v) => v.replace(/\s/g, '').toUpperCase() },
];

function parseTipo(v) {
  const s = v.trim().toLowerCase();
  if (s === '1' || s.includes('novato')) return 'novato';
  if (s === '2' || s.includes('experto')) return 'experto';
  return null;
}
function normRH(v) { return v.trim().toUpperCase().replace(/\s/g, '').replace('POSITIVO', '+').replace('NEGATIVO', '-'); }

const DIA_LABEL = {
  '2026-07-21': 'martes 21', '2026-07-22': 'miércoles 22',
  '2026-07-23': 'jueves 23', '2026-07-24': 'viernes 24',
};

function genCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = 'GPMD-';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

// ---------- Persistencia de conversación ----------
async function loadConv(phone) {
  const { data } = await supabase.from('gpmd_conversaciones').select('*').eq('phone', phone).maybeSingle();
  if (data) return data;
  const nuevo = { phone, step: 'inicio', data: {}, slots_cache: null };
  await supabase.from('gpmd_conversaciones').insert(nuevo);
  return nuevo;
}
async function saveConv(phone, patch) {
  await supabase.from('gpmd_conversaciones').update(patch).eq('phone', phone);
}

function stepIndex(field) { return STEPS.findIndex((s) => s.field === field); }

// Devuelve el siguiente paso aplicable (respeta skipIf), o null si terminó
function nextStep(fromIdx, data) {
  for (let i = fromIdx; i < STEPS.length; i++) {
    if (STEPS[i].skipIf && STEPS[i].skipIf(data)) {
      if (STEPS[i].default !== undefined) data[STEPS[i].field] = STEPS[i].default;
      continue;
    }
    return STEPS[i];
  }
  return null;
}

// ---------- Procesamiento principal ----------
// msg: { phone, text, type, mediaFileName, senderName }
// send: función async (phone, mensaje) — por defecto wati.sendSessionMessage
async function processIncoming(msg, send = wati.sendSessionMessage) {
  const phone = (msg.phone || '').replace(/\D/g, '');
  const text = (msg.text || '').trim();
  if (!phone) return;

  const conv = await loadConv(phone);

  // Comando global de reinicio
  if (/^(reiniciar|empezar de nuevo|reset)$/i.test(text)) {
    await saveConv(phone, { step: 'inicio', data: {}, slots_cache: null });
    conv.step = 'inicio'; conv.data = {};
  }

  // --- INICIO ---
  if (conv.step === 'inicio') {
    const { data: part } = await supabase
      .from('gpmd_participants')
      .select('estado, codigo_preregistro, nombre_piloto')
      .eq('phone', phone).maybeSingle();

    if (part && ['aprobado'].includes(part.estado)) {
      await send(phone, `✅ ¡Hola de nuevo${part.nombre_piloto ? ', ' + part.nombre_piloto.split(' ')[0] : ''}! Ya tienes tu registro *APROBADO* en el Gran Premio Mobil Delvac 2026.\n\n🏁 Tu código: *${part.codigo_preregistro}*\n\nSi necesitas ayuda, escribe a un asesor.`);
      return conv;
    }

    await send(phone,
      '🏁 *¡Bienvenido al Gran Premio Mobil Delvac 2026!* 🚛\n\n'
      + 'Te ayudaré a completar tu *pre-registro* para la revisión tecno-mecánica (21 al 24 de julio).\n\n'
      + 'Te haré algunas preguntas, elegirás tu turno y al final subirás la foto de tu factura de compra Mobil Delvac.\n\n'
      + 'En cualquier momento puedes escribir *reiniciar* para empezar de nuevo.');
    const first = nextStep(0, conv.data);
    await saveConv(phone, { step: `reg:${first.field}`, data: conv.data });
    await send(phone, first.q);
    return conv;
  }

  // --- RECOLECCIÓN DE DATOS ---
  if (conv.step.startsWith('reg:')) {
    const field = conv.step.slice(4);
    const idx = stepIndex(field);
    const step = STEPS[idx];

    if (!text) { await send(phone, step.q); return conv; }

    const err = step.validate ? step.validate(text) : null;
    if (err) { await send(phone, '⚠️ ' + err); return conv; }

    conv.data[field] = step.normalize ? step.normalize(text) : text.trim();

    const next = nextStep(idx + 1, conv.data);
    if (next) {
      await saveConv(phone, { step: `reg:${next.field}`, data: conv.data });
      await send(phone, next.q);
      return conv;
    }

    // Terminó la recolección → guardar participante y pasar a slots
    return finalizarRegistro(phone, conv, send);
  }

  // --- ELECCIÓN DE SLOT ---
  if (conv.step === 'slot') {
    const cache = conv.slots_cache || {};
    const opt = cache[text.replace(/\D/g, '')];
    if (!opt) {
      await send(phone, '⚠️ Responde con el *número* de la opción que prefieras:');
      await send(phone, formatSlots(cache));
      return conv;
    }
    return reservarSlot(phone, conv, opt, send);
  }

  // --- ESPERANDO FACTURA ---
  if (conv.step === 'factura') {
    if (msg.type === 'image' && msg.mediaFileName) {
      return procesarFactura(phone, conv, msg.mediaFileName, send);
    }
    await send(phone, '📸 Por favor envíame la *foto de tu factura* de compra del producto Mobil Delvac (en presentación participante). Debe verse clara y completa.');
    return conv;
  }

  // --- COMPLETO ---
  if (conv.step === 'completo') {
    await send(phone, 'Tu registro ya está completo y en proceso. Te notificaremos por aquí cualquier novedad. 🏁\n\nSi necesitas ayuda, escribe a un asesor.');
    return conv;
  }

  return conv;
}

async function finalizarRegistro(phone, conv, send) {
  const d = conv.data;
  const codigo = genCodigo();
  const row = {
    phone, cedula: d.cedula, nombre_piloto: d.nombre_piloto, edad: d.edad || null,
    tipo_participacion: d.tipo_participacion, participaciones_anteriores: d.participaciones_anteriores || 0,
    rh: d.rh, eps: d.eps, ciudad: d.ciudad, departamento: d.departamento, email: d.email || null,
    nombre_copiloto: d.nombre_copiloto || null, vehiculo_marca: d.vehiculo_marca, vehiculo_modelo: d.vehiculo_modelo,
    vehiculo_cilindrada: d.vehiculo_cilindrada || null, vehiculo_empresa: d.vehiculo_empresa || null,
    vehiculo_placa: d.vehiculo_placa, codigo_preregistro: codigo, estado: 'slot_pendiente',
  };
  const { error } = await supabase.from('gpmd_participants')
    .upsert(row, { onConflict: 'phone' }).select('id').single();

  if (error) {
    if (String(error.message || '').includes('cedula')) {
      await send(phone, '⚠️ Esa cédula ya está registrada con otro número. Si crees que es un error, escribe a un asesor.');
    } else {
      await send(phone, '⚠️ Hubo un problema guardando tus datos. Intenta de nuevo en unos minutos.');
    }
    console.error('[GPMD] upsert participante:', error.message);
    return conv;
  }

  await send(phone, `✅ ¡Datos guardados! Tu código de pre-registro es *${codigo}*.`);
  return mostrarSlots(phone, conv, send);
}

async function mostrarSlots(phone, conv, send) {
  const { data: slots } = await supabase
    .from('gpmd_slots').select('fecha, franja').is('participant_id', null);

  const conteo = {};
  for (const s of slots || []) {
    const k = `${s.fecha}|${s.franja}`;
    conteo[k] = (conteo[k] || 0) + 1;
  }
  const keys = Object.keys(conteo).sort();
  const cache = {};
  let i = 1;
  for (const k of keys) {
    const [fecha, franja] = k.split('|');
    cache[i] = { fecha, franja, disponibles: conteo[k] };
    i++;
  }

  if (Object.keys(cache).length === 0) {
    await send(phone, '😕 En este momento no hay turnos disponibles. Te avisaremos apenas se habiliten más.');
    return conv;
  }

  await saveConv(phone, { step: 'slot', slots_cache: cache });
  conv.step = 'slot'; conv.slots_cache = cache;
  await send(phone, '📅 *Elige tu turno* para la revisión tecno-mecánica:\n\n' + formatSlots(cache) + '\n\nResponde con el *número* de tu opción.');
  return conv;
}

function formatSlots(cache) {
  const horario = { AM: '8:00 a 12:00', PM: '2:00 a 6:00' };
  return Object.entries(cache)
    .map(([n, o]) => `${n}️⃣ ${DIA_LABEL[o.fecha] || o.fecha} de julio — ${o.franja} (${horario[o.franja]}) · ${o.disponibles} cupos`)
    .join('\n');
}

async function reservarSlot(phone, conv, opt, send) {
  const { data: part } = await supabase.from('gpmd_participants').select('id').eq('phone', phone).maybeSingle();
  if (!part) { await send(phone, '⚠️ No encuentro tu registro. Escribe *reiniciar* para empezar.'); return conv; }

  // Buscar un cupo libre y reservarlo (guard contra carrera)
  const { data: free } = await supabase.from('gpmd_slots')
    .select('id, hora_inicio, hora_fin').eq('fecha', opt.fecha).eq('franja', opt.franja)
    .is('participant_id', null).order('numero_slot').limit(1).maybeSingle();

  if (!free) {
    await send(phone, '😕 Ese horario se acaba de llenar. Elige otra opción:');
    await send(phone, formatSlots(conv.slots_cache || {}));
    return conv;
  }

  const { data: upd } = await supabase.from('gpmd_slots')
    .update({ participant_id: part.id, reservado_at: new Date().toISOString() })
    .eq('id', free.id).is('participant_id', null).select('id').maybeSingle();

  if (!upd) {
    await send(phone, '😕 Ese cupo se tomó justo ahora. Elige otra opción:');
    await send(phone, formatSlots(conv.slots_cache || {}));
    return conv;
  }

  await supabase.from('gpmd_participants').update({ estado: 'factura_pendiente' }).eq('id', part.id);
  await saveConv(phone, { step: 'factura' });
  conv.step = 'factura';

  const hi = (free.hora_inicio || '').slice(0, 5);
  const hf = (free.hora_fin || '').slice(0, 5);
  await send(phone, `✅ ¡Turno confirmado! *${DIA_LABEL[opt.fecha] || opt.fecha} de julio*, franja *${opt.franja}* (${hi} a ${hf}).`);
  await send(phone, '📸 *Último paso:* envíame la *foto de tu factura* de compra del producto Mobil Delvac. Asegúrate de que se vea clara, completa y legible.');
  return conv;
}

async function procesarFactura(phone, conv, mediaFileName, send) {
  await send(phone, '🔎 Recibí tu factura, dame un momento mientras la verifico...');

  const { data: part } = await supabase.from('gpmd_participants')
    .select('id, nombre_piloto, codigo_preregistro').eq('phone', phone).maybeSingle();
  if (!part) { await send(phone, '⚠️ No encuentro tu registro. Escribe *reiniciar*.'); return conv; }

  let resultado, imagenUrl = null;
  try {
    const { buffer, contentType } = await wati.downloadMedia(mediaFileName);
    imagenUrl = await subirImagen(buffer, contentType, part.id);
    resultado = await ocr.analizarFactura(buffer, contentType);
  } catch (e) {
    console.error('[GPMD] OCR error:', e.message);
    await send(phone, '⚠️ No pude procesar la imagen. Por favor envíala de nuevo, clara y completa.');
    return conv;
  }

  const o = resultado.ocr;
  await supabase.from('gpmd_facturas').insert({
    participant_id: part.id, imagen_url: imagenUrl || mediaFileName,
    ocr_raw: o, ocr_establecimiento: o.establecimiento || null, ocr_ciudad: o.ciudad || null,
    ocr_fecha_compra: o.fecha_compra || null, ocr_referencia_producto: o.referencia_producto || null,
    ocr_presentacion: o.presentacion || null, ocr_cantidad: o.cantidad || null,
    ocr_valor_total: o.valor_total || null, ocr_confianza: resultado.confianza,
    ocr_motivo_revision: resultado.motivo,
    establecimiento: resultado.pasaAuto ? o.establecimiento || null : null,
    ciudad: resultado.pasaAuto ? o.ciudad || null : null,
    fecha_compra: resultado.pasaAuto ? o.fecha_compra || null : null,
    referencia_producto: resultado.pasaAuto ? o.referencia_producto || null : null,
    presentacion: resultado.pasaAuto ? o.presentacion || null : null,
    cantidad: resultado.pasaAuto ? o.cantidad || null : null,
    valor_total: resultado.pasaAuto ? o.valor_total || null : null,
    estado: resultado.estado,
  });

  await supabase.from('gpmd_participants')
    .update({ estado: resultado.pasaAuto ? 'aprobado' : 'factura_en_revision' }).eq('id', part.id);
  await saveConv(phone, { step: 'completo' });
  conv.step = 'completo';

  if (resultado.pasaAuto) {
    await send(phone, `✅ *¡Felicitaciones, ${(part.nombre_piloto || '').split(' ')[0] || 'piloto'}!*\n\nTu factura fue verificada y tu registro en el *Gran Premio Mobil Delvac 2026* está *COMPLETO*. 🏁\n\nTu código: *${part.codigo_preregistro}*\n\nRecuerda presentarte en tu horario con los documentos originales. ¡Mucha suerte! 🚛💨`);
  } else {
    await send(phone, '⏳ Recibimos tu factura y la estamos *revisando manualmente*. Te notificaremos por aquí en un máximo de 24 horas con el resultado. ¡Gracias por tu paciencia!');
  }
  return conv;
}

async function subirImagen(buffer, contentType, participantId) {
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const path = `${participantId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('facturas').upload(path, buffer, { contentType, upsert: true });
  if (error) { console.warn('[GPMD] storage upload:', error.message); return null; }
  const { data } = supabase.storage.from('facturas').getPublicUrl(path);
  return data?.publicUrl || null;
}

module.exports = { processIncoming, STEPS };
