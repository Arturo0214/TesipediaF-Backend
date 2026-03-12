/**
 * Creates or updates a HubSpot contact when a quote is generated.
 * This ensures all clients who interact with the platform appear in HubSpot,
 * not just those who complete a payment.
 *
 * @param {Object} opts
 * @param {string} opts.email       - Client email (required for HubSpot contact)
 * @param {string} opts.name        - Client full name
 * @param {string} opts.phone       - Client phone number (optional)
 * @param {string} opts.lifecycle   - HubSpot lifecycle stage (default: 'lead')
 * @param {string} opts.source      - How the contact arrived ('cotizador' | 'endpoint' | 'chat')
 */
const syncHubSpotContact = async (opts = {}) => {
  const { email, name, phone, lifecycle = 'lead', source = '' } = opts;

  if (!email) {
    console.log('[syncHubSpotContact] No email provided, skipping');
    return null;
  }

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.log('[syncHubSpotContact] No HUBSPOT_ACCESS_TOKEN, skipping');
    return null;
  }

  try {
    // 1. Check if contact already exists by email
    const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: 'email', operator: 'EQ', value: email }] },
        ],
      }),
    });

    const searchData = await searchRes.json();

    if (searchData.results?.length > 0) {
      // Contact already exists — optionally update properties
      const existingId = searchData.results[0].id;
      console.log(`[syncHubSpotContact] Contact already exists: ${existingId} (${email})`);
      return { id: existingId, created: false };
    }

    // 2. Create a new contact
    const nameParts = (name || '').trim().split(/\s+/);
    const firstname = nameParts[0] || '';
    const lastname = nameParts.slice(1).join(' ') || '';

    const properties = {
      email,
      firstname,
      lastname,
      lifecyclestage: lifecycle,
    };

    if (phone) properties.phone = phone;
    if (source) properties.hs_lead_status = source === 'cotizador' ? 'Cotizador' : 'Cotización web';

    const createRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (createRes.ok) {
      const contact = await createRes.json();
      console.log(`[syncHubSpotContact] New contact created: ${contact.id} (${email})`);
      return { id: contact.id, created: true };
    } else {
      const errText = await createRes.text();
      // 409 = conflict (contact already exists) — not an error
      if (createRes.status === 409) {
        console.log(`[syncHubSpotContact] Contact already exists (409): ${email}`);
        return { id: null, created: false };
      }
      console.error('[syncHubSpotContact] HubSpot create failed:', createRes.status, errText);
      return null;
    }
  } catch (err) {
    // Don't break the quote flow for a HubSpot side-effect error
    console.error('[syncHubSpotContact] Error:', err.message);
    return null;
  }
};

export default syncHubSpotContact;
