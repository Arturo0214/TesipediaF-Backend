// Reconstrucción de parcialidades de una cotización pagada, con FECHAS REALES.
// Fuente única para el flujo de caja por mes del dashboard de Revenue.
// - personalizado: usa pagosCustom (montos y fechas reales) con descFactor.
// - 50-50 / 33-33-34 / quincenas / msi: extrae montos y fechas del texto esquemaPago
//   (que contiene las fechas reales en español), con fallback a cálculo por offsets.
// - único / sin esquema: un solo pago en la fecha de cierre.
// El estado (paid/pending) sale de installmentStatuses (lo que el agente marcó como cobrado).

const MESES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

const parseAmountsFromText = (text) => {
  if (!text) return [];
  const matches = [...text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)];
  return matches.map((m) => parseFloat(m[1].replace(/,/g, '')));
};

export const parseDatesFromText = (text) => {
  if (!text) return [];
  const dateRegex = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/g;
  const dates = [];
  let match;
  while ((match = dateRegex.exec(text)) !== null) {
    const day = parseInt(match[1]);
    const month = MESES[match[2].toLowerCase()];
    const year = parseInt(match[3]);
    // 'T12:00:00' evita corrimiento de día por zona horaria
    if (month !== undefined && !isNaN(day) && !isNaN(year)) {
      dates.push(new Date(year, month, day, 12, 0, 0));
    }
  }
  return dates;
};

// Normaliza el esquema a una clave. Revisa '33' antes de '50' porque montos como $3,085.50
// contienen '50' en los centavos.
export const normalizeEsquema = (raw) => {
  if (!raw) return 'unico';
  const lower = String(raw).toLowerCase();
  if (lower.includes('personaliz')) return 'personalizado';
  if (lower.includes('quincena')) return '6-quincenas';
  // MSI: preservar el número de meses (12 MSI, 12 meses sin intereses, 12-msi, "a 12 meses")
  const _mKey = lower.match(/^\s*(\d+)\s*-\s*msi\s*$/);
  const _mTxt = lower.match(/(\d+)\s*(?:msi|meses(?:\s+sin\s+intereses)?)/);
  if (_mKey) return `${_mKey[1]}-msi`;
  if (_mTxt) return `${_mTxt[1]}-msi`;
  if (lower.includes('mensual') || lower.includes('msi') || lower.includes('meses sin intereses')) return '6-msi';
  if (lower.includes('33%') || lower.includes('33-33')) return '33-33-34';
  if (lower.includes('50%') || lower.includes('50-50')) return '50-50';
  if (lower.includes('unico') || lower.includes('único')) return 'unico';
  return 'unico';
};

/**
 * Devuelve las parcialidades de una cotización pagada: [{ amount, fecha: Date, status }].
 * @param {object} q  GeneratedQuote (lean)
 */
export const buildInstallments = (q) => {
  const total = q.precioConDescuento || q.precioConRecargo || q.precioBase || 0;
  const esquema = q.esquemaTipo ? normalizeEsquema(q.esquemaTipo) : normalizeEsquema(q.esquemaPago);
  const start = new Date(q.paidAt || q.updatedAt || q.createdAt || Date.now());
  const statuses = q.installmentStatuses || {};
  const descFactor = 1 - ((parseFloat(q.descuentoEfectivo) || 0) / 100);
  const statusOf = (i) => (statuses[String(i)] === 'paid' ? 'paid' : 'pending');

  // Redondea a 2 decimales sin perder centavos reales (evita 500.49999 por flotantes).
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ── Personalizado: montos y fechas reales de pagosCustom ──
  if (esquema === 'personalizado' && Array.isArray(q.pagosCustom) && q.pagosCustom.length > 0) {
    return q.pagosCustom.map((p, i) => ({
      amount: r2((Number(p.monto) || 0) * descFactor),
      fecha: p.fecha ? new Date(`${p.fecha}T12:00:00`) : new Date(start),
      status: statusOf(i),
    }));
  }

  // ── 50-50 / 33-33-34 / N-quincenas / N-msi: extraer del texto, fallback a offsets ──
  const msiMatch = String(esquema).match(/^(\d+)-msi$/);
  const quincMatch = String(esquema).match(/^(\d+)-quincenas$/);
  if (['50-50', '33-33-34'].includes(esquema) || msiMatch || quincMatch) {
    const amounts = parseAmountsFromText(q.esquemaPago);
    const dates = parseDatesFromText(q.esquemaPago);
    const n = esquema === '50-50' ? 2 : esquema === '33-33-34' ? 3
      : msiMatch ? parseInt(msiMatch[1]) : quincMatch ? parseInt(quincMatch[1]) : 6;
    const stepDays = msiMatch ? 30 : 15;
    const insts = [];
    for (let i = 0; i < n; i++) {
      const amount = amounts[i] != null ? r2(amounts[i]) : r2(total / n);
      const fecha = dates[i] || new Date(start.getTime() + i * stepDays * 24 * 60 * 60 * 1000);
      insts.push({ amount, fecha, status: statusOf(i) });
    }
    // Cuadrar al total exacto ajustando el último pago: solo absorbe el remanente real
    // cuando el texto trae montos redondeados; con montos exactos no cambia nada.
    const sum = r2(insts.reduce((s, x) => s + x.amount, 0));
    if (insts.length && Math.abs(sum - r2(total)) > 0.005) {
      insts[insts.length - 1].amount = r2(insts[insts.length - 1].amount + (r2(total) - sum));
    }
    return insts;
  }

  // ── Único / sin esquema: un solo pago en la fecha de cierre ──
  return [{
    amount: r2(total),
    fecha: new Date(start),
    // Único: cobrado salvo que se haya marcado explícitamente pendiente
    status: statuses['0'] === 'pending' ? 'pending' : 'paid',
  }];
};
