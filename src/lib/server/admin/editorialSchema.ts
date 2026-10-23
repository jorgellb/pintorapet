import { z } from 'zod';

const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const asset = z.object({
  role: z.string().trim().min(1).max(40),
  src: z.string().trim().min(1).max(2000),
  label: z.string().trim().max(200).nullable().optional(),
  altEn: z.string().max(500).optional(),
  altEs: z.string().max(500).optional(),
  mediaId: z.string().uuid().nullable().optional(),
});

export const artworkSchema = z.object({
  legacyId: z.string().trim().max(80).nullable().optional(),
  slugEn: slug,
  slugEs: slug,
  category: z.enum(['dog', 'cat', 'horse', 'other', 'people']),
  titleEn: z.string().trim().min(1).max(200),
  titleEs: z.string().trim().min(1).max(200),
  summaryEn: z.string().max(4000).default(''),
  summaryEs: z.string().max(4000).default(''),
  storyEn: z.string().max(20000).default(''),
  storyEs: z.string().max(20000).default(''),
  seoTitleEn: z.string().trim().max(120).default(''),
  seoTitleEs: z.string().trim().max(120).default(''),
  seoDescriptionEn: z.string().trim().max(320).default(''),
  seoDescriptionEs: z.string().trim().max(320).default(''),
  sortOrder: z.number().int().nonnegative(),
  published: z.boolean(),
  assets: z.array(asset).max(24),
});

export const gallerySchema = z.object({
  legacyId: z.string().trim().max(80).nullable().optional(),
  group: z.enum(['people', 'architecture', 'illustration', 'other']),
  titleEn: z.string().trim().min(1).max(200),
  titleEs: z.string().trim().min(1).max(200),
  summaryEn: z.string().max(4000).default(''),
  summaryEs: z.string().max(4000).default(''),
  storyEn: z.string().max(20000).default(''),
  storyEs: z.string().max(20000).default(''),
  sortOrder: z.number().int().nonnegative(),
  published: z.boolean(),
  assets: z.array(asset).max(24),
});
