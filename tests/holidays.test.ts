import { describe, expect, it } from 'vitest';
import { holidayNotice, holidayText, madridDay } from '../src/lib/domain/holidays';

describe('holidayNotice', () => {
  it('says how long there is to order in time for Christmas', () => {
    expect(holidayNotice('2026-12-18', '2026-11-26')).toEqual({ kind: 'before', deadline: '2026-12-18' });
    expect(holidayNotice('2026-12-18', '2026-12-18')).toEqual({ kind: 'before', deadline: '2026-12-18' });
  });

  it('warns once the date has gone, until Christmas Eve', () => {
    expect(holidayNotice('2026-12-18', '2026-12-19')).toEqual({ kind: 'late' });
    expect(holidayNotice('2026-12-18', '2026-12-24')).toEqual({ kind: 'late' });
  });

  it('says nothing out of season or without a date', () => {
    expect(holidayNotice('2026-12-18', '2026-10-20')).toBeNull();
    expect(holidayNotice('2026-12-18', '2026-12-25')).toBeNull();
    expect(holidayNotice(null, '2026-11-26')).toBeNull();
  });
});

describe('holidayText', () => {
  it('names the day in each language', () => {
    expect(holidayText({ kind: 'before', deadline: '2026-12-18' }, 'es')).toBe(
      'Pide hasta el viernes 18 de diciembre para recibirlo antes de Navidad.',
    );
    expect(holidayText({ kind: 'before', deadline: '2026-12-18' }, 'en')).toBe(
      'Order by Friday 18 December to receive it before Christmas.',
    );
    expect(holidayText({ kind: 'late' }, 'es')).toMatch(/Ya no podemos asegurar/);
  });

  it('can name the zone', () => {
    expect(holidayText({ kind: 'before', deadline: '2026-12-18' }, 'es', 'Península')).toBe(
      'Para Navidad (Península): pide hasta el viernes 18 de diciembre.',
    );
  });
});

describe('madridDay', () => {
  it('is the date in Spain, not in UTC', () => {
    expect(madridDay(new Date('2026-11-25T23:30:00Z'))).toBe('2026-11-26');
  });
});
