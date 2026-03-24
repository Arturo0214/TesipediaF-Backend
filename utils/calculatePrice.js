const calculatePrice = (areaEstudios, nivelEstudios, extension, fechaEntrega, paymentMethod = 'card', taskType = '') => {
  let precioPorPagina = 0;
  const areaLower = areaEstudios.toLowerCase();
  const isSaludOrMath = areaLower.includes('salud') || areaLower.includes('matemáticas') || areaLower.includes('área 2');
  const isArticulo = taskType && taskType.toLowerCase().includes('artículo');

  // Determinar precio por página según tipo, área y nivel
  // PRECIOS ACTUALIZADOS (50% de los anteriores)
  if (isArticulo) {
    // Precios especiales para Artículos Científicos
    switch (nivelEstudios) {
      case 'Preparatoria':
        precioPorPagina = isSaludOrMath ? 150 : 135;
        break;
      case 'Licenciatura':
        precioPorPagina = isSaludOrMath ? 190 : 175;
        break;
      case 'Maestría':
      case 'Especialidad':
      case 'Diplomado':
        precioPorPagina = isSaludOrMath ? 225 : 205;
        break;
      case 'Doctorado':
        precioPorPagina = isSaludOrMath ? 260 : 240;
        break;
      default:
        precioPorPagina = 225;
    }
  } else {
    // Precios estándar para Tesis, Tesinas, etc.
    switch (nivelEstudios) {
      case 'Preparatoria':
        precioPorPagina = isSaludOrMath ? 100 : 85;
        break;
      case 'Licenciatura':
        precioPorPagina = isSaludOrMath ? 125 : 110;
        break;
      case 'Maestría':
      case 'Especialidad':
      case 'Diplomado':
        precioPorPagina = isSaludOrMath ? 150 : 135;
        break;
      case 'Doctorado':
        precioPorPagina = isSaludOrMath ? 175 : 160;
        break;
      default:
        precioPorPagina = 150;
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
