import type { ServiceId, ServiceMeta } from './types';
import { yandexOcr, yandexSearch } from './yandex/meta';

export const SERVICES: Record<ServiceId, ServiceMeta> = {
  'yandex-search': yandexSearch,
  'yandex-ocr': yandexOcr,
};

export const isServiceId = (v: unknown): v is ServiceId =>
  typeof v === 'string' && Object.hasOwn(SERVICES, v);
