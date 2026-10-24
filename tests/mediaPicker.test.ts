import { describe, expect, it } from 'vitest';
import { mediaDisplayName } from '../src/lib/admin/mediaPicker';

describe('mediaDisplayName', () => {
  it('drops the folder and the upload id', () => {
    expect(mediaDisplayName('uploads/35a20348-a2bc-41d6-8e6f-09d5789f51b3-luna.png')).toBe('luna.png');
  });

  it('keeps names that have no upload id', () => {
    expect(mediaDisplayName('portfolio/kira-sox-drawing.jpg')).toBe('kira-sox-drawing.jpg');
    expect(mediaDisplayName('logo.png')).toBe('logo.png');
  });
});
