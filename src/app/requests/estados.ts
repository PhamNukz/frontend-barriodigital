import { EstadoTramite } from './requests.service';

/** Orden del flujo (sin RECHAZADO, que puede venir de cualquier paso). */
export const FLUJO: EstadoTramite[] = ['INGRESADO', 'ADMITIDO', 'EN_GESTION', 'EN_TERRENO', 'RESUELTO'];

/** Siguiente estado sugerido en la UI; el backend vuelve a validar la transicion. */
export const SIGUIENTE: Partial<Record<EstadoTramite, EstadoTramite>> = {
  INGRESADO: 'ADMITIDO',
  ADMITIDO: 'EN_GESTION',
  EN_GESTION: 'EN_TERRENO',
  EN_TERRENO: 'RESUELTO',
};

/** El backend usa el enum (EN_GESTION); la pantalla no tiene por que mostrar guiones bajos. */
export const ETIQUETA: Record<EstadoTramite, string> = {
  INGRESADO: 'Ingresado',
  ADMITIDO: 'Admitido',
  EN_GESTION: 'En gestión',
  EN_TERRENO: 'En terreno',
  RESUELTO: 'Resuelto',
  RECHAZADO: 'Rechazado',
};

/**
 * Lo que ve el vecino: palabras simples sobre el mismo enum (el backend no cambia).
 * ADMITIDO va antes que EN_GESTION porque admitir es la revision de requisitos y usa el cupo.
 */
export const ETIQUETA_VECINO: Record<EstadoTramite, string> = {
  INGRESADO: 'Solicitado',
  ADMITIDO: 'Aprobado',
  EN_GESTION: 'En proceso',
  EN_TERRENO: 'En camino',
  RESUELTO: 'Listo',
  RECHAZADO: 'No pudo seguir',
};

/** Que significa cada paso para el vecino, en una linea. */
export const DETALLE: Record<EstadoTramite, string> = {
  INGRESADO: 'Recibimos tu solicitud y la estamos revisando.',
  ADMITIDO: 'Cumple los requisitos y tomó un cupo del día.',
  EN_GESTION: 'Un funcionario la está trabajando.',
  EN_TERRENO: 'Una cuadrilla irá a la dirección indicada.',
  RESUELTO: 'Trámite cerrado. Te enviamos el certificado.',
  RECHAZADO: 'La solicitud no pudo seguir adelante.',
};
