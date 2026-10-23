import type { Runner } from '../types';
import { OCR_URL } from './ocr-page';

type Msg = { type?: string; id?: string; ok?: boolean; reason?: string };

// Espera un mensaje del content script que corre dentro del iframe (yandex-ocr.content.ts)
function waitFor(match: (m: Msg) => boolean, ms: number): Promise<Msg | null> {
  return new Promise((resolve) => {
    const done = (v: Msg | null) => {
      clearTimeout(timer);
      browser.runtime.onMessage.removeListener(onMsg);
      resolve(v);
    };
    const onMsg = (m: unknown) => {
      if (m && match(m as Msg)) done(m as Msg);
    };
    const timer = setTimeout(() => done(null), ms);
    browser.runtime.onMessage.addListener(onMsg);
  });
}

// El panel solo abre translate.yandex.com/en/ocr en el iframe. La imagen se la pega el content
// script del iframe, que la pide al background (el iframe no puede leer storage.session).
export const runOcrTranslate: Runner = async (_blob, ctx) => {
  ctx.setStatus('Abriendo Yandex Traductor…');
  ctx.navigate('about:blank'); // fuerza recarga aunque ya estuviera en la página de OCR
  await new Promise((r) => setTimeout(r, 50));
  if (ctx.isStale()) return;

  const openTab = () => void browser.runtime.sendMessage({ type: 'ocr:open-tab' });
  const alive = waitFor((m) => m.type === 'ocr:alive', 12_000);
  const result = waitFor((m) => m.type === 'ocr:result' && m.id === ctx.jobId, 60_000);

  ctx.navigate(OCR_URL);
  ctx.showFrame();
  ctx.onOpen(openTab); // ↗ = repetir en una pestaña normal, con la misma imagen

  const hello = await alive;
  if (ctx.isStale()) return;
  if (!hello) {
    ctx.banner('El panel no pudo pegar la imagen en Yandex.', {
      label: 'Abrir en pestaña',
      run: openTab,
    });
    return;
  }

  const r = await result;
  if (ctx.isStale()) return;
  if (!r) ctx.banner('Yandex no confirmó la imagen.', { label: 'Abrir en pestaña', run: openTab });
  else if (!r.ok)
    ctx.banner(`No se pudo pegar la imagen: ${r.reason ?? 'error desconocido'}`, {
      label: 'Abrir en pestaña',
      run: openTab,
    });
};
