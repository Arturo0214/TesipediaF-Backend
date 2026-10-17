/**
 * Ventas PERSONALES de Arturo (flag `privado` en GeneratedQuote/Payment).
 * Solo las ven el superadmin y Paula; para cualquier otro admin se filtran
 * de Revenue, cotizaciones y pagos — listas Y totales, para que no se
 * noten por diferencia de sumas.
 */
export const puedeVerVentasPrivadas = (user) =>
  user?.role === 'superadmin' || /paula/i.test(user?.name || '');

// Fragmento de query/$match: {} para ojos autorizados, excluye privadas para el resto
export const filtroPrivado = (user) =>
  puedeVerVentasPrivadas(user) ? {} : { privado: { $ne: true } };

export default puedeVerVentasPrivadas;
