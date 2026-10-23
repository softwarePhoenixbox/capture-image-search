import type { ServiceMeta } from '../types';

// Los atajos reales están en wxt.config.ts → manifest.commands (el nombre del comando = id del servicio)
export const yandexSearch: ServiceMeta = {
  title: 'Yandex',
  toast: 'Selecciona cualquier texto o imagen para buscar con Yandex',
  menuGroup: 'Yandex',
  menuTitle: 'Buscar por imagen  (Alt+Shift+S)',
};

export const yandexOcr: ServiceMeta = {
  title: 'Yandex Traductor',
  toast: 'Selecciona la imagen o el texto para traducirlo con Yandex',
  menuGroup: 'Yandex',
  menuTitle: 'OCR · Traducir imagen  (Alt+Shift+D)',
};
