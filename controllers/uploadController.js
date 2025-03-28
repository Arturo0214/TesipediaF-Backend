import asyncHandler from 'express-async-handler';
import cloudinary from '../config/cloudinary.js';

// 📤 Subir múltiples archivos
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
      publicId: result.public_id,
    });
  }

  res.status(200).json({
    message: 'Archivos subidos correctamente',
    files: uploadResults,
  });
});

// 📤 Subir un solo archivo
export const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No se ha subido ningún archivo');
  }

  const fileBuffer = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

  const result = await cloudinary.uploader.upload(fileBuffer, {
    folder: 'uploads',
    resource_type: 'auto',
  });

  res.status(200).json({
    message: 'Archivo subido correctamente',
    file: {
      originalName: req.file.originalname,
      fileUrl: result.secure_url,
      publicId: result.public_id,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date()
    },
  });
});

// 🔍 Obtener archivo por ID
export const getFile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const result = await cloudinary.api.resource(id);
    res.json({
      fileUrl: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      resourceType: result.resource_type,
      createdAt: result.created_at,
    });
  } catch (error) {
    res.status(404);
    throw new Error('Archivo no encontrado');
  }
});

// ❌ Eliminar archivo
export const deleteFile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    await cloudinary.uploader.destroy(id);
    res.json({ message: 'Archivo eliminado correctamente' });
  } catch (error) {
    res.status(404);
    throw new Error('Archivo no encontrado');
  }
});

// 📤 Subir múltiples archivos
export const uploadMultipleFiles = asyncHandler(async (req, res) => {
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
      publicId: result.public_id,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date()
    });
  }

  res.status(200).json({
    message: 'Archivos subidos correctamente',
    files: uploadResults,
  });
});

// 🔍 Obtener información del archivo
export const getFileInfo = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const result = await cloudinary.api.resource(id);
    res.json({
      originalName: result.original_filename,
      fileUrl: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      resourceType: result.resource_type,
      size: result.bytes,
      width: result.width,
      height: result.height,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    });
  } catch (error) {
    res.status(404);
    throw new Error('Archivo no encontrado');
  }
});

// 🔗 Obtener URL del archivo
export const getFileUrl = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const result = await cloudinary.api.resource(id);
    res.json({
      fileUrl: result.secure_url,
      publicId: result.public_id
    });
  } catch (error) {
    res.status(404);
    throw new Error('Archivo no encontrado');
  }
});

// 📊 Obtener historial de carga
export const getUploadHistory = asyncHandler(async (req, res) => {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'uploads',
      max_results: 100,
      direction: 'desc'
    });

    const history = result.resources.map(file => ({
      originalName: file.original_filename,
      fileUrl: file.secure_url,
      publicId: file.public_id,
      format: file.format,
      size: file.bytes,
      createdAt: file.created_at,
      uploadedBy: req.user._id
    }));

    res.json(history);
  } catch (error) {
    res.status(500);
    throw new Error('Error al obtener el historial de carga');
  }
});

// 📈 Obtener estadísticas de carga
export const getUploadStats = asyncHandler(async (req, res) => {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'uploads',
      max_results: 500
    });

    const stats = {
      totalFiles: result.resources.length,
      totalSize: result.resources.reduce((acc, file) => acc + file.bytes, 0),
      byFormat: result.resources.reduce((acc, file) => {
        acc[file.format] = (acc[file.format] || 0) + 1;
        return acc;
      }, {}),
      byDate: result.resources.reduce((acc, file) => {
        const date = new Date(file.created_at).toISOString().split('T')[0];
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {})
    };

    res.json(stats);
  } catch (error) {
    res.status(500);
    throw new Error('Error al obtener las estadísticas de carga');
  }
});
