/**
 * Trip documents saved on the phone for offline use (iPhone and Android).
 * Files live in the app's own documents folder, named by account and document,
 * and are deleted on sign-out or when another account signs in
 * (device-data.ts). Opening one uses the system viewer (Quick Look on iPhone,
 * a viewer app on Android).
 */
import { Directory, File, Paths } from 'expo-file-system';

import { extensionFor } from './documents';

const folder = () => new Directory(Paths.document, 'tripley-docs');
const fileFor = (userId: string, doc: { id: string; mime: string }) => new File(folder(), `${userId}-${doc.id}.${extensionFor(doc.mime)}`);

/** Download a document (from its short-lived signed link) to keep on this device. */
export async function saveOffline(userId: string, doc: { id: string; mime: string }, url: string): Promise<void> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true });
  await File.downloadFileAsync(url, fileFor(userId, doc), { idempotent: true });
}

export async function isSavedOffline(userId: string, doc: { id: string; mime: string }): Promise<boolean> {
  return fileFor(userId, doc).exists;
}

/** Opens the saved copy; false when there isn't one. */
export async function openOffline(userId: string, doc: { id: string; mime: string; name: string }): Promise<boolean> {
  const file = fileFor(userId, doc);
  if (!file.exists) return false;
  await file.preview({ title: doc.name });
  return true;
}

export async function removeOffline(userId: string, doc: { id: string; mime: string }): Promise<void> {
  const file = fileFor(userId, doc);
  if (file.exists) file.delete();
}

/** Sign-out or another account: every saved document goes. */
export async function clearOfflineDocs(): Promise<void> {
  const dir = folder();
  if (dir.exists) dir.delete();
}
