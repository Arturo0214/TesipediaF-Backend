import mongoose from 'mongoose';

const uploadSchema = new mongoose.Schema(
  {
    fileUrl: {
      type: String,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['entrega', 'requisito', 'otro'],
      default: 'otro',
    },
    relatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'relatedModel',
    },
    relatedModel: {
      type: String,
      enum: ['Order', 'Quote'],
    },
  },
  {
    timestamps: true,
  }
);

const Upload = mongoose.model('Upload', uploadSchema);
export default Upload;
