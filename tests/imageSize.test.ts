import { describe, expect, it } from 'vitest';
import {
  fixedHeightImage,
  responsiveImage,
  shareImage,
  sizedImage,
  sizedImageByHeight,
} from '../src/lib/catalog/imageSize';

const CLOUD = 'https://res.cloudinary.com/demo/image/upload/c_limit,w_2000/f_auto/q_auto/portfolio-public/portfolio/frankie_jpeg';
const at = (transform: string) => CLOUD.replace('c_limit,w_2000', transform);

describe('sizedImage', () => {
  it('leaves Cloudinary URLs without our size cap alone', () => {
    const other = 'https://res.cloudinary.com/demo/image/upload/v1/frankie.jpg';
    expect(sizedImage(other, 480)).toBe(other);
  });
});

describe('sizedImageByHeight', () => {
  it('caps by height instead of width', () => {
    expect(sizedImageByHeight(CLOUD, 480)).toBe(at('c_limit,h_480'));
  });
});

describe('responsiveImage', () => {
  it('offers one copy per width, with the largest as src', () => {
    expect(responsiveImage(CLOUD, [240, 480], '50vw')).toEqual({
      src: at('c_limit,w_480'),
      srcset: `${at('c_limit,w_240')} 240w, ${at('c_limit,w_480')} 480w`,
      sizes: '50vw',
    });
  });

  it('keeps a single src for images it cannot resize', () => {
    expect(responsiveImage('/media/about/about-1.jpg', [240, 480], '50vw')).toEqual({ src: '/media/about/about-1.jpg' });
  });
});

describe('fixedHeightImage', () => {
  it('gives 1x and 2x copies by height', () => {
    expect(fixedHeightImage(CLOUD, 480)).toEqual({
      src: at('c_limit,h_480'),
      srcset: `${at('c_limit,h_480')} 1x, ${at('c_limit,h_960')} 2x`,
    });
  });
});

describe('shareImage', () => {
  it('pads the whole drawing to 1200 × 630 as a JPEG', () => {
    expect(shareImage(CLOUD)).toEqual({
      url: 'https://res.cloudinary.com/demo/image/upload/c_pad,w_1200,h_630,b_white/f_jpg/q_auto/portfolio-public/portfolio/frankie_jpeg',
      width: 1200,
      height: 630,
    });
  });

  it('passes other images through without claiming a size', () => {
    expect(shareImage('https://example.com/a.jpg')).toEqual({ url: 'https://example.com/a.jpg' });
  });
});
