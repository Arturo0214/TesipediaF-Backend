// Fuente ÚNICA de verdad del esquema de pago de las cotizaciones.
// La usan TANTO el PDF (generateQuotePDF.js) COMO el guardado (saveGeneratedQuote).
// Cualquier flujo (SalesQuote, cotizadora de WhatsApp, IA) que cree una cotización
// pasa por aquí, de modo que el texto del esquema nunca se desincroniza entre flujos.

export const formatDateForDisplay = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
};

/**
 * Genera el texto legible del esquema de pago a partir de datos estructurados.
 *
 * @param {number} total  Monto total (precioConDescuento) — usado por esquemas % y MSI.
 * @param {object} d      Datos de la cotización. Campos relevantes:
 *   esquemaTipo:       '33-33-34' | '50-50' | 'personalizado' | 'unico' | '6-quincenales' | '6-mensuales' | 'N-msi'
 *   esquemaPago:       (opcional) texto libre o clave corta; solo se respeta el texto libre largo cuando NO hay esquemaTipo
 *   pagosCustom:       [{ monto, fecha }]  (para 'personalizado')
 *   fechasPagos:       ['YYYY-MM-DD', ...] (para quincenal/mensual/MSI)
 *   descuentoEfectivo: %  (se aplica a los montos de pagosCustom, que se capturan en pre-descuento)
 *   fechaPago1, fechaAvance, fechaPagoFinal, fechaEntregaRaw: fechas para los esquemas %.
 */
export const generarEsquemaPago = (total, d = {}) => {
    // Si esquemaPago viene como tipo corto ("33-33-34", "personalizado", etc.) y no hay esquemaTipo, usarlo como tipo
    if (d.esquemaPago && !d.esquemaTipo) {
        const shortKeys = ['33-33-34', '50-50', '6-quincenales', '6-mensuales', 'unico', 'personalizado'];
        const lower = d.esquemaPago.trim().toLowerCase();
        if (shortKeys.some(k => lower.includes(k)) || /^\d+-quincenales$/.test(lower) || /^\d+-msi$/.test(lower)) {
            d.esquemaTipo = d.esquemaPago.trim();
        }
    }
    // Si hay un tipo estructurado explícito, SIEMPRE regenerar el texto desde el tipo.
    // No confiar en un esquemaPago de texto que el frontend pudo armar mal
    // (p.ej. personalizado/único → "50%...50%..." por defecto).
    const structuredTypes = ['33-33-34', '50-50', '6-quincenales', '6-mensuales', 'unico', 'personalizado'];
    const tipoNorm = (d.esquemaTipo || '').trim();
    const esEstructurado = structuredTypes.includes(tipoNorm) || /^\d+-quincenales$/.test(tipoNorm) || /^\d+-msi$/.test(tipoNorm);
    // Solo usar el esquemaPago literal (texto largo con montos) cuando NO hay un tipo estructurado
    // (p.ej. acuerdos especiales redactados a mano por la IA o un agente).
    if (!esEstructurado && d.esquemaPago && d.esquemaPago.trim().length > 50) return d.esquemaPago;

    const fmt = (v) => '$' + new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

    // Fechas default
    const hoyStr = new Date().toISOString().split('T')[0];
    const fechaEntregaStr = d.fechaPagoFinal || d.fechaEntregaRaw || (new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
    // Respetar la fecha de avance que ponga el agente; si no, default a hoy+14
    const fechaAvanceStr = d.fechaAvance || (new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
    const pago1 = d.fechaPago1 || hoyStr;

    if (d.esquemaTipo === '33-33-34') {
        const part1 = Math.round(total * 0.33 * 100) / 100;
        const part2 = Math.round(total * 0.33 * 100) / 100;
        const part3 = Math.round((total - part1 - part2) * 100) / 100;
        return `33% (${fmt(part1)}) al iniciar el proyecto (${formatDateForDisplay(pago1)}), 33% (${fmt(part2)}) al entregar avance (${formatDateForDisplay(fechaAvanceStr)}) y 34% (${fmt(part3)}) al finalizar (${formatDateForDisplay(fechaEntregaStr)}), previo a la entrega de la versión final del documento.`;
    } else if (d.esquemaTipo === 'personalizado' && Array.isArray(d.pagosCustom) && d.pagosCustom.length > 0) {
        // Aplicar el descuento a los montos personalizados (se capturan pre-descuento) para que el esquema lo refleje
        const descFactor = 1 - ((parseFloat(d.descuentoEfectivo) || 0) / 100);
        let texto = `Esquema de ${d.pagosCustom.length} pagos personalizado: `;
        const pagosTexto = d.pagosCustom.map((p, i) => {
            const monto = Math.round((Number(p.monto) || 0) * descFactor * 100) / 100;
            return `Pago ${i + 1}: ${fmt(monto)} (${formatDateForDisplay(p.fecha)})`;
        }).join(', ');
        return texto + pagosTexto + '.';
    } else if (/^\d+-quincenales$/.test(d.esquemaTipo) || d.esquemaTipo === '6-mensuales' || /^\d+-msi$/.test(d.esquemaTipo)) {
        const quinMatch = d.esquemaTipo.match(/^(\d+)-quincenales$/);
        const msiMatch = d.esquemaTipo.match(/^(\d+)-msi$/);
        const numPagos = quinMatch ? parseInt(quinMatch[1]) : msiMatch ? parseInt(msiMatch[1]) : 6;
        const isQuincenal = !!quinMatch;
        const montoPago = Math.round((total / numPagos) * 100) / 100;
        const ultimoPago = Math.round((total - (montoPago * (numPagos - 1))) * 100) / 100;
        const tipoTexto = isQuincenal ? 'quincenales' : msiMatch ? 'mensuales sin intereses' : 'mensuales';
        let texto = `Esquema de ${numPagos} pagos ${tipoTexto}: `;

        const fechas = Array.isArray(d.fechasPagos) && d.fechasPagos.length === numPagos ? d.fechasPagos : Array(numPagos).fill(0).map((_, i) => {
            const nd = new Date(pago1);
            if (isQuincenal) nd.setDate(nd.getDate() + (i * 15));
            else nd.setMonth(nd.getMonth() + i);
            return nd.toISOString().split('T')[0];
        });
        const pagosTexto = fechas.map((fecha, index) => {
            const monto = index === numPagos - 1 ? ultimoPago : montoPago;
            return `Pago ${index + 1}: ${fmt(monto)} (${formatDateForDisplay(fecha)})`;
        }).join(', ');
        return texto + pagosTexto + '.';
    } else if (d.esquemaTipo === 'unico') {
        return `Pago único de ${fmt(total)} al iniciar el proyecto (${formatDateForDisplay(pago1)}).`;
    }

    const mitad = Math.round(total * 0.50 * 100) / 100;
    const mitad2 = Math.round((total - mitad) * 100) / 100;
    return `50% (${fmt(mitad)}) al iniciar el proyecto (${formatDateForDisplay(pago1)}) y 50% (${fmt(mitad2)}) al finalizar (${formatDateForDisplay(fechaEntregaStr)}), previo a la entrega de la versión final del documento.`;
};
