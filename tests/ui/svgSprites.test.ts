import { describe, it, expect, beforeEach } from 'vitest';
import {
  SVG_SPRITES_HTML,
  SYMBOL_VIEWBOXES,
  ALL_ICON_IDS,
  injectSvgSprites,
  renderIconSvg
} from '../../src/ui/svgSprites';

describe('svgSprites', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('contains the SVG sprites HTML with all required symbols', () => {
    expect(SVG_SPRITES_HTML).toContain('id="sprites"');
    expect(SVG_SPRITES_HTML).toContain('id="i-move"');
    expect(SVG_SPRITES_HTML).toContain('id="key-move"');
    expect(SVG_SPRITES_HTML).toContain('id="i-cost-1"');
    expect(SVG_SPRITES_HTML).toContain('id="i-cost-6"');
    expect(SVG_SPRITES_HTML).toContain('id="i-north"');
    expect(SVG_SPRITES_HTML).toContain('id="i-secret"');
    expect(ALL_ICON_IDS).toContain('i-move');
    expect(ALL_ICON_IDS).toContain('i-secret');
    expect(ALL_ICON_IDS.length).toBe(68);
  });

  it('injects the SVG sprite element into document.body only once', () => {
    expect(document.getElementById('sprites')).toBeNull();
    injectSvgSprites();
    const spritesEl = document.getElementById('sprites');
    expect(spritesEl).not.toBeNull();
    expect(spritesEl?.getAttribute('style')).toContain('display: none');

    // Calling again does not duplicate
    injectSvgSprites();
    expect(document.querySelectorAll('#sprites').length).toBe(1);
  });

  it('renders SVG icon markup with correct viewBox and use href', () => {
    const icon1 = renderIconSvg('i-move');
    expect(icon1).toContain('class="icon"');
    expect(icon1).toContain('viewBox="0 0 398 500"');
    expect(icon1).toContain('<use href="#i-move"></use>');

    const icon2 = renderIconSvg('#key-move', 'custom-key-class');
    expect(icon2).toContain('class="custom-key-class"');
    expect(icon2).toContain('viewBox="0 0 500 500"');
    expect(icon2).toContain('<use href="#key-move"></use>');

    const unknownIcon = renderIconSvg('non-existent-icon');
    expect(unknownIcon).toContain('viewBox="0 0 500 500"');
    expect(unknownIcon).toContain('<use href="#non-existent-icon"></use>');
  });

  it('has valid viewBox for all extracted symbols', () => {
    for (const [id, vb] of Object.entries(SYMBOL_VIEWBOXES)) {
      expect(typeof id).toBe('string');
      expect(typeof vb).toBe('string');
      expect(vb.split(' ').length).toBe(4);
    }
  });
});
