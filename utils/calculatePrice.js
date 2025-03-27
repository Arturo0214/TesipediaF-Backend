const calculatePrice = (areaEstudios, nivelEstudios, extension) => {
  let costoPorPagina = 0;

  if (nivelEstudios === 'Maestría') {
    costoPorPagina = 20;
  } else if (nivelEstudios === 'Doctorado') {
    costoPorPagina = 40;
  }

  let basePrecio = 0;

  if (areaEstudios === 'Area1' || areaEstudios === 'Area2') {
    basePrecio = 240;
  } else if (areaEstudios === 'Area3' || areaEstudios === 'Area4') {
    basePrecio = 220;
  }

  const precioFinal = (basePrecio + costoPorPagina) * extension;
  return precioFinal;
};

export default calculatePrice;