// Solo lo importa el panel lateral (los runners usan APIs de DOM).
import type { Runner, ServiceId } from './types';
import { runImageSearch } from './yandex/image-search';
import { runOcrTranslate } from './yandex/ocr-translate';

export const RUNNERS: Record<ServiceId, Runner> = {
  'yandex-search': runImageSearch,
  'yandex-ocr': runOcrTranslate,
};
