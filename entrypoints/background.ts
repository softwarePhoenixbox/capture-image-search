import {
  DEFAULT_SERVICE,
  JOB_KEY,
  OCR_PAYLOAD_KEY,
  type Job,
  type ServiceId,
} from '../services/types';
import { SERVICES, isServiceId } from '../services/meta';
import { OCR_URL, dropImage } from '../services/yandex/ocr-page';

const DEFAULT_TITLE = 'Buscar por imagen (Alt+Shift+S)';

export default defineBackground(() => {
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
          // Permite mostrar Yandex (y translate.yandex.com) dentro del iframe del panel lateral
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
    .catch((err) => console.error('[reverse-search] DNR', err));

  // Clic derecho en el icono → una entrada por servicio que declare `menuTitle`.
  // (Hacer clic en una entrada del menú también concede activeTab.)
  browser.contextMenus
    .removeAll()
    .then(() => {
      for (const [id, m] of Object.entries(SERVICES)) {
        if (m.menuTitle) browser.contextMenus.create({ id, title: m.menuTitle, contexts: ['action'] });
      }
    })
    .catch((err) => console.error('[reverse-search] contextMenus', err));

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id && isServiceId(info.menuItemId)) void startSelector(tab.id, info.menuItemId);
  });

  // Clic izquierdo o Alt+Shift+S → servicio por defecto (búsqueda inversa)
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) void startSelector(tab.id, DEFAULT_SERVICE);
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const tab = sender.tab;

    switch (msg?.type) {
      // El selector pide la captura de la pestaña (todavía sin overlay) para congelarla
      case 'frame': {
        if (!tab?.id) return;
        browser.tabs
          .captureVisibleTab(tab.windowId, { format: 'png' })
          .then((dataUrl) => sendResponse({ dataUrl }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      case 'error': {
        if (tab?.id) void flagError(tab.id, `Error: ${String(msg.message).slice(0, 180)}`);
        return;
      }

      // Recorte ya hecho en la página → abrir panel y publicar el trabajo
      case 'region': {
        if (!tab?.id || typeof msg.image !== 'string') return;
        const tabId = tab.id;
        const service: ServiceId = isServiceId(msg.service) ? msg.service : DEFAULT_SERVICE;

        // sidePanel.open exige gesto de usuario: se llama primero, sin await previo.
        const opened = browser.sidePanel
          .open({ tabId })
          .then(() => true)
          .catch((err) => {
            console.warn('[reverse-search] No se pudo abrir el panel lateral', err);
            return false;
          });

        const job: Job = { id: crypto.randomUUID(), service, image: msg.image };
        const data: Record<string, unknown> = { [JOB_KEY]: job };
        // El iframe de Yandex Traductor no puede leer storage.session: la pide por mensaje
        if (service === 'yandex-ocr') data[OCR_PAYLOAD_KEY] = { id: job.id, image: job.image };

        browser.storage.session
          .set(data)
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
        return true;
      }

      // El content script del iframe de translate.yandex.com pide la imagen a pegar
      case 'ocr:get': {
        browser.storage.session
          .get(OCR_PAYLOAD_KEY)
          .then((s) => sendResponse(s[OCR_PAYLOAD_KEY] ?? null));
        return true;
      }

      // ↗ / "Abrir en pestaña": misma imagen, pegada en una pestaña normal de Yandex Traductor
      case 'ocr:open-tab': {
        void ocrInTab().catch((err) => console.error('[reverse-search] ocrInTab', err));
        return;
      }
    }
  });
});

async function startSelector(tabId: number, service: ServiceId) {
  try {
    // El selector lee este valor al arrancar (mismo mundo aislado que el content script)
    await browser.scripting.executeScript({
      target: { tabId },
      func: (s: string) => {
        (window as unknown as { __rsService?: string }).__rsService = s;
      },
      args: [service],
    });
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
  } catch (err) {
    // Visible sin abrir la consola: "!" rojo en el icono + el error en su tooltip
    console.warn('[reverse-search] No se pudo inyectar el selector', err);
    await flagError(tabId, `No se pudo usar aquí: ${String(err).slice(0, 180)}`);
  }
}

async function ocrInTab() {
  const stored = await browser.storage.session.get(OCR_PAYLOAD_KEY);
  const payload = stored[OCR_PAYLOAD_KEY] as { id: string; image: string } | undefined;
  if (!payload) return;

  const tab = await browser.tabs.create({ url: OCR_URL });
  if (!tab.id) return;
  const tabId = tab.id;
  await new Promise<void>((resolve) => {
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const done = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const timer = setTimeout(done, 20_000);
    browser.tabs.onUpdated.addListener(onUpdated);
  });

  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: dropImage,
    args: [payload.image],
  });
  console.log('[reverse-search] ocrInTab →', res?.result);
}

async function flagError(tabId: number, title: string) {
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
  await browser.action.setBadgeText({ tabId, text: '!' });
  await browser.action.setTitle({ tabId, title });
  setTimeout(() => {
    browser.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    browser.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
  }, 8000);
}
