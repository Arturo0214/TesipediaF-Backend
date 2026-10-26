const calculatePrice = (areaEstudios, nivelEstudios, extension, fechaEntrega, paymentMethod = 'card', taskType = '', modalidadCaptacion = 'tesipedia') => {
  let precioPorPagina = 0;
  const areaLower = areaEstudios.toLowerCase();
  const isSaludOrMath = areaLower.includes('salud') || areaLower.includes('matemáticas') || areaLower.includes('área 2');
  const isArticulo = taskType && taskType.toLowerCase().includes('artículo');

  // Determinar precio por página según tipo, área y nivel
  // PRECIOS BASE AL 100% (Modalidad Tesipedia / integral).
  // RECALIBRADO 2026-10-24 a precios REALES: mediana de lo vendido ($101/pág) +
  // lo más cotizado ($110/pág) → base ~$105/pág en Licenciatura integral. Antes la
  // tabla estaba ~2x inflada ($220/pág) vs lo que de verdad se cobra. La corrección
  // (×0.5) cae en ~$52/pág, dentro del rango real vendido ($51-70).
  if (isArticulo) {
    // Precios especiales para Artículos Científicos (premium)
    switch (nivelEstudios) {
      case 'Preparatoria':
        precioPorPagina = isSaludOrMath ? 145 : 130;
        break;
      case 'Licenciatura':
        precioPorPagina = isSaludOrMath ? 180 : 165;
        break;
      case 'Maestría':
      case 'Especialidad':
      case 'Diplomado':
        precioPorPagina = isSaludOrMath ? 215 : 195;
        break;
      case 'Doctorado':
        precioPorPagina = isSaludOrMath ? 250 : 230;
        break;
      default:
        precioPorPagina = 195;
    }
  } else {
    // Precios estándar para Tesis, Tesinas, etc.
    switch (nivelEstudios) {
      case 'Preparatoria':
        precioPorPagina = isSaludOrMath ? 95 : 82;
        break;
      case 'Licenciatura':
        precioPorPagina = isSaludOrMath ? 120 : 105;
        break;
      case 'Maestría':
      case 'Especialidad':
      case 'Diplomado':
        precioPorPagina = isSaludOrMath ? 145 : 128;
        break;
      case 'Doctorado':
        precioPorPagina = isSaludOrMath ? 165 : 150;
        break;
      default:
        precioPorPagina = 128;
    }
  }

  // Aplicar descuento por modalidad de captación
  // Tesipedia (web/orgánico) = 100% | ManyChat (ads/redes) = 50%
  if (modalidadCaptacion === 'manychat') {
    precioPorPagina = precioPorPagina * 0.5;
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
