import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/**
 * Take or choose a photo and shrink it to a JPEG at most 1600 px wide.
 * Returns a local URI, or null if cancelled. Throws if the camera isn't allowed.
 */
export async function pickPhoto(fromCamera: boolean): Promise<string | null> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9 };
  if (fromCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Allow camera access to take photos.');
  }
  const result = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  try {
    const ctx = ImageManipulator.manipulate(asset.uri);
    if ((asset.width ?? 0) > 1600) ctx.resize({ width: 1600 });
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return asset.uri;
  }
}
