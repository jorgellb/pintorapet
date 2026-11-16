import { CommerceError } from '@/lib/server/commerce/errors';
import { CloudinaryError, destroyImage, parseCloudinaryUrl, uploadImage } from '@/lib/server/media/cloudinary';

/** Where uploaded media files live. Keyed by Cloudinary public id (see mediaPublicId). */
export type MediaStore = {
  put(publicId: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
  remove(publicId: string): Promise<void>;
};

/** Cloudinary rejects what retrying cannot fix (size, megapixels, format) with a 4xx. */
export function mediaStoreError(err: unknown): unknown {
  if (!(err instanceof CloudinaryError)) return err;
  return err.status >= 400 && err.status < 500
    ? new CommerceError('VALIDATION', `Cloudinary: ${err.message}`, 400)
    : new CommerceError('INTERNAL', `Cloudinary: ${err.message}`, 502);
}

export function cloudinaryStore(): MediaStore {
  const config = parseCloudinaryUrl(import.meta.env.CLOUDINARY_URL);
  const required = () => {
    if (!config) throw new CommerceError('NOT_CONFIGURED', 'CLOUDINARY_URL is not set', 503);
    return config;
  };
  return {
    async put(publicId, bytes, contentType) {
      await uploadImage(required(), { bytes, contentType, publicId });
    },
    async remove(publicId) {
      await destroyImage(required(), publicId);
    },
  };
}
