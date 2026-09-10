import GuidePurchase from '../models/GuidePurchase.js';
import Event from '../models/Event.js';
import { getProducto } from '../config/guiaProductos.js';

/**
 * GET /guias/admin/stats  (protect + adminOnly)
 * Panel de Mercado Pago: embudo de la tienda (vistas → checkout → pago) + estado de pagos.
 * Las vistas/checkouts salen de los eventos (category 'store'); los pagos de GuidePurchase.
 */
export const getStoreStats = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      storeViews,
      productViews,
      checkouts,
      byStatus,
      revenueAgg,
      byProvider,
      byProduct,
      recent,
      dailyPaid,
    ] = await Promise.all([
      // Visitantes únicos que vieron la tienda (índice o producto)
      Event.aggregate([
        { $match: { createdAt: { $gte: since }, category: 'store', action: { $in: ['view_store', 'view_product'] } } },
        { $group: { _id: null, visitantes: { $addToSet: { $ifNull: ['$visitorId', '$sessionId'] } }, eventos: { $sum: 1 } } },
        { $addFields: { unicos: { $size: '$visitantes' } } },
        { $project: { visitantes: 0 } },
      ]),
      // Vistas de producto por guía (qué se mira más)
      Event.aggregate([
        { $match: { createdAt: { $gte: since }, category: 'store', action: 'view_product' } },
        { $group: { _id: '$label', vistas: { $sum: 1 }, visitantes: { $addToSet: { $ifNull: ['$visitorId', '$sessionId'] } } } },
        { $addFields: { unicos: { $size: '$visitantes' } } },
        { $project: { visitantes: 0 } },
        { $sort: { unicos: -1 } },
        { $limit: 20 },
      ]),
      // Checkouts iniciados (dieron clic en pagar → MercadoPago)
      Event.aggregate([
        { $match: { createdAt: { $gte: since }, category: 'store', action: 'initiate_checkout' } },
        { $group: { _id: null, visitantes: { $addToSet: { $ifNull: ['$visitorId', '$sessionId'] } }, eventos: { $sum: 1 } } },
        { $addFields: { unicos: { $size: '$visitantes' } } },
        { $project: { visitantes: 0 } },
      ]),
      // Compras por estado
      GuidePurchase.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 }, monto: { $sum: '$amount' } } },
      ]),
      // Ingresos confirmados (pagados)
      GuidePurchase.aggregate([
        { $match: { createdAt: { $gte: since }, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      // Por proveedor de pago
      GuidePurchase.aggregate([
        { $match: { createdAt: { $gte: since }, status: 'paid' } },
        { $group: { _id: '$provider', count: { $sum: 1 }, monto: { $sum: '$amount' } } },
        { $sort: { monto: -1 } },
      ]),
      // Ventas por producto
      GuidePurchase.aggregate([
        { $match: { createdAt: { $gte: since }, status: 'paid' } },
        { $group: { _id: '$productId', nombre: { $first: '$productName' }, count: { $sum: 1 }, monto: { $sum: '$amount' } } },
        { $sort: { monto: -1 } },
        { $limit: 20 },
      ]),
      // Últimas compras (todas, para ver pendientes/fallidas también)
      GuidePurchase.find({ createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .limit(40)
        .select('productId productName email amount currency provider status createdAt downloadCount emailedAt')
        .lean(),
      // Serie diaria de ingresos pagados (para la gráfica)
      GuidePurchase.aggregate([
        { $match: { createdAt: { $gte: since }, status: 'paid' } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            monto: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const statusMap = byStatus.reduce((acc, s) => { acc[s._id] = s; return acc; }, {});
    const paidCount = statusMap.paid?.count || 0;
    const pendingCount = statusMap.pending?.count || 0;
    const failedCount = statusMap.failed?.count || 0;
    const revenue = revenueAgg[0]?.total || 0;

    const vistasUnicas = storeViews[0]?.unicos || 0;
    const checkoutsUnicos = checkouts[0]?.unicos || 0;

    const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

    res.json({
      days,
      funnel: {
        vistasTienda: vistasUnicas,
        vistasEventos: storeViews[0]?.eventos || 0,
        checkoutsIniciados: checkoutsUnicos,
        compras: paidCount,
        // Tasas de conversión del embudo
        tasaCheckout: pct(checkoutsUnicos, vistasUnicas),   // % de visitantes que inician pago
        tasaCompra: pct(paidCount, checkoutsUnicos),         // % de checkouts que se pagan
        tasaGlobal: pct(paidCount, vistasUnicas),            // % de visitantes que compran
      },
      pagos: {
        pagadas: paidCount,
        pendientes: pendingCount,
        fallidas: failedCount,
        ingresos: revenue,
        ticketPromedio: paidCount > 0 ? Math.round(revenue / paidCount) : 0,
      },
      porProveedor: byProvider.map((p) => ({ provider: p._id, count: p.count, monto: p.monto })),
      porProducto: byProduct.map((p) => ({
        productId: p._id,
        nombre: p.nombre || getProducto(p._id)?.nombre || p._id,
        count: p.count,
        monto: p.monto,
      })),
      vistasPorProducto: productViews.map((v) => ({
        productId: v._id || 'desconocido',
        nombre: v._id || 'Desconocido',
        vistas: v.vistas,
        visitantes: v.unicos,
      })),
      recientes: recent.map((r) => ({
        productId: r.productId,
        nombre: r.productName || getProducto(r.productId)?.nombre || r.productId,
        email: r.email,
        amount: r.amount,
        currency: r.currency,
        provider: r.provider,
        status: r.status,
        createdAt: r.createdAt,
        descargas: r.downloadCount || 0,
        entregada: Boolean(r.emailedAt),
      })),
      serieDiaria: dailyPaid.map((d) => ({ fecha: d._id, monto: d.monto, compras: d.count })),
    });
  } catch (err) {
    console.error('[guias stats] error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
