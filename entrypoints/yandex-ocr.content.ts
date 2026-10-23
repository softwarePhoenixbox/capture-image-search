import { dropImage } from '../services/yandex/ocr-page';

// Corre dentro de translate.yandex.com, pero SOLO cuando esa página está embebida en el panel
// lateral de esta extensión (no toca tus visitas normales a Yandex Traductor).
export default defineContentScript({
  matches: ['https://translate.yandex.com/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    if (window === window.top) return;
    const me = `chrome-extension://${browser.runtime.id}`;
    if (!Array.from(location.ancestorOrigins).includes(me)) return;
    void run();
  },
});

async function run() {
  browser.runtime.sendMessage({ type: 'ocr:alive' }).catch(() => {});
  const payload = (await browser.runtime.sendMessage({ type: 'ocr:get' })) as
    | { id: string; image: string }
    | null
    | undefined;
  if (!payload?.image) return;

  const r = await dropImage(payload.image);
  browser.runtime
    .sendMessage({ type: 'ocr:result', id: payload.id, ok: r.ok, reason: r.reason })
    .catch(() => {});
}
