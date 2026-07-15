import Payment from '../models/Payment.js';
import Project from '../models/Project.js';

/**
 * Guard anti-plantillas-a-pagados.
 *
 * El estado_sofia del lead en Supabase puede quedarse desactualizado (el cliente
 * paga pero nadie mueve el estado a 'pagado'), y los jobs de seguimiento lo ven
 * como lead frío y le mandan plantilla — dinero tirado y mala experiencia.
 *
 * La fuente de verdad de pagos es Mongo (Payment/Project via clientPhone).
 * Este guard cruza contra ella antes de cualquier envío automático, y si el
 * lead ya pagó, auto-corrige su estado_sofia a 'pagado' en Supabase.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsndrldvjzwdarfhenfj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Tolera separadores y prefijos: "5612895927" matchea "+52 56 1289 5927"
const phoneRegex = (digits) => new RegExp(digits.split('').join('\\D*') + '\\D*$');

/** ¿Este teléfono tiene un pago real registrado (o un proyecto contratado)? */
export async function tienePagoRegistrado(phone) {
    const d = last10(phone);
    if (d.length < 10) return false;
    const rx = phoneRegex(d);
    const [pago, proyecto] = await Promise.all([
        // Solo pagos reales: completados o con alguna parcialidad pagada.
        // (Los 'pendiente' son intentos de Stripe abandonados — NO cuentan.)
        Payment.exists({ clientPhone: rx, $or: [{ status: 'completed' }, { 'schedule.status': 'paid' }] }),
        Project.exists({ clientPhone: rx }),
    ]);
    return !!(pago || proyecto);
}

/** Marca el lead como 'pagado' en Supabase (match por últimos 10 dígitos). */
export async function marcarLeadPagado(phone) {
    const d = last10(phone);
    if (d.length < 10 || !SUPABASE_SERVICE_KEY) return;
    await fetch(`${SUPABASE_URL}/rest/v1/leads?wa_id=like.*${d}`, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ estado_sofia: 'pagado' }),
    });
}

/**
 * Guard para los jobs de seguimiento: true = NO enviar (ya pagó).
 * Ante error de Mongo devuelve false para no frenar los envíos legítimos.
 */
export async function leadYaPago(waId) {
    try {
        if (!(await tienePagoRegistrado(waId))) return false;
        marcarLeadPagado(waId).catch(() => { /* self-heal best-effort */ });
        return true;
    } catch (e) {
        console.warn('[leadPagadoGuard] error consultando pagos:', e.message);
        return false;
    }
}
