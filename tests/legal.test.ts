import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from './helpers/fakeDb';
import {
  formatUpdated,
  getLegalDoc,
  identityLines,
  inlineParts,
  legalDocs,
  postalAddress,
  returnsPolicy,
  sectionId,
  withdrawalAddressee,
  withdrawalForm,
  type LegalPageKey,
} from '../src/lib/content/legal';
import { sellerIdentity, SELLER, type SellerIdentity } from '../src/lib/server/sellerIdentity';
import { localizedPath } from '../src/i18n/routes';

const KEYS = Object.keys(legalDocs) as LegalPageKey[];
const LOCALES = ['es', 'en'] as const;

/** Every piece of text a page shows, flattened. */
function allText(key: LegalPageKey, locale: 'es' | 'en'): string {
  const content = legalDocs[key][locale];
  const blocks = content.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap((b) => (typeof b === 'string' ? [b] : Array.isArray(b) ? b : 'h' in b ? [b.h] : []))]);
  return [content.title, content.description, ...content.intro, ...blocks].join('\n');
}

const full: SellerIdentity = {
  ...SELLER,
  taxId: '12345678Z',
  address: 'Calle Mayor 1, 2.º B',
  postalCode: '46001',
  city: 'Valencia',
};
const empty: SellerIdentity = { ...SELLER, taxId: null, address: null, postalCode: null, city: null };

