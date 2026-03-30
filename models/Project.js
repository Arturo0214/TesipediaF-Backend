import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
    {
        quote: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Quote',
            default: null,
        },
        generatedQuote: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GeneratedQuote',
            default: null,
        },
        clientName: {
            type: String,
            default: '',
        },
        clientEmail: {
            type: String,
            default: '',
        },
        writer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        client: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        payment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Payment',
            default: null,
        },
        clientPhone: {
            type: String,
            default: '',
        },
        status: {
            type: String,
            enum: ['pending', 'in_progress', 'review', 'completed', 'cancelled'],
            default: 'pending',
        },
        taskType: {
            type: String,
            required: true,
        },
        studyArea: {
            type: String,
            required: true,
        },
        career: {
            type: String,
            required: true,
        },
        educationLevel: {
            type: String,
            required: true,
        },
        taskTitle: {
            type: String,
            required: true,
        },
        requirements: {
            text: {
                type: String,
                required: true,
            },
            file: {
                filename: String,
                originalname: String,
                mimetype: String,
                path: String,
                size: Number,
            },
        },
        pages: {
            type: Number,
            required: true,
        },
        dueDate: {
            type: Date,
            required: true,
        },
        deliverables: [{
            filename: String,
            originalname: String,
            mimetype: String,
            path: String,
            size: Number,
            uploadedAt: {
                type: Date,
                default: Date.now
            }
        }],
        /* ── Version / revision tracking ── */
        revisions: [{
            version: { type: Number, required: true },          // 1, 2, 3…
            label: { type: String, default: '' },               // e.g. "Versión preliminar", "Corrección 1"
            type: {
                type: String,
                enum: ['preliminary', 'correction', 'revision', 'final'],
                default: 'revision'
            },
            file: {
                filename: String,
                originalname: String,
                mimetype: String,
                path: String,
                size: Number,
            },
            notes: { type: String, default: '' },               // description / advisor notes
            uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            createdAt: { type: Date, default: Date.now },
            status: {
                type: String,
                enum: ['delivered', 'pending_review', 'corrections_requested', 'approved'],
                default: 'delivered'
            },
            correctionNotes: { type: String, default: '' },     // advisor correction feedback
            correctionDate: { type: Date, default: null },
        }],
        progress: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },
        comments: [{
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                required: true
            },
            text: {
                type: String,
                required: true
            },
            createdAt: {
                type: Date,
                default: Date.now
            }
        }],
        googleCalendarEventId: {
            type: String,
            default: null
        },
        kanbanOrder: {
            type: Number,
            default: 0
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high', 'urgent'],
            default: 'medium'
        },
        color: {
            type: String,
            default: '#3b82f6'
        }
    },
    { timestamps: true }
);

const Project = mongoose.model('Project', projectSchema);
export default Project; 