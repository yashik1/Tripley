/** Choose a PDF or image file in the browser. */
import { DOCUMENT_TYPES, mimeFromName, type PickedDocument } from './documents';

export function pickDocument(): Promise<PickedDocument | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = DOCUMENT_TYPES.join(',');
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      const mime = (DOCUMENT_TYPES as readonly string[]).includes(file.type) ? file.type : mimeFromName(file.name);
      if (!mime) return reject(new Error('Choose a PDF, or a JPEG, PNG or WebP image.'));
      resolve({ name: file.name, mime, bytes: await file.arrayBuffer() });
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
