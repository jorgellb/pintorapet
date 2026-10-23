import { loadPublicCatalog } from '@/lib/catalog/loadProducts';
import { catalogOffers, type CatalogOffer } from '@/lib/catalog/productFeed';
import { siteUrl } from '@/lib/server/env';

export type ChannelSync = {
  configured: boolean;
  ok: boolean;
  sent: number;
  message: string;
};

type GoogleConfig = {
  merchantId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type MetaConfig = {
  catalogId: string;
  accessToken: string;
};

export function googleMerchantConfig(): GoogleConfig | null {
  const merchantId = import.meta.env.GOOGLE_MERCHANT_ID;
  const clientId = import.meta.env.GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = import.meta.env.GOOGLE_REFRESH_TOKEN;
  if (!merchantId || !clientId || !clientSecret || !refreshToken) return null;
  return { merchantId, clientId, clientSecret, refreshToken };
}

export function metaCatalogConfig(): MetaConfig | null {
  const catalogId = import.meta.env.META_CATALOG_ID;
  const accessToken = import.meta.env.META_CATALOG_TOKEN;
  if (!catalogId || !accessToken) return null;
  return { catalogId, accessToken };
}

async function googleAccessToken(config: GoogleConfig, fetchImpl: typeof fetch): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await response.json()) as { access_token?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error || 'Google no devolvió un token de acceso');
  }
  return payload.access_token;
}

export async function pushToGoogle(
  offers: CatalogOffer[],
  config: GoogleConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ChannelSync> {
  if (!config) {
    return {
      configured: false,
      ok: false,
      sent: 0,
      message: 'Faltan GOOGLE_MERCHANT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN.',
    };
  }
  const token = await googleAccessToken(config, fetchImpl);
  const entries = offers.map((offer, index) => ({
    batchId: index + 1,
    merchantId: config.merchantId,
    method: 'insert',
    product: {
      offerId: offer.id,
      title: offer.title,
      description: offer.description,
      link: offer.link,
      imageLink: offer.imageLink,
      additionalImageLinks: offer.additionalImages,
      contentLanguage: 'es',
      targetCountry: 'ES',
      channel: 'online',
      availability: offer.availability,
      price: { value: offer.priceValue, currency: 'EUR' },
      brand: offer.brand,
      condition: offer.condition,
      identifierExists: false,
      googleProductCategory: offer.googleProductCategory,
      productTypes: [offer.productType],
    },
  }));
  const response = await fetchImpl(
    'https://shoppingcontent.googleapis.com/content/v2.1/products/batch',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ entries }),
    },
  );
  const payload = (await response.json()) as {
    error?: { message?: string };
    entries?: Array<{ errors?: { message?: string } }>;
  };
  if (!response.ok) {
    return {
      configured: true,
      ok: false,
      sent: 0,
      message: payload.error?.message || 'Google rechazó el catálogo.',
    };
  }
  const failed = (payload.entries ?? []).filter((entry) => entry.errors);
  return {
    configured: true,
    ok: failed.length === 0,
    sent: offers.length - failed.length,
    message:
      failed.length === 0
        ? `Google actualizó ${offers.length} productos.`
        : `Google actualizó ${offers.length - failed.length} y rechazó ${failed.length}.`,
  };
}

export async function pushToMeta(
  offers: CatalogOffer[],
  config: MetaConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ChannelSync> {
  if (!config) {
    return {
      configured: false,
      ok: false,
      sent: 0,
      message: 'Faltan META_CATALOG_ID y META_CATALOG_TOKEN.',
    };
  }
  const response = await fetchImpl(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(config.catalogId)}/items_batch`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        access_token: config.accessToken,
        item_type: 'PRODUCT_ITEM',
        requests: offers.map((offer) => ({
          method: 'UPDATE',
          data: {
            id: offer.id,
            title: offer.title,
            description: offer.description,
            availability: offer.availability,
            condition: offer.condition,
            price: offer.price,
            link: offer.link,
            image_link: offer.imageLink,
            additional_image_link: offer.additionalImages,
            brand: offer.brand,
            google_product_category: offer.googleProductCategory,
          },
        })),
      }),
    },
  );
  const payload = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) {
    return {
      configured: true,
      ok: false,
      sent: 0,
      message: payload.error?.message || 'Meta rechazó el catálogo.',
    };
  }
  return {
    configured: true,
    ok: true,
    sent: offers.length,
    message: `Meta actualizó ${offers.length} productos.`,
  };
}

export async function syncShopCatalog(fetchImpl: typeof fetch = fetch): Promise<{
  google: ChannelSync;
  meta: ChannelSync;
}> {
  const { products } = await loadPublicCatalog('es');
  const offers = catalogOffers(products, siteUrl(), 'es');
  const [google, meta] = await Promise.all([
    pushToGoogle(offers, googleMerchantConfig(), fetchImpl).catch((err: unknown) => ({
      configured: true,
      ok: false,
      sent: 0,
      message: err instanceof Error ? err.message : 'Error al sincronizar con Google.',
    })),
    pushToMeta(offers, metaCatalogConfig(), fetchImpl).catch((err: unknown) => ({
      configured: true,
      ok: false,
      sent: 0,
      message: err instanceof Error ? err.message : 'Error al sincronizar con Meta.',
    })),
  ]);
  return { google, meta };
}
