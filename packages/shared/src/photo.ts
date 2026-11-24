export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PHOTO_THUMBNAIL_SIZE = 160;

const uploadedPhotoUrl = /^\/api\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/;

/** Uploaded photos have a small square thumbnail; other photo URLs are used as-is. */
export const photoThumbnailUrl = (photoUrl: string): string => {
  const match = uploadedPhotoUrl.exec(photoUrl);
  return match ? `/api/photos/${match[1]}.thumb.webp` : photoUrl;
};