describe('legal pages', () => {
  it('are final: dated 2026-11-28, with no draft notes and no old providers', () => {
    for (const key of KEYS) {
      expect(legalDocs[key].updated).toBe('2026-11-28');
      for (const locale of LOCALES) {
        const text = allText(key, locale);
        expect(text).not.toMatch(/pendiente de revisi|pending|not yet finalised|supabase|replaced with a fully reviewed|antes de la venta real/i);
        // The EU ODR platform closed in July 2025.
        expect(text).not.toMatch(/ec\.europa\.eu\/consumers\/odr|plataforma de resolución de litigios en línea|online dispute resolution/i);
      }
    }
  });

  it('give every page a title and a meta description of search-snippet length in both languages', () => {
    for (const key of KEYS) {
      for (const locale of LOCALES) {
        const doc = getLegalDoc(key, locale);
        expect(doc.title.length).toBeGreaterThan(3);
        expect(doc.description.length).toBeGreaterThanOrEqual(70);
        expect(doc.description.length).toBeLessThanOrEqual(160);
      }
    }
  });

  it('have the same sections in Spanish and in English', () => {
    for (const key of KEYS) {
      const es = legalDocs[key].es.sections;
      const en = legalDocs[key].en.sections;
      expect(en.length).toBe(es.length);
      es.forEach((section, i) => expect(en[i]!.blocks.length).toBe(section.blocks.length));
    }
  });

  it('give each section a unique anchor', () => {
    for (const key of KEYS) {
      for (const locale of LOCALES) {
        const ids = getLegalDoc(key, locale).sections.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => expect(id).toMatch(/^[a-z0-9-]+$/));
      }
    }
  });

  it('only link to anchors that exist', () => {
    const anchors = new Map<string, Set<string>>();
    for (const key of KEYS) {
      for (const locale of LOCALES) {
        anchors.set(localizedPath(locale, key), new Set(getLegalDoc(key, locale).sections.map((s) => s.id)));
      }
    }
    for (const key of KEYS) {
      for (const locale of LOCALES) {
        const links = getLegalDoc(key, locale).sections.flatMap((s) =>
          s.blocks.flatMap((b) => (b.type === 'p' ? b.parts : b.type === 'list' ? b.items.flat() : [])),
        );
        for (const link of links.filter((p) => p.href?.includes('#'))) {
          const [path, hash] = link.href!.split('#');
          const target = anchors.get(path || localizedPath(locale, key));
          expect(target?.has(hash!), `${key}/${locale}: ${link.href}`).toBe(true);
        }
      }
    }
  });

  it('state the returns policy word for word on the terms and on the shipping page', () => {
    for (const locale of LOCALES) {
      const find = (key: LegalPageKey) =>
        legalDocs[key][locale].sections.flatMap((s) => s.blocks).find((b) => b === returnsPolicy[locale]);
      expect(find('terms')).toBe(returnsPolicy[locale]);
      expect(find('shipping')).toBe(returnsPolicy[locale]);
    }
    expect(returnsPolicy.es.join(' ')).toMatch(/14 días naturales desde la entrega/);
    expect(returnsPolicy.es.join(' ')).toMatch(/coste directo de devolver el producto corre de tu cuenta/);
    expect(returnsPolicy.es.join(' ')).toMatch(/incluido el envío estándar de ida, por el mismo medio de pago y en un máximo de 14 días/);
    expect(returnsPolicy.es.join(' ')).toMatch(/art\. 103 c/);
    expect(returnsPolicy.en.join(' ')).toMatch(/14 calendar days from delivery/);
    expect(returnsPolicy.en.join(' ')).toMatch(/art\. 103 c/);
  });

  it('state the retention periods given for the data', () => {
    const es = allText('privacy', 'es');
    for (const fact of ['6 años', 'art. 30 del Código de Comercio', 'a los 30 días', '90 días después del envío', '2 años después de la última actividad', 'a los 13 meses', 'las diarias se guardan 35 días', 'la del día 1 de cada mes se guarda 6 años']) {
      expect(es).toContain(fact);
    }
    const en = allText('privacy', 'en');
    for (const fact of ['6 years', 'art. 30 of the Spanish Commercial Code', 'after 30 days', '90 days after sending', '2 years after the last activity', 'after 13 months', 'daily backups are kept for 35 days', 'the 1st of each month is kept for 6 years']) {
      expect(en).toContain(fact);
    }
  });

  it('name the processors the code uses, and the complaint authority', () => {
    for (const locale of LOCALES) {
      const text = allText('privacy', locale);
      for (const name of ['Vercel', 'Aiven', 'DigitalOcean', 'Cloudinary', 'Resend', 'Stripe', 'PayPal', 'Correos', 'Cloudflare', 'aepd.es']) {
        expect(text, `${locale}: ${name}`).toContain(name);
      }
    }
  });

  it('list every cookie and storage key the site sets', () => {
    for (const locale of LOCALES) {
      const text = allText('cookies', locale);
      for (const key of [
        'pd_cart_owner',
        'better-auth.session_token',
        'pd_flash',
        'petsdrawings.cart.v1',
        'petsdrawings.destination.v1',
        'petsdrawings.checkout.v1',
        'petsdrawings.coupon.v1',
        'pd-analytics',
        'pd-visit',
        'petsdrawings.orderAccess.v1',
        'petsdrawings.commissionPayment.v1',
      ]) {
        expect(text, `${locale}: ${key}`).toContain(`\`${key}\``);
      }
    }
  });

  it('read the seller identity only where it is shown', () => {
    expect(getLegalDoc('terms', 'es').needsIdentity).toBe(true);
    expect(getLegalDoc('privacy', 'en').needsIdentity).toBe(true);
    expect(getLegalDoc('shipping', 'es').needsIdentity).toBe(true);
    expect(getLegalDoc('cookies', 'es').needsIdentity).toBe(false);
    expect(getLegalDoc('accountHelp', 'en').needsIdentity).toBe(false);
  });

  it('carry the model withdrawal form on the shipping page', () => {
    for (const locale of LOCALES) {
      const blocks = getLegalDoc('shipping', locale).sections.flatMap((s) => s.blocks);
      expect(blocks.some((b) => b.type === 'withdrawalForm')).toBe(true);
      expect(withdrawalForm[locale].lines).toHaveLength(6);
    }
    expect(withdrawalForm.es.lines[0]).toMatch(/^Por la presente le comunico\/comunicamos/);
  });

  it('formats the update date in each language', () => {
    expect(formatUpdated('2026-11-28', 'es')).toBe('28 de noviembre de 2026');
    expect(formatUpdated('2026-11-28', 'en')).toBe('28 November 2026');
  });
});

