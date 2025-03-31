# Tesipedia - Plataforma de Servicios Académicos

## 📝 Descripción
Tesipedia es una plataforma web que conecta estudiantes con escritores profesionales para servicios académicos como tesis, ensayos y trabajos de investigación. La plataforma facilita el proceso de cotización, pago y seguimiento de pedidos académicos.

## 🚀 Características Principales

### 👤 Gestión de Usuarios
- Registro y autenticación de usuarios
- Perfiles diferenciados (estudiantes, escritores, administradores)
- Verificación de email
- Recuperación de contraseña
- Autenticación con Google

### 💰 Sistema de Pagos
- Integración con Stripe para pagos con tarjeta
- Integración con PayPal
- Sistema de reembolsos
- Historial de transacciones
- Notificaciones de pago

### 📋 Gestión de Pedidos
- Creación y seguimiento de pedidos
- Sistema de cotización
- Estado de progreso en tiempo real
- Sistema de archivos adjuntos
- Historial de revisiones

### 💬 Sistema de Chat
- Chat en tiempo real entre cliente y escritor
- Notificaciones de mensajes nuevos
- Historial de conversaciones
- Soporte para archivos adjuntos

### 🔔 Sistema de Notificaciones
- Notificaciones en tiempo real
- Notificaciones por email
- Diferentes tipos de notificaciones (pagos, mensajes, estados)
- Historial de notificaciones

### 📊 Panel de Administración
- Gestión de usuarios
- Gestión de pedidos
- Estadísticas y reportes
- Gestión de pagos
- Configuración del sistema

## 🛠️ Tecnologías Utilizadas

### Backend
- Node.js
- Express.js
- MongoDB
- Socket.IO
- JWT para autenticación
- Stripe API
- PayPal API
- Nodemailer

### Frontend
- React.js
- Redux Toolkit
- Material-UI
- Socket.IO Client
- Axios
- React Router

## 📦 Instalación

### Requisitos Previos
- Node.js (v14 o superior)
- MongoDB
- npm o yarn

### Configuración del Backend
1. Clonar el repositorio:
```bash
git clone https://github.com/tu-usuario/tesipedia.git
cd tesipedia/Backend
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
```bash
cp .env.example .env
```
Editar el archivo `.env` con tus configuraciones:
```env
PORT=8000
MONGODB_URI=tu_uri_de_mongodb
JWT_SECRET=tu_jwt_secret
CLIENT_URL=http://localhost:3000
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=tu_email
EMAIL_PASS=tu_password
EMAIL_FROM=tu_email
STRIPE_SECRET_KEY=tu_stripe_secret_key
STRIPE_WEBHOOK_SECRET=tu_stripe_webhook_secret
PAYPAL_CLIENT_ID=tu_paypal_client_id
PAYPAL_CLIENT_SECRET=tu_paypal_client_secret
SUPER_ADMIN_ID=id_del_admin
```

4. Iniciar el servidor:
```bash
npm run dev
```

### Configuración del Frontend
1. Navegar al directorio del frontend:
```bash
cd ../Frontend
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
```bash
cp .env.example .env
```
Editar el archivo `.env` con tus configuraciones:
```env
REACT_APP_API_URL=http://localhost:8000
REACT_APP_STRIPE_PUBLIC_KEY=tu_stripe_public_key
REACT_APP_PAYPAL_CLIENT_ID=tu_paypal_client_id
```

4. Iniciar la aplicación:
```bash
npm start
```

## 🔒 Seguridad
- Autenticación JWT
- Encriptación de contraseñas
- Protección contra CSRF
- Rate limiting
- Validación de datos
- Sanitización de inputs
- Manejo seguro de archivos

## 📱 Endpoints de la API

### Autenticación
- POST `/auth/register` - Registro de usuario
- POST `/auth/login` - Inicio de sesión
- POST `/auth/logout` - Cierre de sesión
- GET `/auth/profile` - Obtener perfil
- PUT `/auth/profile` - Actualizar perfil
- PUT `/auth/change-password` - Cambiar contraseña
- POST `/auth/forgot-password` - Recuperar contraseña
- POST `/auth/reset-password` - Restablecer contraseña
- GET `/auth/verify-email/:token` - Verificar email
- POST `/auth/resend-verification` - Reenviar verificación

### Usuarios
- GET `/users` - Obtener todos los usuarios (admin)
- GET `/users/:id` - Obtener usuario por ID
- PUT `/users/:id` - Actualizar usuario
- DELETE `/users/:id` - Eliminar usuario (admin)
- PUT `/users/:id/toggle-active` - Activar/desactivar usuario (admin)

### Pedidos
- POST `/orders` - Crear pedido
- GET `/orders` - Obtener todos los pedidos
- GET `/orders/:id` - Obtener pedido por ID
- PUT `/orders/:id` - Actualizar pedido
- DELETE `/orders/:id` - Eliminar pedido
- GET `/orders/my-orders` - Obtener pedidos del usuario
- POST `/orders/:id/assign` - Asignar escritor (admin)

### Cotizaciones
- POST `/quotes` - Crear cotización
- GET `/quotes` - Obtener todas las cotizaciones
- GET `/quotes/:id` - Obtener cotización por ID
- PUT `/quotes/:id` - Actualizar cotización
- DELETE `/quotes/:id` - Eliminar cotización
- GET `/quotes/my-quotes` - Obtener cotizaciones del usuario

### Pagos
- POST `/payments/create-session` - Crear sesión de pago Stripe
- POST `/payments/refund` - Reembolsar pago
- GET `/payments/history` - Historial de pagos
- GET `/payments/stats` - Estadísticas de pagos
- POST `/paypal/create-order` - Crear orden PayPal
- POST `/paypal/capture` - Capturar pago PayPal
- POST `/paypal/:id/refund` - Reembolsar pago PayPal

### Chat
- POST `/chat/messages` - Enviar mensaje
- GET `/chat/messages/:orderId` - Obtener mensajes por pedido
- PUT `/chat/messages/:id/read` - Marcar mensaje como leído
- GET `/chat/conversations` - Obtener conversaciones
- DELETE `/chat/messages/:id` - Eliminar mensaje

### Notificaciones
- GET `/notifications` - Obtener notificaciones
- PUT `/notifications/:id/read` - Marcar notificación como leída
- PUT `/notifications/read-all` - Marcar todas como leídas
- DELETE `/notifications/:id` - Eliminar notificación
- GET `/notifications/stats` - Estadísticas de notificaciones

### Archivos
- POST `/upload` - Subir archivo
- DELETE `/upload/:id` - Eliminar archivo
- GET `/upload/:id` - Obtener archivo
- GET `/upload/history` - Historial de archivos

## 🤝 Contribución
1. Fork el repositorio
2. Crear una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir un Pull Request

## 📄 Licencia
Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE.md](LICENSE.md) para más detalles.

## 👥 Autores
- Arturo Suárez - [@arturosuarez](https://github.com/arturosuarez)

## 🙏 Agradecimientos
- PayPal Developer
- Stripe
- MongoDB
- Socket.IO
- Material-UI 