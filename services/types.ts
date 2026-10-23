// Contratos comunes a todos los servicios (hoy solo Yandex; después Google, etc.)

export type ServiceId = 'yandex-search' | 'yandex-ocr';

/** Datos puros de un servicio (los usan el selector, el background y el panel). */
export type ServiceMeta = {
  title: string; // título en el panel lateral
  toast: string; // aviso superior del selector
  menuTitle?: string; // si existe: entrada en el menú del clic derecho del icono
};

/** Trabajo que el background le deja al panel lateral. */
export type Job = { id: string; service: ServiceId; image: string /* data URL PNG */ };

export const DEFAULT_SERVICE: ServiceId = 'yandex-search'; // clic izquierdo / Alt+Shift+S
export const JOB_KEY = 'pendingJob';
export const OCR_PAYLOAD_KEY = 'ocrPayload'; // imagen que el iframe de Yandex Traductor va a pedir

/** Lo que un servicio puede hacer con el panel lateral. */
export interface PanelCtx {
  jobId: string;
  frame: HTMLIFrameElement;
  isStale(): boolean; // llegó un trabajo más nuevo
  setStatus(text: string, isError?: boolean, detail?: string): void;
  showFrame(): void;
  navigate(url: string): void;
  onOpen(handler: (() => void) | null): void; // botón ↗ del encabezado
  banner(text: string, action?: { label: string; run: () => void }): void;
}

export type Runner = (image: Blob, ctx: PanelCtx) => Promise<void>;
