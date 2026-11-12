/** Choose a PDF or image file on the phone (Files app, Drive, downloads). */
import { File } from 'expo-file-system';

import { DOCUMENT_TYPES, mimeFromName, type PickedDocument } from './documents';

export async function pickDocument(): Promise<PickedDocument | null> {
  const picked = await File.pickFileAsync({ mimeTypes: [...DOCUMENT_TYPES] });
  if (picked.canceled || !picked.result) return null;
  const file = picked.result;
  const mime = (DOCUMENT_TYPES as readonly string[]).includes(file.type) ? file.type : mimeFromName(file.name);
  if (!mime) throw new Error('Choose a PDF, or a JPEG, PNG or WebP image.');
  return { name: file.name, mime, bytes: await file.arrayBuffer() };
}
