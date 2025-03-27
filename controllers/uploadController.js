import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';

export const uploadFiles = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    res.status(400);
    throw new Error('No se enviaron archivos');
  }

  const uploadResults = [];

  for (const file of req.files) {
    const fileBuffer = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

    const result = await cloudinary.uploader.upload(fileBuffer, {
      folder: 'uploads',
      resource_type: 'auto',
    });

    uploadResults.push({
      originalName: file.originalname,
      fileUrl: result.secure_url,
    });
  }

  res.status(200).json({
    message: 'Archivos subidos correctamente',
    files: uploadResults,
  });
});
