import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { MAX_PHOTO_BYTES, PHOTO_MIME_TYPES, PHOTO_THUMBNAIL_SIZE } from '@garage/shared';
import sharp from 'sharp';
import { config } from './config.js';

const PHOTO_ID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const photoNamePattern = new RegExp(`^${PHOTO_ID}(\\.thumb)?\\.webp$`);

/** Accepts full photos (`<uuid>.webp`) and their thumbnails (`<uuid>.thumb.webp`). */
export const isPhotoName = (name: string): boolean => photoNamePattern.test(name);
export const isThumbnailName = (name: string): boolean => isPhotoName(name) && name.endsWith('.thumb.webp');
export const thumbnailName = (photoName: string): string => photoName.replace(/\.webp$/, '.thumb.webp');
export const photoNameForThumbnail = (name: string): string => name.replace(/\.thumb\.webp$/, '.webp');

export const makeThumbnail = (photo: Buffer): Promise<Buffer> =>
  sharp(photo, { limitInputPixels: 24_000_000 })
    .resize(PHOTO_THUMBNAIL_SIZE, PHOTO_THUMBNAIL_SIZE, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();

export class InvalidPhotoError extends Error {}

export async function normalizePhoto(body: Buffer, contentType: string): Promise<Buffer> {
  if (!PHOTO_MIME_TYPES.some((type) => type === contentType)) {
    throw new InvalidPhotoError('Choose a JPEG, PNG, or WebP photo.');
  }
  if (body.length === 0 || body.length > MAX_PHOTO_BYTES) {
    throw new InvalidPhotoError('Photos must be nonempty and no larger than 10 MB.');
  }
  try {
    const image = sharp(body, { limitInputPixels: 24_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    const expected: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
    if (metadata.format !== expected[contentType] || (metadata.pages ?? 1) > 1) {
      throw new InvalidPhotoError('Choose a still JPEG, PNG, or WebP photo matching its file type.');
    }
    // Re-encoding strips EXIF/GPS and other source metadata; names never come from the upload.
    const photo = await image.rotate().resize({
      width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true,
    }).webp({ quality: 85 }).toBuffer();
    if (photo.length > MAX_PHOTO_BYTES) throw new InvalidPhotoError('The processed photo is too large.');
    return photo;
  } catch (error) {
    if (error instanceof InvalidPhotoError) throw error;
    throw new InvalidPhotoError('The photo could not be decoded. Choose a valid still image under 24 megapixels.');
  }
}

export interface PhotoStore {
  save(name: string, body: Buffer): Promise<void>;
  read(name: string): Promise<Buffer | null>;
}

export class LocalPhotoStore implements PhotoStore {
  constructor(private readonly directory: string) {}

  async save(name: string, body: Buffer): Promise<void> {
    if (!isPhotoName(name)) throw new Error('Invalid stored photo name');
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, name), body, { flag: 'wx' });
  }

  async read(name: string): Promise<Buffer | null> {
    if (!isPhotoName(name)) throw new Error('Invalid stored photo name');
    try {
      return await readFile(join(this.directory, name));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }
}

export class AzurePhotoStore implements PhotoStore {
  constructor(private readonly container: Pick<ContainerClient, 'getBlockBlobClient'>) {}

  async save(name: string, body: Buffer): Promise<void> {
    if (!isPhotoName(name)) throw new Error('Invalid stored photo name');
    await this.container.getBlockBlobClient(name).uploadData(body, {
      blobHTTPHeaders: { blobContentType: 'image/webp' },
      conditions: { ifNoneMatch: '*' },
      abortSignal: AbortSignal.timeout(30_000),
    });
  }

  async read(name: string): Promise<Buffer | null> {
    if (!isPhotoName(name)) throw new Error('Invalid stored photo name');
    try {
      return await this.container.getBlockBlobClient(name).downloadToBuffer(
        0, undefined, { abortSignal: AbortSignal.timeout(30_000) },
      );
    } catch (error) {
      if (error instanceof Error && (
        ('code' in error && error.code === 'BlobNotFound') ||
        ('statusCode' in error && error.statusCode === 404)
      )) return null;
      throw error;
    }
  }
}

export function createPhotoStore(): PhotoStore {
  if (config.photos.storage === 'local') return new LocalPhotoStore(config.photos.directory);
  if (config.photos.storage !== 'azure') throw new Error('PHOTO_STORAGE must be local or azure');
  if (!config.photos.endpoint || new URL(config.photos.endpoint).protocol !== 'https:') {
    throw new Error('PHOTO_BLOB_ENDPOINT must be an HTTPS Azure Blob service endpoint');
  }
  return new AzurePhotoStore(
    new BlobServiceClient(config.photos.endpoint, new DefaultAzureCredential())
      .getContainerClient(config.photos.container),
  );
}
