import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const generatedQuoteSchema = new mongoose.Schema(
    {
        publicId: {
            type: String,
            default: uuidv4,
            unique: true,
        },
        clientName: {
            type: String,
            required: true,
        },
        clientEmail: {
            type: String,
            default: '',
        },
        clientPhone: {
            type: String,
            default: '',
        },
        tipoTrabajo: {
            type: String,
            required: true,
        },
        tipoServicio: {
            type: String,
            required: true,
        },
        tituloTrabajo: {
            type: String,
            default: '',
        },
        area: {
            type: String,
            default: '',
        },
        carrera: {
            type: String,
            required: true,
        },
        extensionEstimada: {
            type: String, // Kept as String to match frontend, or could be Number
            required: true,
        },
        descripcionServicio: {
            type: String,
            default: '',
        },
        tiempoEntrega: {
            type: String,
            default: '',
        },
        fechaEntrega: {
            type: String, // Storing as string or Date? Frontend sends ISO string or formatted? SalesQuote sends formatted string in quoteData usually, but formData has ISO. 
            // In handleGeneratePDF: fechaEntrega: formData.fechaEntrega ? new Date(...).toLocaleDateString(...) : ''
            // It sends a formatted string "15 de febrero de 2026".
            // Better to store flexible string here.
            default: '',
        },
        precioBase: {
            type: Number,
            default: 0,
        },
        recargoMonto: {
            type: Number,
            default: 0,
        },
        recargoPorcentaje: {
            type: Number,
            default: 0,
        },
        recargoTexto: {
            type: String,
            default: '',
        },
        precioConRecargo: {
            type: Number,
            default: 0,
        },
        descuentoEfectivo: {
            type: Number,
            default: 0,
        },
        descuentoMonto: {
            type: Number,
            default: 0,
        },
        precioConDescuento: {
            type: Number,
            default: 0,
        },
        esquemaPago: {
            type: String,
            default: '',
        },
        modalidadCaptacion: {
            type: String,
            enum: ['tesipedia', 'manychat'],
            default: 'tesipedia',
        },
        serviciosIncluidos: {
            type: [String],
            default: [],
        },
        beneficiosAdicionales: [
            {
                descripcion: String,
                costo: Number,
            }
        ],
        ajustesIlimitados: {
            type: String,
            default: '',
        },
        acompañamientoContinuo: {
            type: String,
            default: '',
        },
        asesoria: {
            type: String,
            default: '',
        },
        notaAcompañamiento: {
            type: String,
            default: '',
        },
        metodoPago: {
            type: String,
            default: '',
        },
        generatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        vendedor: {
            type: String,
            default: '',
        },
        paidAt: {
            type: Date,
            default: null,
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'paid', 'cancelled'],
            default: 'pending',
        },
        pdfUrl: {
            type: String,
            default: null,
        },
        pdfPublicId: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

const GeneratedQuote = mongoose.model('GeneratedQuote', generatedQuoteSchema);
export default GeneratedQuote;
