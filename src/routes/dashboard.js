const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const LIMITE = () => parseInt(process.env.LIMITE_CONFIRMADOS) || 150;

router.get('/', requireAuth(['admin', 'cliente']), async (req, res) => {
  const estados = ['pre_registrado', 'en_revision', 'confirmado', 'rechazado', 'lista_espera'];
  const [participantes, { data: facturas_estado }, { data: clientes }, { data: rechazos }] = await Promise.all([
    Promise.all(estados.map((e) => supabase.from('gpmd_participants').select('*', { count: 'exact', head: true }).eq('estado', e))),
    supabase.from('gpmd_facturas').select('estado'),
    supabase.from('gpmd_facturas').select('cliente').not('cliente', 'is', null),
    supabase.from('gpmd_facturas').select('razon_rechazo').eq('estado', 'rechazada').not('razon_rechazo', 'is', null),
  ]);

  const porEstado = {};
  estados.forEach((e, i) => { porEstado[e] = participantes[i].count || 0; });

  const conteo_facturas = {};
  (facturas_estado || []).forEach((f) => { conteo_facturas[f.estado] = (conteo_facturas[f.estado] || 0) + 1; });

  const porCliente = {};
  (clientes || []).forEach((f) => { if (f.cliente) porCliente[f.cliente] = (porCliente[f.cliente] || 0) + 1; });

  const causas = {};
  (rechazos || []).forEach((f) => { if (f.razon_rechazo) causas[f.razon_rechazo] = (causas[f.razon_rechazo] || 0) + 1; });

  const total = Object.values(porEstado).reduce((a, b) => a + b, 0);
  res.json({
    total_participantes: total,
    por_estado: porEstado,
    cupo: { confirmados: porEstado.confirmado, limite: LIMITE(), disponibles: Math.max(0, LIMITE() - porEstado.confirmado) },
    facturas: {
      aprobada_auto: conteo_facturas.aprobada_auto || 0,
      aprobada_manual: conteo_facturas.aprobada_manual || 0,
      en_revision: conteo_facturas.en_revision || 0,
      rechazada: conteo_facturas.rechazada || 0,
    },
    por_cliente: Object.entries(porCliente).map(([cliente, n]) => ({ cliente, n })).sort((a, b) => b.n - a.n).slice(0, 15),
    causas_rechazo: Object.entries(causas).map(([causa, n]) => ({ causa, n })).sort((a, b) => b.n - a.n),
  });
});

module.exports = router;
