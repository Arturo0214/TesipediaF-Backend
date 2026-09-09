// Ruta del Detector de IA (escáner estricto). Ejecuta el script Python
// scanner/scan_estricto_json.py sobre el .docx subido y devuelve JSON.
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'scanner', 'scan_estricto_json.py');
const PYTHON = process.env.PYTHON_BIN || 'python3';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ok = /\.docx?$/i.test(file.originalname) ||
      file.mimetype.includes('officedocument') || file.mimetype.includes('msword');
    cb(ok ? null : new Error('Solo se aceptan documentos Word (.docx)'), ok);
  },
});

function runScanner(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [SCRIPT, filePath], { timeout: 60000 });
    let out = '', err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 && !out.trim()) return reject(new Error(err || `scanner salió con código ${code}`));
      try { resolve(JSON.parse(out.trim().split('\n').pop())); }
      catch (e) { reject(new Error('salida no válida del escáner: ' + (err || out).slice(0, 200))); }
    });
  });
}

// POST /detector/scan  (multipart: file=<.docx>)
router.post('/scan', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún documento.' });
  const tmp = path.join(os.tmpdir(), `dia_${Date.now()}_${Math.round(Math.random() * 1e6)}.docx`);
  try {
    await fs.writeFile(tmp, req.file.buffer);
    const result = await runScanner(tmp);
    if (result.error) return res.status(422).json({ error: result.error });
    res.json(result);
  } catch (e) {
    console.error('Detector IA scan error:', e.message);
    res.status(500).json({ error: 'No se pudo analizar el documento en este momento.' });
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
});

// GET /detector/health — verifica que el runtime de Python esté disponible
router.get('/health', (req, res) => {
  const proc = spawn(PYTHON, ['-c', 'import docx; print("ok")']);
  let ok = '';
  proc.stdout.on('data', (d) => { ok += d; });
  proc.on('error', () => res.status(503).json({ ready: false, reason: 'python no disponible' }));
  proc.on('close', () => res.json({ ready: ok.trim() === 'ok', python: PYTHON }));
});

export default router;
