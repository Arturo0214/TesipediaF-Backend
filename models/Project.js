import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
    {
        quote: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Quote',
            required: true,
            unique: true,
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
        }]
    },
    { timestamps: true }
);

const Project = mongoose.model('Project', projectSchema);
export default Project; 