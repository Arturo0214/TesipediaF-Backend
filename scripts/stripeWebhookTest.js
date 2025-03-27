import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const testWebhookEvent = async () => {
  try {
    const response = await axios.post(
      'http://localhost:8000/webhook/stripe',
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: {
              orderId: '67e2fe993b6eec62547b8480'
            }
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'test_signature_value'
        }
      }
    );

    console.log('✅ Webhook enviado con éxito');
    console.log(response.data);
  } catch (error) {
    console.error('❌ Error al simular el webhook');
    console.error(error.response?.data || error.message);
  }
};

testWebhookEvent();