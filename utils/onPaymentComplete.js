import Quote from '../models/Quote.js';
import GeneratedQuote from '../models/GeneratedQuote.js';

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
