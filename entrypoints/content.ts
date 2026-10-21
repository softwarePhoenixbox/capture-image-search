// Selector estilo Google Lens. Se inyecta al hacer clic en el icono / atajo
// (registration: 'runtime'); otro clic lo cierra.
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {
    toggle();
  },
});

type Rect = { x: number; y: number; w: number; h: number };
type Mode = 'none' | 'new' | 'move' | 'tl' | 'tr' | 'bl' | 'br';

const ROOT_ID = '__reverse_search_root__';
const HANDLE = 20; // radio de agarre de las esquinas
const MIN = 12; // tamaño mínimo para buscar
const DIM = 'rgba(0,0,0,0.5)';

function toggle() {
  const w = window as unknown as { __rsCleanup?: () => void };
  if (w.__rsCleanup) {
    w.__rsCleanup();
    return;
  }
  start(w);
}

function start(w: { __rsCleanup?: () => void }) {
  const root = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    cursor: 'crosshair',
    userSelect: 'none',
    background: DIM,
    font: '13px system-ui, sans-serif',
  });
  root.id = ROOT_ID;

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
    '<span>Selecciona cualquier texto o imagen para buscar con Yandex</span>' +
    '<span style="width:20px;height:20px;border:1.5px solid #1b1b1f;border-radius:50%;display:inline-grid;place-items:center;font-size:12px;font-weight:600">?</span>';

  // Recuadro: hueco claro + borde degradado + esquinas blancas
  const box = el('div', {
    position: 'absolute',
    display: 'none',
    boxSizing: 'border-box',
    borderRadius: '14px',
    border: '3px solid transparent',
    background:
      'linear-gradient(transparent, transparent) padding-box, ' +
      'linear-gradient(90deg,#ea4335,#fbbc05,#34a853,#4285f4) border-box',
    boxShadow: `0 0 0 100vmax ${DIM}`,
    pointerEvents: 'none',
  });
  for (const c of ['tl', 'tr', 'bl', 'br'] as const) box.appendChild(corner(c));

  root.append(box, toast);
  document.documentElement.appendChild(root);

  let rect: Rect | null = null;
  let mode: Mode = 'none';
  let sx = 0;
  let sy = 0;
  let orig: Rect | null = null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };
  window.addEventListener('keydown', onKey, true);

  function cleanup() {
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    delete w.__rsCleanup;
  }
  w.__rsCleanup = cleanup;

  function render() {
    if (!rect) {
      box.style.display = 'none';
      root.style.background = DIM;
      return;
    }
    root.style.background = 'transparent'; // el oscurecido pasa al box-shadow
    Object.assign(box.style, {
      display: 'block',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.w}px`,
      height: `${rect.h}px`,
    });
  }

  function hit(x: number, y: number): Mode {
    if (!rect) return 'new';
    const near = (cx: number, cy: number) => Math.hypot(x - cx, y - cy) <= HANDLE;
    if (near(rect.x, rect.y)) return 'tl';
    if (near(rect.x + rect.w, rect.y)) return 'tr';
    if (near(rect.x, rect.y + rect.h)) return 'bl';
    if (near(rect.x + rect.w, rect.y + rect.h)) return 'br';
    if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) return 'move';
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
    orig = rect ? { ...rect } : null;
    toast.style.display = 'none';
    if (mode === 'new') rect = { x: sx, y: sy, w: 0, h: 0 };
    render();
  });

  root.addEventListener('pointermove', (e) => {
    if (mode === 'none') {
      root.style.cursor = CURSORS[hit(e.clientX, e.clientY)];
      return;
    }
    const x = e.clientX;
    const y = e.clientY;
    if (mode === 'new') {
      rect = norm(sx, sy, x, y);
    } else if (orig && mode === 'move') {
      rect = {
        ...orig,
        x: clamp(orig.x + x - sx, 0, window.innerWidth - orig.w),
        y: clamp(orig.y + y - sy, 0, window.innerHeight - orig.h),
      };
    } else if (orig) {
      // esquina arrastrada; la opuesta queda fija
      const fx = mode === 'tl' || mode === 'bl' ? orig.x + orig.w : orig.x;
      const fy = mode === 'tl' || mode === 'tr' ? orig.y + orig.h : orig.y;
      rect = norm(fx, fy, x, y);
    }
    render();
  });

  root.addEventListener('pointerup', () => {
    if (mode === 'none') return;
    mode = 'none';
    if (rect && rect.w >= MIN && rect.h >= MIN) {
      void search({ ...rect });
    } else {
      rect = null;
      render();
    }
  });

  // Oculta el overlay para que no salga en la captura, busca, y lo vuelve a mostrar
  async function search(r: Rect) {
    root.style.visibility = 'hidden';
    await new Promise<void>((res) =>
      requestAnimationFrame(() => requestAnimationFrame(() => res())),
    );
    try {
      await browser.runtime.sendMessage({
        type: 'region',
        rect: r,
        viewportWidth: window.innerWidth,
      });
    } catch (err) {
      console.error('[reverse-search]', err);
    } finally {
      root.style.visibility = 'visible';
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
