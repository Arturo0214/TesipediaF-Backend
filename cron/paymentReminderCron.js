/**
 * Payment Reminder Cron
 * Se ejecuta diariamente a las 9:00 AM para enviar recordatorios de pagos próximos.
 * - 3 días antes: recordatorio amigable
 * - Día del pago: recordatorio urgente
 * - 1 día después (vencido): aviso de pago vencido
 */
import cron from 'node-cron';
import Payment from '../models/Payment.js';
import sendEmail from '../utils/emailSender.js';

const ADMIN_EMAILS = ['tesipediaoficial@gmail.com'];
const WA_PHONE_ID = process.env.WA_PHONE_ID;
const WA_TOKEN = process.env.WA_TOKEN;

function formatMoney(amount) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount || 0);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function sendWhatsAppReminder(phone, message) {
  if (!WA_PHONE_ID || !WA_TOKEN || !phone) return;
  const cleanNumber = phone.replace(/\D/g, '');
  try {
    await fetch(`https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'text',
        text: { body: message },
      }),
    });
  } catch (err) {
    console.warn(`[PaymentReminder] WhatsApp send failed for ${phone}:`, err.message);
  }
}

async function runPaymentReminders() {
  console.log('[PaymentReminder] Ejecutando revisión de pagos próximos...');

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

  // Buscar pagos con parcialidades pendientes
  const payments = await Payment.find({
    'schedule.status': 'pending',
  }).lean();

  let emailsSent = 0;
  let whatsappSent = 0;
  const reminders = [];

  for (const payment of payments) {
    for (const inst of (payment.schedule || [])) {
      if (inst.status === 'paid' || !inst.dueDate) continue;

      const dueDate = new Date(inst.dueDate);
      dueDate.setHours(0, 0, 0, 0);

      const diffDays = Math.round((dueDate - now) / (1000 * 60 * 60 * 24));

      let tipo = null;
      if (diffDays === 3) tipo = 'reminder_3days';
      else if (diffDays === 0) tipo = 'reminder_today';
      else if (diffDays === -1) tipo = 'overdue';
      else continue;

      const clientName = payment.clientName || 'Cliente';
      const amount = formatMoney(inst.amount);
      const date = formatDate(inst.dueDate);
      const title = payment.title || 'Proyecto';

      // Email al admin
      const adminSubject = tipo === 'overdue'
        ? `⚠️ Pago VENCIDO: ${clientName} — ${amount}`
        : tipo === 'reminder_today'
          ? `💰 Pago HOY: ${clientName} — ${amount}`
          : `📅 Pago en 3 días: ${clientName} — ${amount}`;

      const adminHtml = `
        <div style="font-family:Arial,sans-serif;max-width:500px;">
          <h2 style="color:${tipo === 'overdue' ? '#dc2626' : tipo === 'reminder_today' ? '#f59e0b' : '#2563eb'}">${adminSubject}</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#6b7280;">Cliente</td><td style="padding:6px 0;font-weight:600;">${clientName}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Proyecto</td><td style="padding:6px 0;">${title}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Parcialidad</td><td style="padding:6px 0;">${inst.label || `Pago ${inst.number}`}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Monto</td><td style="padding:6px 0;font-weight:700;color:#16a34a;">${amount}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Fecha</td><td style="padding:6px 0;">${date}</td></tr>
            ${payment.clientPhone ? `<tr><td style="padding:6px 0;color:#6b7280;">WhatsApp</td><td style="padding:6px 0;"><a href="https://wa.me/${payment.clientPhone.replace(/\D/g, '')}">${payment.clientPhone}</a></td></tr>` : ''}
          </table>
        </div>
      `;

      for (const adminEmail of ADMIN_EMAILS) {
        try {
          await sendEmail({ to: adminEmail, subject: adminSubject, html: adminHtml, text: `${adminSubject}\n${clientName} — ${amount} — ${date}` });
          emailsSent++;
        } catch (err) { console.warn('[PaymentReminder] Email failed:', err.message); }
      }

      // WhatsApp al cliente (solo reminder_today y overdue)
      if (payment.clientPhone && (tipo === 'reminder_today' || tipo === 'overdue')) {
        const firstName = clientName.split(' ')[0];
        const waMsg = tipo === 'reminder_today'
          ? `Hola ${firstName}, te recordamos que hoy es la fecha de tu ${inst.label || 'pago'} por ${amount} para tu proyecto "${title}" en Tesipedia. Puedes realizar tu pago por transferencia o tarjeta. Si ya pagaste, por favor envíanos tu comprobante. Gracias!`
          : `Hola ${firstName}, tu ${inst.label || 'pago'} por ${amount} para "${title}" venció ayer (${date}). Te pedimos que lo regularices a la brevedad para continuar con tu proyecto. Si necesitas ayuda o quieres ajustar tu esquema de pago, escríbenos.`;

        await sendWhatsAppReminder(payment.clientPhone, waMsg);
        whatsappSent++;
      }

      reminders.push({ tipo, clientName, amount: inst.amount, date: inst.dueDate, title });
    }
  }

  console.log(`[PaymentReminder] Completado: ${emailsSent} emails, ${whatsappSent} WhatsApp, ${reminders.length} recordatorios`);
  return { emailsSent, whatsappSent, reminders };
}

export function startPaymentReminderCron() {
  // Ejecutar diariamente a las 9:00 AM
  cron.schedule('0 9 * * *', runPaymentReminders);
  console.log('[PaymentReminder] Cron de recordatorios de pago iniciado (diario a las 9:00 AM)');
}

export { runPaymentReminders };
