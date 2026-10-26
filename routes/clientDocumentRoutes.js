import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import upload from '../middleware/multer.js';
import {
  uploadClientDocument, unlockClientDocument, listClientDocumentsAdmin,
  deleteClientDocument, getMyDocuments, getDocumentForClient,
} from '../controllers/clientDocumentController.js';
import { getMyMessages, sendMyMessage, myUnread, changeMyPassword } from '../controllers/portalChatController.js';

/* ── Admin: subir/procesar/liberar documentos protegidos ── */
export const adminRouter = express.Router();
adminRouter.use(protect, adminOnly);
adminRouter.get('/', listClientDocumentsAdmin);
adminRouter.post('/', upload.single('file'), uploadClientDocument);
adminRouter.post('/:id/unlock', unlockClientDocument);
adminRouter.delete('/:id', deleteClientDocument);

/* ── Portal: el cliente ve SUS documentos (solo lectura, imágenes firmadas) ── */
export const portalRouter = express.Router();
portalRouter.use(protect);
portalRouter.get('/documents', getMyDocuments);
portalRouter.get('/documents/:id', getDocumentForClient);
// Mini-chat del cliente con el equipo
portalRouter.get('/messages', getMyMessages);
portalRouter.get('/messages/unread', myUnread);
portalRouter.post('/messages', sendMyMessage);
portalRouter.post('/change-password', changeMyPassword);

export default { adminRouter, portalRouter };
