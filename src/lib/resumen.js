// Resumen operativo para los correos programados (3x/día) y reutilizable.
const supabase = require('./supabase');

const LIMITE = () => parseInt(process.env.LIMITE_CONFIRMADOS) || 150;
const APROBADAS = ['aprobada_auto', 'aprobada_manual'];
const ESTADOS = ['pre_registrado', 'en_revision', 'confirmado', 'rechazado', 'lista_espera'];

function agrupar(facturas, campo) {
  const m = {};
  for (const f of facturas) {
    const k = (f[campo] || '—').toString().trim() || '—';
    if (!m[k]) m[k] = { label: k, monto: 0, facturas: 0, unidades: 0 };
    m[k].monto += Number(f.valor_total) || 0;
    m[k].unidades += Number(f.cantidad) || 0;
    m[k].facturas += 1;
  }
  return Object.values(m).sort((a, b) => b.monto - a.monto);
}

async function construirResumen() {
  const [counts, { data: facturas }] = await Promise.all([
    Promise.all(ESTADOS.map((e) => supabase.from('gpmd_participants').select('*', { count: 'exact', head: true }).eq('estado', e))),
    supabase.from('gpmd_facturas').select('estado, agente, razon_social, cliente, ciudad_pdv, departamento, presentacion, cantidad, valor_total'),
  ]);
  const porEstado = {};
  ESTADOS.forEach((e, i) => { porEstado[e] = counts[i].count || 0; });
  const total = Object.values(porEstado).reduce((a, b) => a + b, 0);

  const facts = facturas || [];
  const aprobadas = facts.filter((f) => APROBADAS.includes(f.estado));
  const conteo = {};
  facts.forEach((f) => { conteo[f.estado] = (conteo[f.estado] || 0) + 1; });

  const pres = {};
  aprobadas.forEach((f) => { const k = f.presentacion || '—'; if (!pres[k]) pres[k] = { label: k, facturas: 0, unidades: 0 }; pres[k].facturas++; pres[k].unidades += Number(f.cantidad) || 0; });

  return {
    generado: new Date().toISOString(),
    registros: total,
    por_estado: porEstado,
    cupo: { confirmados: porEstado.confirmado, limite: LIMITE(), disponibles: Math.max(0, LIMITE() - porEstado.confirmado) },
    facturas: {
      recibidas: facts.length,
      aprobada_auto: conteo.aprobada_auto || 0,
      aprobada_manual: conteo.aprobada_manual || 0,
      en_revision: conteo.en_revision || 0,
      rechazada: conteo.rechazada || 0,
    },
    monto_total: aprobadas.reduce((a, f) => a + (Number(f.valor_total) || 0), 0),
    unidades_total: aprobadas.reduce((a, f) => a + (Number(f.cantidad) || 0), 0),
    por_agente: agrupar(aprobadas, 'agente').slice(0, 10),
    por_cliente: agrupar(aprobadas, 'cliente').slice(0, 10),
    por_razon_social: agrupar(aprobadas, 'razon_social').slice(0, 10),
    por_presentacion: Object.values(pres).sort((a, b) => b.facturas - a.facturas),
  };
}

const cop = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const num = (n) => (Number(n) || 0).toLocaleString('es-CO');

function tabla(titulo, filas, cols) {
  if (!filas.length) return `<h3 style="margin:18px 0 6px;font-size:14px;color:#111">${titulo}</h3><p style="color:#888;font-size:13px;margin:0">Sin datos aún.</p>`;
  const head = cols.map((c) => `<th align="${c.align || 'left'}" style="padding:6px 8px;border-bottom:2px solid #eee;font-size:12px;color:#666;text-transform:uppercase">${c.h}</th>`).join('');
  const body = filas.map((r) => `<tr>${cols.map((c) => `<td align="${c.align || 'left'}" style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#222">${c.f(r)}</td>`).join('')}</tr>`).join('');
  return `<h3 style="margin:18px 0 6px;font-size:14px;color:#111">${titulo}</h3>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function resumenHtml(d) {
  const e = d.por_estado;
  const dimCols = [
    { h: 'Nombre', f: (r) => r.label },
    { h: 'Facturas', align: 'right', f: (r) => num(r.facturas) },
    { h: 'Monto', align: 'right', f: (r) => cop(r.monto) },
    { h: 'Unidades', align: 'right', f: (r) => num(r.unidades) },
  ];
  const kpi = (l, v, c) => `<td style="padding:10px 12px;background:${c};border-radius:10px;color:#fff;width:33%"><div style="font-size:12px;opacity:.85">${l}</div><div style="font-size:22px;font-weight:800">${v}</div></td>`;
  const fechaCO = new Date(d.generado).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:auto;color:#222">
    <h2 style="margin:0 0 2px">🏁 Gran Premio Mobil Delvac 2026 — Resumen</h2>
    <p style="color:#888;margin:0 0 14px;font-size:13px">${fechaCO} (hora Colombia)</p>
    <table width="100%" cellspacing="8" cellpadding="0"><tr>
      ${kpi('Registros (sin límite)', num(d.registros), '#FD05BA')}
      ${kpi('Confirmados', `${num(d.cupo.confirmados)} / ${d.cupo.limite}`, '#FF0C00')}
      ${kpi('En revisión', num(e.en_revision), '#FF7C00')}
    </tr><tr>
      ${kpi('Facturas recibidas', num(d.facturas.recibidas), '#a855f7')}
      ${kpi('Monto validado', cop(d.monto_total), '#16a34a')}
      ${kpi('Unidades validadas', num(d.unidades_total), '#0ea5e9')}
    </tr></table>
    <p style="font-size:13px;color:#555;margin:14px 0 0">
      Cupos disponibles: <b>${num(d.cupo.disponibles)}</b> · Aprobadas auto: <b>${num(d.facturas.aprobada_auto)}</b> ·
      manual: <b>${num(d.facturas.aprobada_manual)}</b> · rechazadas: <b>${num(d.facturas.rechazada)}</b> ·
      pre registrados: <b>${num(e.pre_registrado)}</b> · lista de espera: <b>${num(e.lista_espera)}</b>
    </p>
    ${tabla('Por Agente', d.por_agente, dimCols)}
    ${tabla('Por Cliente (PDV)', d.por_cliente, dimCols)}
    ${tabla('Por Razón Social', d.por_razon_social, dimCols)}
    ${tabla('Por Presentación', d.por_presentacion, [
      { h: 'Presentación', f: (r) => r.label },
      { h: 'Facturas', align: 'right', f: (r) => num(r.facturas) },
      { h: 'Unidades', align: 'right', f: (r) => num(r.unidades) },
    ])}
    <p style="color:#aaa;font-size:11px;margin-top:20px">Reporte automático del panel GPMD · nodo.host/gpmd-chatbot</p>
  </div>`;
}

module.exports = { construirResumen, resumenHtml };
