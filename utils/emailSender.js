import nodemailer from 'nodemailer';

const emailSender = async (to, subject, html) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail', // o "outlook", "yahoo", etc.
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Tesipedia" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
    });

    console.log(`📩 Correo enviado a ${to}`);
  } catch (error) {
    console.error('❌ Error al enviar el correo:', error.message);
    throw new Error('No se pudo enviar el correo');
  }
};

export default emailSender;
