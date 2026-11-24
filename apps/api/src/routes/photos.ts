import { randomUUID } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { MAX_PHOTO_BYTES, PHOTO_MIME_TYPES } from '@garage/shared';
import { requireStaff } from '../auth.js';
import { asyncHandler, rateLimit } from '../middleware.js';
import { InvalidPhotoError, isPhotoName, isThumbnailName, makeThumbnail, normalizePhoto, photoNameForThumbnail, thumbnailName, type PhotoStore } from '../photos.js';

/** Thumbnails are derivable, so a failed thumbnail write never fails the request; the next read regenerates it. */
const saveThumbnail = async (store: PhotoStore, name: string, thumbnail: Buffer): Promise<void> => {
  try {
    await store.save(name, thumbnail);
  } catch (error) {
    console.warn(`[photos] Could not store thumbnail ${name}:`, error instanceof Error ? error.message : error);
  }
};

export function photoRoutes(store: PhotoStore): Router {
  const router = Router();
  router.post(
    '/photos',
    requireStaff,
    rateLimit({ windowMs: 60_000, max: 20 }),
    express.raw({ type: () => true, limit: MAX_PHOTO_BYTES, inflate: false }),
    asyncHandler(async (req, res) => {
      const contentType = req.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (!PHOTO_MIME_TYPES.some((type) => type === contentType)) {
        res.status(415).json({ error: 'Choose a JPEG, PNG, or WebP photo.' });
        return;
      }
      let photo: Buffer;
      try {
        photo = await normalizePhoto(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), contentType);
      } catch (error) {
        if (!(error instanceof InvalidPhotoError)) throw error;
        res.status(400).json({ error: error.message });
        return;
      }
      const name = `${randomUUID()}.webp`;
      await store.save(name, photo);
      await saveThumbnail(store, thumbnailName(name), await makeThumbnail(photo));
      res.status(201).set('Cache-Control', 'no-store').json({ photoUrl: `/api/photos/${name}` });
    }),
  );
  router.use((error: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (error.status === 413 || error.status === 415) {
      res.status(error.status).json({
        error: error.status === 413 ? 'Photos must be no larger than 10 MB.' : 'Compressed photo uploads are not supported.',
      });
      return;
    }
    next(error);
  });
  router.get('/photos/:name', asyncHandler(async (req, res) => {
    const name = req.params.name;
    if (!name || !isPhotoName(name)) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }
    let photo = await store.read(name);
    if (!photo && isThumbnailName(name)) {
      const original = await store.read(photoNameForThumbnail(name));
      if (original) {
        photo = await makeThumbnail(original);
        await saveThumbnail(store, name, photo);
      }
    }
    if (!photo) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }
    res.set({
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }).send(photo);
  }));
  return router;
}
