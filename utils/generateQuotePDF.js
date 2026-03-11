import PDFDocument from 'pdfkit';

/**
 * Genera un PDF de cotización en memoria y devuelve un Buffer.
 * @param {Object} data - Datos de la cotización
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 */
function generateQuotePDF(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'LETTER',
                margins: { top: 50, bottom: 50, left: 60, right: 60 },
            });

            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const primaryColor = '#1a237e';
            const accentColor = '#ff6f00';
            const lightGray = '#f5f5f5';
            const darkText = '#212121';
            const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

            // ═══════════════════════════════════════
            // HEADER
            // ═══════════════════════════════════════
            doc
                .rect(0, 0, doc.page.width, 100)
                .fill(primaryColor);

            doc
                .font('Helvetica-Bold')
                .fontSize(28)
                .fillColor('#ffffff')
                .text('TESIPEDIA', 60, 30, { align: 'left' });

            doc
                .font('Helvetica')
                .fontSize(11)
                .fillColor('#bbdefb')
                .text('Cotización Personalizada', 60, 62, { align: 'left' });

            // Fecha y folio en la derecha del header
            const today = new Date();
            const fechaEmision = today.toLocaleDateString('es-MX', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
            });
            const folio = `COT-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 9000 + 1000)}`;

            doc
                .font('Helvetica')
                .fontSize(9)
                .fillColor('#bbdefb')
                .text(`Fecha: ${fechaEmision}`, 350, 35, { align: 'right', width: 180 })
                .text(`Folio: ${folio}`, 350, 50, { align: 'right', width: 180 });

            // ═══════════════════════════════════════
            // SALUDO
            // ═══════════════════════════════════════
            let y = 125;

            doc
                .font('Helvetica')
                .fontSize(12)
                .fillColor(darkText)
                .text(`Estimado/a ${data.nombre || 'Cliente'},`, 60, y);

            y += 25;
            doc
                .fontSize(10)
                .fillColor('#616161')
                .text(
                    'Gracias por tu interés en nuestros servicios. A continuación te presentamos la cotización personalizada para tu proyecto académico.',
                    60,
                    y,
                    { width: pageWidth, lineGap: 3 }
                );

            // ═══════════════════════════════════════
            // DATOS DEL PROYECTO (tabla)
            // ═══════════════════════════════════════
            y += 55;

            doc
                .font('Helvetica-Bold')
                .fontSize(13)
                .fillColor(primaryColor)
                .text('Datos del Proyecto', 60, y);

            y += 5;
            doc
                .moveTo(60, y + 17)
                .lineTo(60 + pageWidth, y + 17)
                .strokeColor(accentColor)
                .lineWidth(2)
                .stroke();

            y += 28;

            const campos = [
                { label: 'Servicio', value: data.tipoServicio || data.serviceType || '' },
                { label: 'Tipo de Proyecto', value: data.tipoProyecto || data.taskType || '' },
                { label: 'Carrera', value: data.carrera || data.career || '' },
                { label: 'Nivel Académico', value: data.nivel || data.educationLevel || '' },
                { label: 'Páginas', value: String(data.paginas || data.pages || '') },
                { label: 'Tema', value: data.tema || 'Por definir' },
                { label: 'Fecha de Entrega', value: data.fechaEntrega || 'Por definir' },
            ].filter((c) => c.value && c.value !== '');

            campos.forEach((campo, i) => {
                const bgColor = i % 2 === 0 ? lightGray : '#ffffff';
                doc.rect(60, y, pageWidth, 24).fill(bgColor);

                doc
                    .font('Helvetica-Bold')
                    .fontSize(10)
                    .fillColor('#424242')
                    .text(campo.label, 72, y + 7, { width: 160 });

                doc
                    .font('Helvetica')
                    .fontSize(10)
                    .fillColor(darkText)
                    .text(campo.value, 240, y + 7, { width: pageWidth - 180 });

                y += 24;
            });

            // ═══════════════════════════════════════
            // PRECIO
            // ═══════════════════════════════════════
            y += 20;

            doc
                .rect(60, y, pageWidth, 60)
                .fill(primaryColor);

            // Formatear precio
            let precioDisplay = data.precio || data.formattedPrice || data.totalPrice || '';
            if (typeof precioDisplay === 'number') {
                precioDisplay = '$' + precioDisplay.toLocaleString('es-MX') + ' MXN';
            } else if (precioDisplay && !String(precioDisplay).startsWith('$')) {
                const digits = String(precioDisplay).replace(/[^\d]/g, '');
                if (digits) {
                    precioDisplay = '$' + parseInt(digits).toLocaleString('es-MX') + ' MXN';
                }
            }

            doc
                .font('Helvetica')
                .fontSize(11)
                .fillColor('#bbdefb')
                .text('Tu Cotización', 80, y + 10);

            doc
                .font('Helvetica-Bold')
                .fontSize(24)
                .fillColor('#ffffff')
                .text(precioDisplay, 80, y + 26);

            // Precio por página si está disponible
            if (data.pricePerPage || data.precioPorPagina) {
                const ppp = data.pricePerPage || data.precioPorPagina;
                doc
                    .font('Helvetica')
                    .fontSize(9)
                    .fillColor('#bbdefb')
                    .text(`$${ppp} por página`, 350, y + 35, { align: 'right', width: 180 });
            }

            // ═══════════════════════════════════════
            // CONDICIONES
            // ═══════════════════════════════════════
            y += 85;

            doc
                .font('Helvetica-Bold')
                .fontSize(11)
                .fillColor(primaryColor)
                .text('Condiciones', 60, y);

            y += 20;

            const condiciones = [
                'El precio incluye revisiones hasta la aprobación del proyecto.',
                'El plazo de entrega comienza una vez confirmado el pago.',
                'Se realizan entregas parciales para tu revisión.',
                'Garantía de originalidad con reporte antiplagio incluido.',
                'Esta cotización tiene una vigencia de 15 días.',
            ];

            condiciones.forEach((cond) => {
                doc
                    .font('Helvetica')
                    .fontSize(9)
                    .fillColor('#616161')
                    .text(`•  ${cond}`, 70, y, { width: pageWidth - 20, lineGap: 2 });
                y += 16;
            });

            // ═══════════════════════════════════════
            // FOOTER
            // ═══════════════════════════════════════
            y += 25;

            doc
                .moveTo(60, y)
                .lineTo(60 + pageWidth, y)
                .strokeColor('#e0e0e0')
                .lineWidth(0.5)
                .stroke();

            y += 12;

            doc
                .font('Helvetica')
                .fontSize(8)
                .fillColor('#9e9e9e')
                .text(
                    'Tesipedia | tesipedia.com | WhatsApp: +52 1 55 8335 2096',
                    60,
                    y,
                    { align: 'center', width: pageWidth }
                )
                .text(
                    `Documento generado automáticamente el ${fechaEmision} | ${folio}`,
                    60,
                    y + 12,
                    { align: 'center', width: pageWidth }
                );

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

export default generateQuotePDF;