describe('inlineParts', () => {
  it('splits links and names out of the text', () => {
    expect(inlineParts('Escribe a [info@petsdrawings.com](mailto:info@petsdrawings.com) o borra `pd-analytics`.')).toEqual([
      { text: 'Escribe a ' },
      { text: 'info@petsdrawings.com', href: 'mailto:info@petsdrawings.com' },
      { text: ' o borra ' },
      { text: 'pd-analytics', code: true },
      { text: '.' },
    ]);
    expect(inlineParts('Sin marcas.')).toEqual([{ text: 'Sin marcas.' }]);
  });

  it('makes anchors from headings', () => {
    expect(sectionId('Retratos por encargo')).toBe('retratos-por-encargo');
    expect(sectionId('Transferencias fuera del Espacio Económico Europeo')).toBe('transferencias-fuera-del-espacio-economico-europeo');
  });
});

describe('identityLines', () => {
  it('shows the fiscal data when Admin has it', () => {
    expect(identityLines(full, 'es')).toEqual([
      { label: 'Titular', value: 'Meili Stringfellow' },
      { label: 'Nombre comercial', value: 'Pets Drawings' },
      { label: 'NIF', value: '12345678Z' },
      { label: 'Domicilio', value: 'Calle Mayor 1, 2.º B, 46001 Valencia, España' },
      { label: 'Email', value: 'info@petsdrawings.com', href: 'mailto:info@petsdrawings.com' },
      { label: 'Teléfono y WhatsApp', value: '+34 636 386 531', href: 'tel:+34636386531' },
    ]);
    expect(withdrawalAddressee(full, 'en')).toBe(
      'Meili Stringfellow (Pets Drawings), Calle Mayor 1, 2.º B, 46001 Valencia, Spain, info@petsdrawings.com',
    );
  });

  it('leaves out the lines Admin has not filled in', () => {
    const labels = identityLines(empty, 'en').map((l) => l.label);
    expect(labels).toEqual(['Owner', 'Trading name', 'Email', 'Phone and WhatsApp']);
    expect(postalAddress(empty, 'es')).toBeNull();
    expect(postalAddress({ ...empty, city: 'Valencia' }, 'es')).toBe('Valencia, España');
    expect(withdrawalAddressee(empty, 'es')).toBe('Meili Stringfellow (Pets Drawings), info@petsdrawings.com');
  });
});

describe('sellerIdentity', () => {
  it('reads the invoice issuer from the shop settings', async () => {
    const { db, queries } = fakeDb({
      query: () => ({
        invoice_config: {
          issuerName: 'Meili Stringfellow',
          issuerNif: ' 12345678Z ',
          issuerAddress: 'Calle Mayor 1',
          issuerPostalCode: '46001',
          issuerCity: 'Valencia',
          issuerKind: 'autonomo',
        },
      }),
    });
    await expect(sellerIdentity(db)).resolves.toEqual({
      ...SELLER,
      taxId: '12345678Z',
      address: 'Calle Mayor 1',
      postalCode: '46001',
      city: 'Valencia',
    });
    expect(queries[0]!.text).toMatch(/select invoice_config from public\.shop_settings where id = 1/);
  });

  it('turns empty fields into nulls (the default settings row)', async () => {
    const { db } = fakeDb({
      query: () => ({ invoice_config: { issuerName: '', issuerNif: '', issuerAddress: '  ', issuerPostalCode: '', issuerCity: '' } }),
    });
    await expect(sellerIdentity(db)).resolves.toEqual(empty);
  });

  it('keeps the fixed lines when there is no database or it fails', async () => {
    await expect(sellerIdentity(null)).resolves.toEqual(empty);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db } = fakeDb({
      query: () => {
        throw new Error('connection refused');
      },
    });
    await expect(sellerIdentity(db)).resolves.toEqual(empty);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
