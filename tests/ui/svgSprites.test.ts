import { describe, it, expect, beforeEach } from 'vitest';
import {
  SVG_SPRITES_HTML,
  SYMBOL_VIEWBOXES,
  ALL_ICON_IDS,
  injectSvgSprites,
  renderIconSvg,
  enhanceStoryHtmlWithIcons
} from '../../src/ui/svgSprites';
import { BOOKS } from '../../src/data/types';

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
    expect(ALL_ICON_IDS.length).toBe(69);
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

  it('matches official Rulepop colors where Engage is Orange and Help is Green', () => {
    const engageMeta = BOOKS.find((b) => b.name === 'engage');
    const helpMeta = BOOKS.find((b) => b.name === 'help');
    const moveMeta = BOOKS.find((b) => b.name === 'move');
    const lookMeta = BOOKS.find((b) => b.name === 'look');
    const takeMeta = BOOKS.find((b) => b.name === 'take');
    const overpowerMeta = BOOKS.find((b) => b.name === 'overpower');

    expect(engageMeta?.color).toBe('#f18a3b');
    expect(helpMeta?.color).toBe('#00a341');
    expect(moveMeta?.color).toBe('#2d9cd7');
    expect(lookMeta?.color).toBe('#834d99');
    expect(takeMeta?.color).toBe('#ffd000');
    expect(overpowerMeta?.color).toBe('#e41123');
  });

  describe('enhanceStoryHtmlWithIcons', () => {
    it('enriches skill spans with inline SVG icons and classes', () => {
      const input = "<p>Roll dice to <span class='engage'>TRANSMIT</span> and <span class='move skill'>move</span></p>";
      const result = enhanceStoryHtmlWithIcons(input);

      expect(result).toContain('<use href="#i-engage"></use>');
      expect(result).toContain('inline-skill-icon icon-engage');
      expect(result).toContain('<use href="#i-move"></use>');
      expect(result).toContain('inline-skill-icon icon-move');
    });

    it('enriches s0 character cards and 21-mission dice lookup table', () => {
      const s0Sample = `
        <ol class="setup-steps-list">
          <li><strong>Step 2:</strong> Move (<span class="card-num">1435</span>), Look (<span class="card-num">1436</span>), Engage (<span class="card-num">1437</span>), Help (<span class="card-num">1438</span>), Take (<span class="card-num">1439</span>), or Overpower (<span class="card-num">1440</span>).</li>
        </ol>
        <table class="setup-mission-table">
          <tbody>
            <tr><td>Move + Move</td><td><span class="card-num">1590</span></td></tr>
            <tr><td>Look + Move</td><td><span class="card-num">1583</span></td></tr>
          </tbody>
        </table>
      `;
      const result = enhanceStoryHtmlWithIcons(s0Sample);

      // Character card badges
      expect(result).toContain('char-card-badge char-move');
      expect(result).toContain('char-card-badge char-engage');
      expect(result).toContain('char-card-badge char-help');

      // Table pair badges
      expect(result).toContain('skill-pair-badge pair-move');
      expect(result).toContain('skill-pair-badge pair-look');
      expect(result).toContain('<use href="#i-move"></use>');
      expect(result).toContain('<use href="#i-look"></use>');
    });

    it('does not duplicate icons if SVG icon is already present', () => {
      const input = `<span class='engage'><svg class='custom'><use href='#i-engage'/></svg>TRANSMIT</span>`;
      const result = enhanceStoryHtmlWithIcons(input);
      const matches = result.match(/use href/g);
      expect(matches?.length).toBe(1);
    });
  });
});

describe('icon words in story text', () => {
  it('adds icons and bold to game-term quantities only', async () => {
    const { enhanceStoryHtmlWithIcons } = await import('../../src/ui/svgSprites');
    const html = enhanceStoryHtmlWithIcons(
      '<p>Gain 2 boost and lose 1 time. Pay $5 to the Traveler. By the time you reach it, gain 3 coins.</p>'
    );
    expect(html).toContain('<strong class="icon-word icon-word-boost">');
    expect(html).toContain('#i-boost');
    expect(html).toContain('<strong class="icon-word icon-word-time">');
    expect(html).toContain('<strong class="icon-word icon-word-coin">');
    expect(html).toContain('#i-traveler');
    expect((html.match(/icon-word-coin/g) ?? []).length).toBe(2);
    // "by the time you reach" is ordinary English, not the time resource
    expect((html.match(/icon-word-time/g) ?? []).length).toBe(1);
  });

  it('leaves skill spans and location numbers alone', async () => {
    const { enhanceStoryHtmlWithIcons } = await import('../../src/ui/svgSprites');
    const html = enhanceStoryHtmlWithIcons("<p>Gain <span class='move skill'>1 move</span>; go to <span class='loc-num'>2 boost</span>.</p>");
    expect(html).not.toContain('icon-word');
  });
});
