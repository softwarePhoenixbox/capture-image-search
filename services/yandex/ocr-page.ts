export const OCR_URL = 'https://translate.yandex.com/en/ocr'; // apartado "Images" de Yandex Traductor

export type DropResult = { ok: boolean; reason?: string };

/**
 * Le "pega" la imagen a translate.yandex.com/en/ocr.
 *
 * ⚠ Debe ser AUTOCONTENIDA (nada de referencias fuera de su cuerpo): corre dentro de la página
 * de Yandex, ya sea como content script del iframe del panel o como `func` de
 * `scripting.executeScript` (plan B en una pestaña); en ese caso Chrome la serializa.
 *
 * La página trae `<input id="fileInput" type="file" accept="image/*">`; si no reacciona al
 * input se prueba con drop y por último con paste (la página admite los tres).
 * No toca el idioma: se queda con el que Yandex tenga por defecto.
 */
export async function dropImage(dataUrl: string): Promise<DropResult> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  // Mientras la página no tiene imagen lleva la clase "state-empty" en <html>
  const filled = () => !document.documentElement.classList.contains('state-empty');
  const waitFilled = async (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      if (filled()) return true;
      await sleep(250);
    }
    return filled();
  };

  for (let i = 0; i < 100 && document.readyState !== 'complete'; i++) await sleep(100);
  let input: HTMLInputElement | null = null;
  for (let i = 0; i < 75 && !input; i++) {
    input = document.querySelector<HTMLInputElement>('#fileInput, input[type="file"]');
    if (!input) await sleep(200);
  }
  if (!input) return { ok: false, reason: 'No encontré el input de archivo de Yandex' };
  await sleep(600); // deja que el JS de la página enganche sus handlers

  // data URL → File, sin fetch(): la CSP de la página podría bloquearlo
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'selection.png', { type: 'image/png' }));

  // 1) input[type=file] + change
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (await waitFilled(5000)) return { ok: true };

  // 2) drop
  const zone = document.getElementById('dropOverlay') ?? document.body;
  for (const type of ['dragenter', 'dragover', 'drop']) {
    zone.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }
  if (await waitFilled(5000)) return { ok: true };

  // 3) paste
  document.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
  );
  if (await waitFilled(5000)) return { ok: true };

  return { ok: false, reason: 'La página no reaccionó a la imagen' };
}
