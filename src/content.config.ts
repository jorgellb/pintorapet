import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

const work = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/work' }),
  schema: z.object({
    id: z.string(),
    pathSlugs: z.object({ en: z.string(), es: z.string() }),
    title: z.object({ en: z.string(), es: z.string() }),
    category: z.enum(['dog', 'cat', 'horse', 'other', 'people']),
    summary: z.object({ en: z.string(), es: z.string() }).optional(),
    story: z.object({ en: z.string(), es: z.string() }).optional(),
    assets: z
      .array(
        z.object({
          role: z.enum([
            'drawing',
            'reference_photo',
            'comparison',
            'process_photo',
            'related_product_photo',
          ]),
          src: z.string().optional(),
          alt: z.object({ en: z.string(), es: z.string() }).optional(),
          label: z.string().nullable().optional(),
        }),
      )
      .default([]),
    order: z.number().int().nonnegative(),
  }),
});

const gallery = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/gallery' }),
  schema: z.object({
    id: z.string(),
    title: z.object({ en: z.string(), es: z.string() }),
    summary: z.object({ en: z.string(), es: z.string() }).optional(),
    story: z.object({ en: z.string(), es: z.string() }).optional(),
    group: z.enum(['people', 'architecture', 'illustration', 'other']),
    assets: z
      .array(
        z.object({
          role: z.enum(['drawing', 'reference_photo', 'other']),
          src: z.string().optional(),
          alt: z.object({ en: z.string(), es: z.string() }).optional(),
        }),
      )
      .default([]),
    order: z.number().int().nonnegative(),
  }),
});

export const collections = { work, gallery };
