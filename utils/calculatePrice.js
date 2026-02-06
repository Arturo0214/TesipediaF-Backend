const calculatePrice = (areaEstudios, nivelEstudios, extension, fechaEntrega, paymentMethod = 'card', taskType = '') => {
  let precioPorPagina = 0;
  const areaLower = areaEstudios.toLowerCase();
  const isSaludOrMath = areaLower.includes('salud') || areaLower.includes('matemáticas') || areaLower.includes('área 2');
  const isArticulo = taskType && taskType.toLowerCase().includes('artículo');

  // Determinar precio por página según tipo, área y nivel
  if (isArticulo) {
    // Precios especiales para Artículos Científicos
    switch (nivelEstudios) {
      case 'Licenciatura':
        precioPorPagina = isSaludOrMath ? 380 : 350;
        break;
      case 'Maestría':
        precioPorPagina = isSaludOrMath ? 450 : 410;
        break;
      case 'Doctorado':
        precioPorPagina = isSaludOrMath ? 520 : 480;
        break;
      default: // Especialidad y otros
        precioPorPagina = 450;
    }
  } else {
    // Precios estándar para Tesis, Tesinas, etc.
    // Estandarizando lógica con quoteController
    switch (nivelEstudios) {
      case 'Licenciatura':
        precioPorPagina = isSaludOrMath ? 250 : 220;
        break;
      case 'Maestría':
        precioPorPagina = isSaludOrMath ? 300 : 270;
        break;
      case 'Doctorado':
        precioPorPagina = isSaludOrMath ? 350 : 320;
        break;
      default: // Especialidad y otros
        precioPorPagina = 300;
    }
  }

  // Calcular precio base
  let precioBase = precioPorPagina * Number(extension);
  let precioTotal = precioBase;
  let cargoUrgencia = 0;

  // Calcular cargo por urgencia
  if (fechaEntrega) {
    const selectedDate = new Date(fechaEntrega);
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    // Calcular fechas límite
    const threeWeeksFromNow = new Date(currentDate);
    threeWeeksFromNow.setDate(currentDate.getDate() + 21);

    const twoWeeksFromNow = new Date(currentDate);
    twoWeeksFromNow.setDate(currentDate.getDate() + 14);

    const oneWeekFromNow = new Date(currentDate);
    oneWeekFromNow.setDate(currentDate.getDate() + 7);

    // Calcular cargo por urgencia
    if (selectedDate.getTime() < threeWeeksFromNow.getTime()) {
      if (selectedDate.getTime() <= oneWeekFromNow.getTime()) {
        // 40% de cargo adicional para entrega en 1 semana o menos
        cargoUrgencia = precioBase * 0.4;
      } else if (selectedDate.getTime() <= twoWeeksFromNow.getTime()) {
        // 30% de cargo adicional para entrega en 2 semanas
        cargoUrgencia = precioBase * 0.3;
      } else {
        // 20% de cargo adicional para entrega en menos de 3 semanas
        cargoUrgencia = precioBase * 0.2;
      }
    }
  }

  // Sumar cargo por urgencia al precio total
  precioTotal = precioBase + cargoUrgencia;

  // Aplicar descuento por pago en efectivo (10%)
  if (paymentMethod === 'cash') {
    precioTotal = precioTotal * 0.9;
  }

  return {
    precioBase: Math.round(precioBase),
    cargoUrgencia: Math.round(cargoUrgencia),
    precioTotal: Math.round(precioTotal),
    descuentoEfectivo: paymentMethod === 'cash' ? Math.round(precioTotal / 0.9 - precioTotal) : 0
  };
};

export default calculatePrice;