import { ACTIVE_ENGINE, PENDING_KEY, type PendingSearch } from '../utils/shared';

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
    .catch((err) => console.error('[reverse-search] DNR', err));

  // Clic en el icono o Alt+Shift+S → inyecta (o cierra) el selector
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/content-scripts/content.js'],
      });
    } catch (err) {
      // Visible sin abrir la consola: "!" rojo en el icono + el error en su tooltip
      console.warn('[reverse-search] No se pudo inyectar el selector', err);
      await flagError(tab.id, `No se pudo usar aquí: ${String(err).slice(0, 180)}`);
    }
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const tab = sender.tab;
    if (!tab?.id) return;
    const tabId = tab.id;

    // El selector pide la captura de la pestaña (todavía sin overlay) para congelarla
    if (msg?.type === 'frame') {
      browser.tabs
        .captureVisibleTab(tab.windowId, { format: 'png' })
        .then((dataUrl) => sendResponse({ dataUrl }))
        .catch((err) => sendResponse({ error: String(err) }));
      return true;
    }

    if (msg?.type === 'error') {
      void flagError(tabId, `Error: ${String(msg.message).slice(0, 180)}`);
      return;
    }

    // Recorte ya hecho en la página → abrir panel y publicar la búsqueda
    if (msg?.type === 'region' && typeof msg.image === 'string') {
      // sidePanel.open exige gesto de usuario: se llama primero, sin await previo.
      const opened = browser.sidePanel
        .open({ tabId })
        .then(() => true)
        .catch((err) => {
          console.warn('[reverse-search] No se pudo abrir el panel lateral', err);
          return false;
        });

      const pending: PendingSearch = {
        id: crypto.randomUUID(),
        engine: ACTIVE_ENGINE,
        image: msg.image,
      };
      browser.storage.session
        .set({ [PENDING_KEY]: pending })
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
  });
});

async function flagError(tabId: number, title: string) {
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
  await browser.action.setBadgeText({ tabId, text: '!' });
  await browser.action.setTitle({ tabId, title });
  setTimeout(() => {
    browser.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    browser.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
  }, 8000);
}
