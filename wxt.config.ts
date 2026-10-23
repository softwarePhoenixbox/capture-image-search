import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Reverse Search',
    description: 'Selecciona una región de la página y búscala en Yandex (panel lateral)',
    permissions: ['activeTab', 'scripting', 'storage', 'declarativeNetRequest', 'sidePanel', 'contextMenus'],
    // Subir la imagen, ajustar Origin/Referer y poder mostrar Yandex dentro del panel
    host_permissions: ['https://*.yandex.com/*', 'https://yandex.com/*', 'https://*.yandex.ru/*', 'https://ya.ru/*'],
    action: { default_title: 'Buscar por imagen (Alt+Shift+S)' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Seleccionar región y buscar',
      },
    },
  },
});
