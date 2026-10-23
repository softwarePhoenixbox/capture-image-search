import { DEFAULT_SERVICE, type ServiceId } from '../services/types';
import { SERVICES, isServiceId } from '../services/meta';

// Selector estilo Google Lens.
// Al activarse congela la pestaña (captura) y trabaja sobre esa imagen, así el recuadro
// no se desalinea cuando el panel lateral cambia el ancho de la página.
// Se inyecta al hacer clic en el icono / atajo (registration: 'runtime'); otro clic lo cierra.
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {
    void toggle();
  },
});

type Rect = { x: number; y: number; w: number; h: number };
type Mode = 'none' | 'new' | 'move' | 'tl' | 'tr' | 'bl' | 'br';
type Guard = { __rsCleanup?: () => void; __rsBusy?: boolean };

const ROOT_ID = '__reverse_search_root__';
const HANDLE = 20; // radio de agarre de las esquinas (px)
const MIN = 12; // tamaño mínimo de selección (px)
const DIM = 'rgba(0,0,0,0.5)';

async function toggle() {
  const w = window as unknown as Guard;
  // El DOM es la fuente de verdad: si el overlay existe se cierra; si no, se abre.
  const raw = (window as unknown as { __rsService?: string }).__rsService;
  const service: ServiceId = isServiceId(raw) ? raw : DEFAULT_SERVICE;
  const existing = document.getElementById(ROOT_ID);
  w.__rsCleanup?.();
  delete w.__rsCleanup;
  if (existing) {
    existing.remove();
    // mismo servicio → solo cerraba; otro servicio (p. ej. clic derecho → traducir) → se reabre en ese modo
    if (existing.dataset.service === service) return;
  }
  if (w.__rsBusy) return;
  w.__rsBusy = true;
  try {
    // Tamaño de la ventana (px CSS) en el momento de congelar: es la referencia 1:1
    // de lo que el usuario veía, aunque la captura tenga otra proporción por redondeos.
    const view = { w: window.innerWidth, h: window.innerHeight };
    // Captura limpia: el overlay todavía no está montado
    const res = await browser.runtime.sendMessage({ type: 'frame' });
    if (!res?.dataUrl) throw new Error(res?.error ?? 'sin captura');
    const bitmap = await createImageBitmap(dataUrlToBlob(res.dataUrl));
    start(w, bitmap, view, service);
  } catch (err) {
    console.error('[reverse-search]', err);
    browser.runtime.sendMessage({ type: 'error', message: String(err) }).catch(() => {});
  } finally {
    w.__rsBusy = false;
  }
}

