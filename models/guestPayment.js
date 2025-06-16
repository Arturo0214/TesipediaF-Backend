import mongoose from 'mongoose';

const guestPaymentSchema = new mongoose.Schema({
    quoteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quote',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    trackingToken: {
        type: String,
        required: true,
        unique: true
    },
    nombres: {
        type: String,
        required: true
    },
    apellidos: {
        type: String,
        required: true
    },
    correo: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['card', 'oxxo', 'spei', 'stripe'],
        default: 'card'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded', 'disputed'],
        default: 'pending'
    },
    paymentDetails: {
        type: Object,
        default: {}
    },
    // Campos para rastrear el envío de correos
    emailSent: {
        type: Boolean,
        default: false
    },
    emailSentAt: {
        type: Date,
        default: null
    },
    emailRetries: {
        type: Number,
        default: 0
    },
    emailError: {
        type: String,
        default: null
    },
    accountCreated: {
        type: Boolean,
        default: false
    },
    accountCreatedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

const GuestPayment = mongoose.model('GuestPayment', guestPaymentSchema);

export default GuestPayment; 