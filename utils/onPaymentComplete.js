import Quote from '../models/Quote.js';
import GeneratedQuote from '../models/GeneratedQuote.js';
import Project from '../models/Project.js';
import emailSender from './emailSender.js';

/**
 * Shared handler for when a payment is confirmed.
 * - Updates the related quote status to 'paid'
 * - Creates a HubSpot deal if token is configured
 *
 * @param {Object} opts
 * @param {string} opts.orderId - MongoDB order ID (optional)
 * @param {string} opts.quoteId - MongoDB quote ID or publicId (optional)
 * @param {number} opts.amount - Payment amount
 * @param {string} opts.clientName - Client name
 * @param {string} opts.clientEmail - Client email
 * @param {string} opts.title - Order/project title
 */
const onPaymentComplete = async (opts = {}) => {
  const { orderId, quoteId, amount, clientName, clientEmail, title } = opts;

  try {
    // 1. Update quote status to 'paid' if we have a reference
    if (quoteId) {
      // Try regular Quote first
      const quote = await Quote.findById(quoteId).catch(() => null)
        || await Quote.findOne({ publicId: quoteId }).catch(() => null);

      if (quote && quote.status !== 'paid') {
        quote.status = 'paid';
        quote.convertedToOrder = true;
        await quote.save();
        console.log(`[onPaymentComplete] Quote ${quoteId} marked as paid`);

        // Auto-create project from paid quote
        try {
          const existingProject = await Project.findOne({ quote: quote._id });
          if (!existingProject) {
            const project = await Project.create({
              quote: quote._id,
              client: quote.user || null,
              taskType: quote.taskType,
              studyArea: quote.studyArea,
              career: quote.career,
              educationLevel: quote.educationLevel,
              taskTitle: quote.taskTitle,
              requirements: quote.requirements,
              pages: quote.pages,
              dueDate: quote.dueDate,
            });
            console.log(`[onPaymentComplete] Project created: ${project._id}`);
          }
        } catch (projErr) {
          console.error('[onPaymentComplete] Error creating project:', projErr.message);
        }

        // Send confirmation email to client
        try {
          const recipientEmail = clientEmail || quote.email;
          const recipientName = clientName || quote.name || 'Cliente';
          if (recipientEmail) {
            const emailHtml = `
              <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; padding: 0; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
                <div style="background: linear-gradient(135deg, #2575fc, #6a11cb); padding: 32px 24px; text-align: center;">
                  <h1 style="color: #fff; margin: 0; font-size: 24px;">Pago Confirmado</h1>
                  <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Tu proyecto ya fue registrado</p>
                </div>
                <div style="padding: 32px 24px;">
                  <p style="font-size: 16px; color: #374151;">Hola <strong>${recipientName}</strong>,</p>
                  <p style="font-size: 15px; color: #4b5563; line-height: 1.6;">
                    Tu pago ha sido confirmado exitosamente y tu proyecto <strong>"${quote.taskTitle}"</strong> ha sido registrado en nuestro sistema.
                  </p>
                  <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">Detalles del proyecto:</p>
                    <table style="width: 100%; font-size: 14px; color: #374151;">
                      <tr><td style="padding: 4px 0;"><strong>Tipo:</strong></td><td>${quote.taskType}</td></tr>
                      <tr><td style="padding: 4px 0;"><strong>Carrera:</strong></td><td>${quote.career}</td></tr>
                      <tr><td style="padding: 4px 0;"><strong>Nivel:</strong></td><td>${quote.educationLevel}</td></tr>
                      <tr><td style="padding: 4px 0;"><strong>P\u00e1ginas:</strong></td><td>${quote.pages}</td></tr>
                      <tr><td style="padding: 4px 0;"><strong>Fecha de entrega:</strong></td><td>${new Date(quote.dueDate).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
                      ${quote.priceDetails?.finalPrice ? `<tr><td style="padding: 4px 0;"><strong>Monto:</strong></td><td>$${quote.priceDetails.finalPrice.toFixed(2)} MXN</td></tr>` : ''}
                    </table>
                  </div>
                  <p style="font-size: 15px; color: #4b5563; line-height: 1.6;">
                    Nuestro equipo comenzar\u00e1 a trabajar en tu proyecto. Te mantendremos informado sobre el progreso.
                  </p>
                  <p style="font-size: 14px; color: #9ca3af; margin-top: 32px;">
                    Si tienes alguna duda, no dudes en contactarnos respondiendo a este correo.
                  </p>
                </div>
                <div style="background: #f9fafb; padding: 16px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
                  <p style="font-size: 12px; color: #9ca3af; margin: 0;">&copy; ${new Date().getFullYear()} Tesipedia | Todos los derechos reservados</p>
                </div>
              </div>
            `;
            await emailSender(recipientEmail, '✅ Pago Confirmado - Tu proyecto ha sido registrado | Tesipedia', emailHtml);
            console.log(`[onPaymentComplete] Confirmation email sent to ${recipientEmail}`);
          }
        } catch (emailErr) {
          console.error('[onPaymentComplete] Error sending confirmation email:', emailErr.message);
        }
      }

      // Also try GeneratedQuote
      const genQuote = await GeneratedQuote.findById(quoteId).catch(() => null);
      if (genQuote && genQuote.status !== 'paid') {
        genQuote.status = 'paid';
        await genQuote.save();
        console.log(`[onPaymentComplete] GeneratedQuote ${quoteId} marked as paid`);
      }
    }

    // 2. Create HubSpot deal
    const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!hubspotToken) {
      console.log('[onPaymentComplete] No HUBSPOT_ACCESS_TOKEN, skipping deal creation');
      return;
    }

    const dealData = {
      properties: {
        dealname: title || `Pago - ${clientName || 'Cliente'}`,
        amount: String(amount || 0),
        dealstage: 'closedwon', // Default HubSpot "Closed Won" stage
        closedate: new Date().toISOString(),
        pipeline: 'default',
        description: `Pago confirmado - ${clientName || ''} - ${clientEmail || ''} | Order: ${orderId || 'N/A'} | Quote: ${quoteId || 'N/A'}`,
      },
    };

    const dealRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hubspotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dealData),
    });

    if (dealRes.ok) {
      const deal = await dealRes.json();
      console.log(`[onPaymentComplete] HubSpot deal created: ${deal.id}`);

      // Try to associate with a contact by email
      if (clientEmail) {
        try {
          // Search for contact by email
          const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
            method: 'POST',
            headers: { Authorization: `Bearer ${hubspotToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: clientEmail }] }],
            }),
          });

          const searchData = await searchRes.json();
          if (searchData.results?.length > 0) {
            const contactId = searchData.results[0].id;

            // Associate deal with contact
            await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${deal.id}/associations/contacts/${contactId}/3`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${hubspotToken}` },
            });
            console.log(`[onPaymentComplete] Deal ${deal.id} associated with contact ${contactId}`);
          } else {
            // Create contact if not found
            const contactRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
              method: 'POST',
              headers: { Authorization: `Bearer ${hubspotToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                properties: {
                  email: clientEmail,
                  firstname: clientName?.split(' ')[0] || '',
                  lastname: clientName?.split(' ').slice(1).join(' ') || '',
                  lifecyclestage: 'customer',
                },
              }),
            });

            if (contactRes.ok) {
              const contact = await contactRes.json();
              await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${deal.id}/associations/contacts/${contact.id}/3`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${hubspotToken}` },
              });
              console.log(`[onPaymentComplete] New contact ${contact.id} created and associated with deal`);
            }
          }
        } catch (assocErr) {
          console.error('[onPaymentComplete] Error associating deal with contact:', assocErr.message);
        }
      }
    } else {
      const errText = await dealRes.text();
      console.error('[onPaymentComplete] HubSpot deal creation failed:', dealRes.status, errText);
    }
  } catch (err) {
    console.error('[onPaymentComplete] Error:', err.message);
    // Don't throw - this is a side-effect, don't break the payment flow
  }
};

export default onPaymentComplete;
