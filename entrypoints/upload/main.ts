import type { PendingSearch } from '../background';

const statusEl = document.getElementById('status')!;
const detailEl = document.getElementById('detail')!;
const previewEl = document.getElementById('preview') as HTMLImageElement;

const YANDEX = 'https://yandex.com/images/search';

async function main() {
  const stored = await browser.storage.session.get('pendingSearch');
  const pending = stored.pendingSearch as PendingSearch | undefined;
  if (!pending) {
    statusEl.textContent = 'No hay imagen pendiente. Usa el icono o Alt+Shift+S sobre una página.';
    return;
  }
  await browser.storage.session.remove('pendingSearch');

  previewEl.src = pending.image;
  previewEl.hidden = false;

  const blob = await (await fetch(pending.image)).blob();

  if (pending.engine === 'yandex') {
    await searchYandex(blob);
  }
}

// 1) POST JSON (obtiene la URL de resultados). 2) Si falla, formulario multipart normal.
async function searchYandex(blob: Blob) {
  statusEl.textContent = 'Subiendo a Yandex…';
  try {
    const form = new FormData();
    form.append('upfile', blob, 'image.png');

    const params = new URLSearchParams({
      rpt: 'imageview',
      format: 'json',
      request: JSON.stringify({ blocks: [{ block: 'b-page_type_search-by-image__link' }] }),
    });

    const res = await fetch(`${YANDEX}?${params}`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const text = await res.text();
    console.log('[reverse-search] Yandex', res.status, text.slice(0, 500));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);

    const data = JSON.parse(text);
    const p = data?.blocks?.[0]?.params;
    let target: string | null = null;
    if (p?.url) target = p.url.startsWith('http') ? p.url : `${YANDEX}?${p.url}`;
    else if (p?.cbirId) target = `${YANDEX}?rpt=imageview&cbir_id=${encodeURIComponent(p.cbirId)}`;
    if (!target) throw new Error('Respuesta sin url/cbirId: ' + text.slice(0, 300));

    location.replace(target);
  } catch (err) {
    console.error('[reverse-search] fetch falló, usando formulario', err);
    detailEl.textContent = String(err);
    statusEl.textContent = 'Reintentando con formulario…';
    submitForm(blob);
  }
}

function submitForm(blob: Blob) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.enctype = 'multipart/form-data';
  form.action = `${YANDEX}?rpt=imageview`;

  const input = document.createElement('input');
  input.type = 'file';
  input.name = 'upfile';
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'image.png', { type: blob.type || 'image/png' }));
  input.files = dt.files;

  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

main().catch((err) => {
  statusEl.textContent = 'Error';
  detailEl.textContent = String(err);
});
