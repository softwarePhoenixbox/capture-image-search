import { ACTIVE_ENGINE, PENDING_KEY, type PendingSearch } from '../utils/shared';

type Rect = { x: number; y: number; w: number; h: number };

export default defineBackground(() => {
  const id = browser.runtime.id;

  browser.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [1, 2],
      addRules: [
        {
          // Yandex rechaza Origin chrome-extension:// en la subida
          id: 1,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: 'https://yandex.com' },
              { header: 'Referer', operation: 'set', value: 'https://yandex.com/images/' },
            ],
          },
          condition: {
            urlFilter: '||yandex.com/images/search',
            requestMethods: ['post'],
            resourceTypes: ['xmlhttprequest', 'sub_frame'],
          },
        },
        {
          // Permite mostrar Yandex dentro del iframe del panel lateral
          id: 2,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
            ],
          },
          condition: {
            requestDomains: ['yandex.com', 'yandex.ru', 'ya.ru'],
            resourceTypes: ['sub_frame'],
          },
        },
      ],
    })
    .catch((err) => console.error('[reverse-search] DNR', id, err));

  // Clic en el icono o Alt+Shift+S → inyecta (o cierra) el selector
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/content-scripts/content.js'],
      });
    } catch (err) {
      console.warn('[reverse-search] No se puede usar en esta página', err);
    }
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'region' || !sender.tab?.id) return;
    const tab = sender.tab;

    // sidePanel.open exige gesto de usuario: se llama primero, sin await previo.
    const opened = browser.sidePanel
      .open({ tabId: tab.id! })
      .then(() => true)
      .catch((err) => {
        console.warn('[reverse-search] No se pudo abrir el panel lateral', err);
        return false;
      });

    handleRegion(tab.windowId, msg.rect, msg.viewportWidth)
      .then(async () => {
        // Plan B: si el panel no abrió, la misma página funciona en una pestaña
        if (!(await opened)) {
          await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
        }
        sendResponse({ ok: true });
      })
      .catch((err) => {
        console.error('[reverse-search]', err);
        sendResponse({ ok: false });
      });
    return true; // respuesta asíncrona
  });
});

async function handleRegion(windowId: number, rect: Rect, viewportWidth: number) {
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
  const image = await blobToDataUrl(await cropToBlob(dataUrl, rect, viewportWidth));
  const pending: PendingSearch = {
    id: crypto.randomUUID(),
    engine: ACTIVE_ENGINE,
    image,
  };
  await browser.storage.session.set({ [PENDING_KEY]: pending });
}

// La captura viene en píxeles físicos; el rect en píxeles CSS → escalar.
async function cropToBlob(dataUrl: string, rect: Rect, viewportWidth: number): Promise<Blob> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = bitmap.width / viewportWidth;
  const sx = Math.round(rect.x * scale);
  const sy = Math.round(rect.y * scale);
  const sw = Math.max(1, Math.round(rect.w * scale));
  const sh = Math.max(1, Math.round(rect.h * scale));

  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}
