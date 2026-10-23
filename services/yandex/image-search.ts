import type { PanelCtx, Runner } from '../types';

const YANDEX = 'https://yandex.com/images/search';

// 1) POST JSON → URL de resultados.  2) Si falla, formulario multipart dentro del iframe.
export const runImageSearch: Runner = async (blob, ctx) => {
  ctx.setStatus('Buscando en Yandex…');
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
    if (ctx.isStale()) return; // llegó una búsqueda más nueva (ajuste de selección)
    console.log('[reverse-search] Yandex', res.status, text.slice(0, 500));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);

    const data = JSON.parse(text);
    const p = data?.blocks?.[0]?.params;
    let target: string | null = null;
    if (p?.url) target = p.url.startsWith('http') ? p.url : `${YANDEX}?${p.url}`;
    else if (p?.cbirId) target = `${YANDEX}?rpt=imageview&cbir_id=${encodeURIComponent(p.cbirId)}`;
    if (!target) throw new Error('Respuesta sin url/cbirId: ' + text.slice(0, 300));

    ctx.navigate(target);
    ctx.showFrame();
    ctx.onOpen(() => window.open(target, '_blank'));
  } catch (err) {
    console.error('[reverse-search] fetch falló, usando formulario', err);
    if (!ctx.isStale()) submitForm(blob, ctx);
  }
};

function submitForm(blob: Blob, ctx: PanelCtx) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.enctype = 'multipart/form-data';
  form.action = `${YANDEX}?rpt=imageview`;
  form.target = ctx.frame.name;

  const input = document.createElement('input');
  input.type = 'file';
  input.name = 'upfile';
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'image.png', { type: blob.type || 'image/png' }));
  input.files = dt.files;
  form.appendChild(input);
  document.body.appendChild(form);

  ctx.showFrame();
  ctx.onOpen(() => window.open(`${YANDEX}?rpt=imageview`, '_blank'));
  form.submit();
  form.remove();
}
