const calculatePrice = (areaEstudios, nivelEstudios, extension) => {
  let basePrecio = 0;
  let costoPorPagina = 0;

  // Determinar precio base según área
  if (areaEstudios === 'Area1' || areaEstudios === 'Area2') {
    basePrecio = 240;
  } else if (areaEstudios === 'Area3' || areaEstudios === 'Area4') {
    basePrecio = 220;
  }

  // Añadir costo adicional por página según nivel
  if (nivelEstudios === 'Maestría') {
    costoPorPagina = 20;
  } else if (nivelEstudios === 'Doctorado') {
    costoPorPagina = 40;
  }

  const precioFinal = basePrecio + (costoPorPagina * extension);
  return precioFinal;
};

export default calculatePrice;