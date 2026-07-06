const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const LIMITE = () => parseInt(process.env.LIMITE_CONFIRMADOS) || 150;
const APROBADAS = ['aprobada_auto', 'aprobada_manual', 'aprobada_valor'];

// Agrega facturas aprobadas por una dimensión: { label: {monto, facturas, cantidad} }
function agrupar(facturas, campo) {
  const m = {};
  for (const f of facturas) {
    const k = (f[campo] || '—').trim() || '—';
    if (!m[k]) m[k] = { label: k, monto: 0, facturas: 0, cantidad: 0 };
    m[k].monto += Number(f.valor_total) || 0;
    m[k].cantidad += Number(f.cantidad) || 0;
    m[k].facturas += 1;
  }
  return Object.values(m).sort((a, b) => b.monto - a.monto);
}

router.get('/', requireAuth(['admin', 'cliente']), async (req, res) => {
  const estados = ['pre_registrado', 'en_revision', 'confirmado', 'rechazado', 'lista_espera'];
  const [participantes, { data: facturas }, { data: consentLog }] = await Promise.all([
    Promise.all(estados.map((e) => supabase.from('gpmd_participants').select('*', { count: 'exact', head: true }).eq('estado', e))),
    supabase.from('gpmd_facturas').select('estado, created_at, agente, razon_social, cliente, ciudad_pdv, departamento, presentacion, cantidad, valor_total, razon_rechazo'),
    supabase.from('gpmd_log').select('accion').eq('entidad', 'consentimiento'),
  ]);

  const autorizo = (consentLog || []).filter((l) => l.accion === 'autorizo').length;
  const noAutorizo = (consentLog || []).filter((l) => l.accion === 'no_autorizo').length;

  const porEstado = {};
  estados.forEach((e, i) => { porEstado[e] = participantes[i].count || 0; });
  const total = Object.values(porEstado).reduce((a, b) => a + b, 0);

  const facts = facturas || [];
  const aprobadas = facts.filter((f) => APROBADAS.includes(f.estado));

  // Facturas por estado
  const conteoEstado = {};
  facts.forEach((f) => { conteoEstado[f.estado] = (conteoEstado[f.estado] || 0) + 1; });

  // Facturas diarias recibidas (todas)
  const diario = {};
  facts.forEach((f) => { const d = (f.created_at || '').slice(0, 10); if (d) diario[d] = (diario[d] || 0) + 1; });
  const facturas_diarias = Object.entries(diario).map(([fecha, n]) => ({ fecha, n })).sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Presentación (sobre aprobadas)
  const pres = {};
  aprobadas.forEach((f) => { const k = (f.presentacion || '—'); if (!pres[k]) pres[k] = { label: k, facturas: 0, cantidad: 0 }; pres[k].facturas += 1; pres[k].cantidad += Number(f.cantidad) || 0; });

  const causas = {};
  facts.filter((f) => f.estado === 'rechazada' && f.razon_rechazo).forEach((f) => { causas[f.razon_rechazo] = (causas[f.razon_rechazo] || 0) + 1; });

  res.json({
    // Registros (sin límite) vs Confirmados (límite 150)
    registros: total,
    total_participantes: total,
    por_estado: porEstado,
    cupo: { confirmados: porEstado.confirmado, limite: LIMITE(), disponibles: Math.max(0, LIMITE() - porEstado.confirmado) },
    facturas: {
      recibidas: facts.length,
      aprobada_auto: conteoEstado.aprobada_auto || 0,
      aprobada_manual: conteoEstado.aprobada_manual || 0,
      aprobada_valor: conteoEstado.aprobada_valor || 0,
      en_revision: conteoEstado.en_revision || 0,
      rechazada: conteoEstado.rechazada || 0,
    },
    // Montos acumulados / facturas / cantidad por dimensión (sobre facturas aprobadas)
    por_dimension: {
      agente: agrupar(aprobadas, 'agente'),
      razon_social: agrupar(aprobadas, 'razon_social'),
      cliente: agrupar(aprobadas, 'cliente'),
      ciudad: agrupar(aprobadas, 'ciudad_pdv'),
      departamento: agrupar(aprobadas, 'departamento'),
    },
    por_presentacion: Object.values(pres).sort((a, b) => b.facturas - a.facturas),
    consentimiento: { autorizo, no_autorizo: noAutorizo },
    facturas_diarias,
    causas_rechazo: Object.entries(causas).map(([causa, n]) => ({ causa, n })).sort((a, b) => b.n - a.n),
  });
});

module.exports = router;
