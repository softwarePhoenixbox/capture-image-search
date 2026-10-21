import { PENDING_KEY, type PendingSearch } from '../../utils/shared';

const YANDEX = 'https://yandex.com/images/search';

const statusEl = document.getElementById('status')!;
const frame = document.getElementById('results') as HTMLIFrameElement;
const openBtn = document.getElementById('open') as HTMLButtonElement;

let lastId = '';
let lastUrl = '';

function setStatus(text: string, isError = false, detail = '') {
  frame.style.display = 'none';
  statusEl.style.display = 'block';
  statusEl.className = isError ? 'error' : '';
  statusEl.textContent = text;
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail;
    statusEl.appendChild(pre);
  }
}

function showResults(url: string) {
  lastUrl = url;
  openBtn.hidden = false;
  statusEl.style.display = 'none';
  frame.style.display = 'block';
  frame.src = url;
}

async function handle(p: PendingSearch | undefined) {
  if (!p || p.id === lastId) return;
  lastId = p.id;
  await browser.storage.session.remove(PENDING_KEY);

  setStatus('Buscando en Yandex…');
  const blob = await (await fetch(p.image)).blob();
  if (p.engine === 'yandex') await searchYandex(blob);
}

// 1) POST JSON → URL de resultados.  2) Si falla, formulario multipart dentro del iframe.
async function searchYandex(blob: Blob) {
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

    showResults(target);
  } catch (err) {
    console.error('[reverse-search] fetch falló, usando formulario', err);
    submitForm(blob);
  }
}

function submitForm(blob: Blob) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.enctype = 'multipart/form-data';
  form.action = `${YANDEX}?rpt=imageview`;
  form.target = 'results';

  const input = document.createElement('input');
  input.type = 'file';
  input.name = 'upfile';
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'image.png', { type: blob.type || 'image/png' }));
  input.files = dt.files;
  form.appendChild(input);
  document.body.appendChild(form);

  lastUrl = `${YANDEX}?rpt=imageview`;
  openBtn.hidden = false;
  statusEl.style.display = 'none';
  frame.style.display = 'block';
  form.submit();
  form.remove();
}

openBtn.addEventListener('click', () => {
  if (lastUrl) window.open(lastUrl, '_blank');
});

// Búsquedas nuevas mientras el panel está abierto (cada vez que ajustas la selección)
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes[PENDING_KEY]) return;
  handle(changes[PENDING_KEY].newValue as PendingSearch | undefined).catch((err) =>
    setStatus('Error', true, String(err)),
  );
});

// Búsqueda ya pendiente cuando el panel termina de cargar
browser.storage.session
  .get(PENDING_KEY)
  .then((s) => handle(s[PENDING_KEY] as PendingSearch | undefined))
  .catch((err) => setStatus('Error', true, String(err)));