function start(w: Guard, bmp: ImageBitmap, view: { w: number; h: number }, service: ServiceId) {
  const root = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    cursor: 'crosshair',
    userSelect: 'none',
    touchAction: 'none',
    overflow: 'hidden',
    background: '#0e0e10', // tapa la página real, que se reacomoda cuando abre el panel
    font: '13px system-ui, sans-serif',
  });
  root.id = ROOT_ID;
  root.dataset.service = service;

  // Página congelada (canvas: no depende del img-src de la CSP de la página)
  const frame = document.createElement('canvas');
  frame.width = bmp.width;
  frame.height = bmp.height;
  frame.getContext('2d')!.drawImage(bmp, 0, 0);
  Object.assign(frame.style, { position: 'absolute', display: 'block', pointerEvents: 'none' });

  // Oscurecido general (solo mientras no hay selección)
  const dim = el('div', { position: 'absolute', background: DIM, pointerEvents: 'none' });

  // Aviso superior (igual que Lens)
  const toast = el('div', {
    position: 'absolute',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 18px',
    borderRadius: '999px',
    background: '#ece8f1',
    color: '#1b1b1f',
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  });
  toast.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1b1b1f" stroke-width="2" stroke-linecap="round">' +
    '<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>' +
    '<span></span>' +
    '<span style="width:20px;height:20px;border:1.5px solid #1b1b1f;border-radius:50%;display:inline-grid;place-items:center;font-size:12px;font-weight:600">?</span>';

  toast.querySelector('span')!.textContent = SERVICES[service].toast;

  // Recuadro: hueco claro (el box-shadow oscurece todo lo demás) + borde degradado + esquinas blancas
  const box = el('div', {
    position: 'absolute',
    display: 'none',
    boxSizing: 'border-box',
    borderRadius: '14px',
    boxShadow: `0 0 0 100vmax ${DIM}`,
    pointerEvents: 'none',
  });

  // Anillo degradado: solo el borde de 3px (máscara que recorta el interior)
  const ring = el('div', {
    position: 'absolute',
    inset: '0',
    boxSizing: 'border-box',
    borderRadius: '14px',
    padding: '3px',
    background: 'linear-gradient(90deg,#ea4335,#fbbc05,#34a853,#4285f4)',
  });
  const MASK = 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)';
  ring.style.setProperty('-webkit-mask', MASK);
  ring.style.setProperty('-webkit-mask-composite', 'xor');
  ring.style.setProperty('mask', MASK);
  ring.style.setProperty('mask-composite', 'exclude');
  box.appendChild(ring);

  for (const c of ['tl', 'tr', 'bl', 'br'] as const) box.appendChild(corner(c));

  root.append(frame, dim, box, toast);
  document.documentElement.appendChild(root);

  // --- Geometría -----------------------------------------------------------
  // La captura se muestra "contain" y centrada dentro de la ventana actual
  // (al activar ocupa exactamente la ventana, 1:1 con la página).
  // La selección vive en coordenadas normalizadas (0..1) de la captura, por eso
  // sobrevive a cualquier cambio de tamaño de la ventana.
  let ox = 0;
  let oy = 0;
  let dw = 1;
  let dh = 1;
  let sel: Rect | null = null; // normalizada

  const toPx = (n: Rect): Rect => ({ x: ox + n.x * dw, y: oy + n.y * dh, w: n.w * dw, h: n.h * dh });
  const fromPx = (r: Rect): Rect => ({
    x: (r.x - ox) / dw,
    y: (r.y - oy) / dh,
    w: r.w / dw,
    h: r.h / dh,
  });

  function layout() {
    const vw = root.clientWidth;
    const vh = root.clientHeight;
    const s = Math.min(vw / view.w, vh / view.h); // =1 al activar; <1 si el panel encoge la ventana
    dw = view.w * s;
    dh = view.h * s;
    ox = (vw - dw) / 2;
    oy = (vh - dh) / 2;
    for (const n of [frame, dim]) {
      Object.assign(n.style, {
        left: `${ox}px`,
        top: `${oy}px`,
        width: `${dw}px`,
        height: `${dh}px`,
      });
    }
  }

  function render() {
    if (!sel) {
      box.style.display = 'none';
      dim.style.display = 'block';
      return;
    }
    const r = toPx(sel);
    dim.style.display = 'none'; // el oscurecido pasa al box-shadow del recuadro
    Object.assign(box.style, {
      display: 'block',
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.w}px`,
      height: `${r.h}px`,
    });
  }

  const onResize = () => {
    layout();
    render();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey, true);
  root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

  function cleanup() {
    root.remove();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey, true);
    bmp.close();
    delete w.__rsCleanup;
  }
  w.__rsCleanup = cleanup;

  layout();
  render();

  // --- Interacción ---------------------------------------------------------
  let mode: Mode = 'none';
  let sx = 0;
  let sy = 0;
  let orig: Rect | null = null; // px

  function hit(x: number, y: number): Mode {
    if (!sel) return 'new';
    const r = toPx(sel);
    const near = (cx: number, cy: number) => Math.hypot(x - cx, y - cy) <= HANDLE;
    if (near(r.x, r.y)) return 'tl';
    if (near(r.x + r.w, r.y)) return 'tr';
    if (near(r.x, r.y + r.h)) return 'bl';
    if (near(r.x + r.w, r.y + r.h)) return 'br';
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return 'move';
    return 'new';
  }

  const CURSORS: Record<Mode, string> = {
    none: 'crosshair',
    new: 'crosshair',
    move: 'move',
    tl: 'nwse-resize',
    br: 'nwse-resize',
    tr: 'nesw-resize',
    bl: 'nesw-resize',
  };

  const norm = (ax: number, ay: number, bx: number, by: number): Rect => ({
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  });

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    root.setPointerCapture(e.pointerId);
    mode = hit(e.clientX, e.clientY);
    sx = e.clientX;
    sy = e.clientY;
    orig = sel ? toPx(sel) : null;
    toast.style.display = 'none';
    if (mode === 'new') {
      const cx = clamp(sx, ox, ox + dw);
      const cy = clamp(sy, oy, oy + dh);
      sel = fromPx({ x: cx, y: cy, w: 0, h: 0 });
    }
    render();
  });

  root.addEventListener('pointermove', (e) => {
    if (mode === 'none') {
      root.style.cursor = CURSORS[hit(e.clientX, e.clientY)];
      return;
    }
    const x = clamp(e.clientX, ox, ox + dw);
    const y = clamp(e.clientY, oy, oy + dh);
    let r: Rect | null = null;
    if (mode === 'new') {
      r = norm(clamp(sx, ox, ox + dw), clamp(sy, oy, oy + dh), x, y);
    } else if (orig && mode === 'move') {
      r = {
        ...orig,
        x: clamp(orig.x + e.clientX - sx, ox, ox + dw - orig.w),
        y: clamp(orig.y + e.clientY - sy, oy, oy + dh - orig.h),
      };
    } else if (orig) {
      // esquina arrastrada; la opuesta queda fija
      const fx = mode === 'tl' || mode === 'bl' ? orig.x + orig.w : orig.x;
      const fy = mode === 'tl' || mode === 'tr' ? orig.y + orig.h : orig.y;
      r = norm(fx, fy, x, y);
    }
    if (r) sel = fromPx(r);
    render();
  });

  root.addEventListener('pointerup', () => {
    if (mode === 'none') return;
    mode = 'none';
    const px = sel ? toPx(sel) : null;
    if (px && px.w >= MIN && px.h >= MIN) {
      void search();
    } else {
      sel = null;
      render();
    }
  });

  // Recorta de la captura congelada (no de la página en vivo) y la manda al background
  async function search() {
    if (!sel) return;
    const x = clamp(Math.round(sel.x * bmp.width), 0, bmp.width - 1);
    const y = clamp(Math.round(sel.y * bmp.height), 0, bmp.height - 1);
    const cw = clamp(Math.round(sel.w * bmp.width), 1, bmp.width - x);
    const ch = clamp(Math.round(sel.h * bmp.height), 1, bmp.height - y);

    const canvas = new OffscreenCanvas(cw, ch);
    canvas.getContext('2d')!.drawImage(bmp, x, y, cw, ch, 0, 0, cw, ch);
    const image = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
    try {
      await browser.runtime.sendMessage({ type: 'region', image, service });
    } catch (err) {
      console.error('[reverse-search]', err);
    }
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function el(tag: string, style: Record<string, string>) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  return node;
}

// base64 → Blob sin fetch(): fetch de data: URLs puede bloquearlo el connect-src de la página
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function corner(pos: 'tl' | 'tr' | 'bl' | 'br') {
  const top = pos[0] === 't';
  const left = pos[1] === 'l';
  const side = (on: boolean) => (on ? '5px solid #fff' : 'none');
  return el('div', {
    position: 'absolute',
    width: '26px',
    height: '26px',
    [top ? 'top' : 'bottom']: '-5px',
    [left ? 'left' : 'right']: '-5px',
    borderTop: side(top),
    borderBottom: side(!top),
    borderLeft: side(left),
    borderRight: side(!left),
    borderRadius: `${top && left ? 14 : 0}px ${top && !left ? 14 : 0}px ${!top && !left ? 14 : 0}px ${!top && left ? 14 : 0}px`,
  });
}
