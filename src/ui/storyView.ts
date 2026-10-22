import {
  BOOK_BY_PREFIX,
  ParsedBranchChoice,
  ParsedResultContent,
  StoryEntryVariant,
  StoryLookupResult,
} from '../data/types';
import { parseAndFormatResult } from '../speech/ttsFormatter';
import { renderIconSvg, enhanceStoryHtmlWithIcons } from './svgSprites';
import { VoiceController } from './voiceController';

export { enhanceStoryHtmlWithIcons };

export class StoryView {
  private container: HTMLElement;
  private controller: VoiceController;
  private unsubController: (() => void) | null = null;
  private currentParsedResult: ParsedResultContent | null = null;
  private lastRenderedKey = '';
  private lastRenderedVariantIndex: number | null = null;
  private lastObscuredState: boolean | null = null;
  private lastChosenBranchIndex: number | null = null;
  private lastMode = '';

  constructor(container: HTMLElement, controller: VoiceController) {
    this.container = container;
    this.controller = controller;

    this.unsubController = this.controller.onStateChange(() => {
      this.render();
    });

    this.render();
  }

  public dispose(): void {
    if (this.unsubController) {
      this.unsubController();
      this.unsubController = null;
    }
  }

  public render(): void {
    const state = this.controller.getState();
    const result = state.activeResult;

    if (!result) {
      this.container.innerHTML = '';
      this.container.classList.remove('is-active');
      this.lastRenderedKey = '';
      return;
    }

    this.container.classList.add('is-active');

    const meta = BOOK_BY_PREFIX[result.prefix];
    const isDisambiguating = state.mode === 'DISAMBIGUATING' && state.activeVariantIndex === null;
    const variantIndex = state.activeVariantIndex ?? 0;
    const variant = result.variants[variantIndex] as StoryEntryVariant | undefined;

    // Check if re-render is needed
    const currentRenderKey = `${result.key}_v${variantIndex}_obs${state.isObscured}_ch${state.chosenBranchIndex}_m${state.mode}`;
    if (currentRenderKey === this.lastRenderedKey) {
      return;
    }
    this.lastRenderedKey = currentRenderKey;

    if (variant) {
      this.currentParsedResult = parseAndFormatResult(variant.resultHtml);
    } else {
      this.currentParsedResult = null;
    }

    const directionIcon = this.getDirectionIcon(variant?.direction);

    this.container.innerHTML = `
      <article class="story-card book-theme-${result.bookName}" style="--book-theme-color: ${meta.color};">
        <!-- Header Bar -->
        <header class="story-header">
          <button type="button" class="btn-back-lookup" id="btn-back-lookup" title="Return to Storybook Lookup">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Lookup</span>
          </button>

          <div class="story-title-group">
            <div class="story-book-badge" style="background-color: ${meta.color};">
              ${renderIconSvg(meta.iconId, 'header-book-icon')}
              <span class="story-book-name">${meta.label.toUpperCase()}</span>
            </div>

            <div class="story-number-badge">
              <span class="story-number">${result.paddedNumber}</span>
            </div>

            ${variant?.region ? `<span class="story-region-badge">Region ${variant.region}</span>` : ''}
            ${directionIcon ? `<span class="story-dir-badge" title="Direction: ${variant?.direction}">${directionIcon}</span>` : ''}
          </div>
        </header>

        <!-- Multi-Option Selector (for d43, m51, or multi-variant entries) -->
        ${
          result.variants.length > 1
            ? `
          <div class="variant-options-bar ${isDisambiguating ? 'is-prompting' : ''}">
            <div class="variant-options-header">
              <span class="options-title">${isDisambiguating ? '⚠️ Choose an Option:' : 'Options:'}</span>
            </div>
            <div class="variant-pills-list">
              ${result.variants
                .map((v, idx) => {
                  const isSelected = state.activeVariantIndex === idx;
                  const dirIco = this.getDirectionIcon(v.direction);
                  const optLabel = v.option || (v.direction ? `Direction ${v.direction}` : `Option ${idx + 1}`);
                  const verb = v.primaryVerb ? v.primaryVerb.toUpperCase() : '';
                  return `
                    <button
                      type="button"
                      class="variant-pill ${isSelected ? 'is-selected' : ''}"
                      data-index="${idx}"
                    >
                      ${dirIco ? `<span class="pill-dir-icon">${dirIco}</span>` : ''}
                      <span class="pill-option-name">${optLabel}</span>
                      ${verb ? `<span class="pill-verb">${verb}</span>` : ''}
                      ${v.cost !== null && v.cost !== undefined && String(v.cost) !== "0" ? `<span class="pill-cost">${v.cost}🎲</span>` : ''}
                    </button>
                  `;
                })
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        <!-- Game Setup Navigation Banner (if on Card 000 or Card 001) -->
        ${this.renderSetupNavBanner(result.number)}

        ${
          variant
            ? `
          <!-- Action & Dice Prompt Box -->
          <section class="story-action-box">
            <div class="action-top-row">
              <div class="cost-indicator">
                ${this.renderCostBadge(variant.cost)}
              </div>
              <div class="action-content">
                <div class="action-html-body">${enhanceStoryHtmlWithIcons(variant.actionHtml || variant.actionPlain)}</div>
              </div>
              <button
                type="button"
                class="btn-replay-action"
                id="btn-replay-action"
                title="Repeat Pre-Done Prompt"
                aria-label="Repeat Pre-Done Prompt"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
                <span class="btn-repeat-text">Repeat</span>
              </button>
            </div>
          </section>

          <!-- Spoiler Protected Result Section -->
          <section class="story-result-box ${state.isObscured ? 'is-obscured' : 'is-revealed'}">
            <!-- Blurred Container -->
            <div class="result-content-container ${state.isObscured ? 'spoiler-blurred' : 'spoiler-revealed'}">
              <div class="result-html-body" id="result-html-body">
                ${enhanceStoryHtmlWithIcons(this.currentParsedResult ? this.currentParsedResult.mainHtml : variant.resultHtml)}
              </div>

              <!-- Branching Choices (if any) -->
              ${this.renderBranchingChoices(state.chosenBranchIndex)}
            </div>

            <!-- Spoiler Overlay Done Button (Displayed when obscured) -->
            ${
              state.isObscured
                ? `
              <div class="spoiler-overlay" id="spoiler-overlay">
                <button type="button" class="btn-reveal-done" id="btn-reveal-done">
                  <div class="done-btn-icon">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="3">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <div class="done-btn-text">
                    <span class="done-primary">DONE</span>
                    <span class="done-sub">Tap or say "Done" to read result</span>
                  </div>
                </button>
              </div>
            `
                : `
              <!-- Audio Controls Bar when Revealed -->
              <div class="revealed-audio-bar">
                <button type="button" class="btn-audio-action" id="btn-replay-audio" title="Repeat Post-Done Result">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                  </svg>
                  <span>🔁 Repeat Result</span>
                </button>
                <button type="button" class="btn-audio-action" id="btn-replay-prompt-post" title="Repeat Pre-Done Prompt">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                  </svg>
                  <span>🔁 Repeat Prompt</span>
                </button>
                <button type="button" class="btn-audio-action btn-audio-stop" id="btn-stop-audio" title="Stop Audio">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="1"></rect>
                  </svg>
                  <span>Stop</span>
                </button>
              </div>
            `
            }
          </section>
        `
            : ''
        }
      </article>
    `;

    this.bindEvents();
  }

  private renderCostBadge(cost: number | string | null): string {
    if (cost === null || cost === undefined || cost === 0 || String(cost) === "0") {
      return `<div class="cost-hex-badge cost-zero" title="No dice roll required"><span>Free</span></div>`;
    }

    const costStr = String(cost).trim().toUpperCase();
    if (costStr === "X") {
      return `
        <div class="cost-svg-wrapper" title="Roll any number of dice">
          ${renderIconSvg("i-cost-x", "dice-cost-svg")}
        </div>
      `;
    }

    const numericCost = typeof cost === "number" ? cost : parseInt(String(cost), 10);
    if (!isNaN(numericCost) && numericCost >= 1 && numericCost <= 10) {
      return `
        <div class="cost-svg-wrapper" title="Roll ${cost} dice challenge">
          ${renderIconSvg(`i-cost-${cost}`, 'dice-cost-svg')}
        </div>
      `;
    }

    return `
      <div class="cost-hex-badge cost-numeric" title="Roll ${cost} dice">
        <span class="cost-val">${cost}</span>
        <span class="cost-label">DICE</span>
      </div>
    `;
  }

  private getDirectionIcon(direction?: string | null): string | null {
    if (!direction) return null;
    const clean = direction.trim().toUpperCase();
    if (clean === 'N' || clean === 'NORTH') return renderIconSvg('i-north', 'dir-svg-icon');
    if (clean === 'E' || clean === 'EAST') return renderIconSvg('i-east', 'dir-svg-icon');
    if (clean === 'S' || clean === 'SOUTH') return renderIconSvg('i-south', 'dir-svg-icon');
    if (clean === 'W' || clean === 'WEST') return renderIconSvg('i-west', 'dir-svg-icon');
    return null;
  }

  private renderBranchingChoices(chosenBranchIndex: number | null): string {
    if (!this.currentParsedResult || !this.currentParsedResult.hasChoices) {
      return '';
    }

    const choices = this.currentParsedResult.choices;
    const isSequential = this.currentParsedResult.isSequential;

    if (isSequential) {
      const nextAvailableIndex = chosenBranchIndex !== null ? chosenBranchIndex + 1 : 0;
      const visibleChoices = choices.filter((_, idx) => idx <= nextAvailableIndex);

      return `
        <div class="story-branching-section sequential-branch-section">
          <div class="branching-heading">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <span>Progressive Result (Read Next Result Only):</span>
          </div>
          <div class="branch-cards-grid sequential-cards-grid">
            ${visibleChoices
              .map((choice: ParsedBranchChoice, idx: number) => {
                const isRevealed = chosenBranchIndex !== null && idx <= chosenBranchIndex;
                const isNext = idx === nextAvailableIndex;

                if (isRevealed) {
                  return `
                    <div class="branch-choice-card is-chosen is-expanded sequential-revealed-step" data-choice-index="${idx}">
                      <div class="sequential-step-header">
                        <span class="branch-step-badge">Result ${idx + 1}</span>
                        ${choice.actionHtml ? `<span class="branch-step-action-tag">${enhanceStoryHtmlWithIcons(choice.actionHtml)}</span>` : ''}
                      </div>
                      <div class="branch-body-content is-expanded">
                        ${enhanceStoryHtmlWithIcons(choice.html)}
                      </div>
                    </div>
                  `;
                }

                if (isNext) {
                  const displaySummary = choice.summaryHtml || choice.summary || 'Continue';
                  return `
                    <div class="branch-choice-card is-next-step" data-choice-index="${idx}">
                      <button type="button" class="branch-summary-btn branch-continue-btn" data-choice-index="${idx}">
                        <span class="branch-continue-tag">Option ${idx + 1}</span>
                        <div class="branch-title-group">
                          <span class="branch-title">${enhanceStoryHtmlWithIcons(displaySummary)}</span>
                          ${choice.actionHtml ? `<span class="branch-action-preview">${enhanceStoryHtmlWithIcons(choice.actionHtml)}</span>` : ''}
                        </div>
                        <span class="branch-chevron" aria-hidden="true">▶</span>
                      </button>
                    </div>
                  `;
                }

                return '';
              })
              .join('')}
          </div>
        </div>
      `;
    }

    return `
      <div class="story-branching-section">
        <div class="branching-heading">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="6" y1="3" x2="6" y2="15"></line>
            <circle cx="18" cy="6" r="3"></circle>
            <circle cx="6" cy="18" r="3"></circle>
            <path d="M18 9a9 9 0 0 1-9 9"></path>
          </svg>
          <span>Choose an outcome:</span>
        </div>
        <div class="branch-cards-grid">
          ${choices
            .map((choice: ParsedBranchChoice, idx: number) => {
              const isChosen = chosenBranchIndex === idx;
              const displaySummary = choice.summaryHtml || choice.summary;
              return `
                <div class="branch-choice-card ${isChosen ? 'is-chosen' : ''}" data-choice-index="${idx}">
                  <button type="button" class="branch-summary-btn" data-choice-index="${idx}">
                    <span class="branch-num-tag">Option ${idx + 1}</span>
                    <span class="branch-title">${enhanceStoryHtmlWithIcons(displaySummary)}</span>
                    <span class="branch-chevron" aria-hidden="true">${isChosen ? '▼' : '▶'}</span>
                  </button>
                  <div class="branch-body-content ${isChosen ? 'is-expanded' : 'is-collapsed'}">
                    ${enhanceStoryHtmlWithIcons(choice.html)}
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  private renderSetupNavBanner(number: number): string {
    if (number === 0) {
      return `
        <div class="setup-nav-banner setup-nav-000">
          <button type="button" class="btn-setup-nav" id="btn-nav-to-001">
            <span>Next: Go to Location 001 (Escape Pods) →</span>
          </button>
        </div>
      `;
    }
    if (number === 1) {
      return `
        <div class="setup-nav-banner setup-nav-001">
          <div class="setup-nav-row">
            <button type="button" class="btn-setup-nav btn-setup-prev" id="btn-nav-to-000">
              <span>← Back to Location 000 (Setup)</span>
            </button>
          </div>
          <div class="starting-pods-nav">
            <span class="pods-nav-label">Select Starting Escape Pod:</span>
            <div class="pods-nav-buttons">
              <button type="button" class="btn-pod-loc btn-pod-move" data-loc="2" title="Move Escape Pod (Location 002)">
                ${renderIconSvg('i-move', 'pod-skill-icon')}
                <span>Move 002</span>
              </button>
              <button type="button" class="btn-pod-loc btn-pod-look" data-loc="3" title="Look Escape Pod (Location 003)">
                ${renderIconSvg('i-look', 'pod-skill-icon')}
                <span>Look 003</span>
              </button>
              <button type="button" class="btn-pod-loc btn-pod-engage" data-loc="4" title="Engage Escape Pod (Location 004)">
                ${renderIconSvg('i-engage', 'pod-skill-icon')}
                <span>Engage 004</span>
              </button>
              <button type="button" class="btn-pod-loc btn-pod-help" data-loc="5" title="Help Escape Pod (Location 005)">
                ${renderIconSvg('i-help', 'pod-skill-icon')}
                <span>Help 005</span>
              </button>
              <button type="button" class="btn-pod-loc btn-pod-take" data-loc="6" title="Take Escape Pod (Location 006)">
                ${renderIconSvg('i-take', 'pod-skill-icon')}
                <span>Take 006</span>
              </button>
              <button type="button" class="btn-pod-loc btn-pod-overpower" data-loc="7" title="Overpower Escape Pod (Location 007)">
                ${renderIconSvg('i-overpower', 'pod-skill-icon')}
                <span>Overpower 007</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }
    return '';
  }

  private bindEvents(): void {
    // Back to lookup button
    const backBtn = this.container.querySelector('#btn-back-lookup');
    backBtn?.addEventListener('click', () => {
      this.controller.backToLookup();
    });

    // Variant pills
    const variantPills = this.container.querySelectorAll<HTMLButtonElement>('.variant-pill');
    variantPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const idx = parseInt(pill.dataset.index || '0', 10);
        this.controller.selectDisambiguationOption(idx);
      });
    });

    // Speak / Replay Action prompt button (Pre-Done)
    const replayActionBtn = this.container.querySelector('#btn-replay-action');
    replayActionBtn?.addEventListener('click', () => {
      this.controller.handleRepeat('pre');
    });

    // DONE Button
    const doneBtn = this.container.querySelector('#btn-reveal-done');
    doneBtn?.addEventListener('click', () => {
      this.controller.revealResult();
    });

    // Replay post-done result button
    const replayAudioBtn = this.container.querySelector('#btn-replay-audio');
    replayAudioBtn?.addEventListener('click', () => {
      this.controller.handleRepeat('post');
    });

    // Replay pre-done prompt from revealed audio bar
    const replayPromptPostBtn = this.container.querySelector('#btn-replay-prompt-post');
    replayPromptPostBtn?.addEventListener('click', () => {
      this.controller.handleRepeat('pre');
    });

    // Stop audio button
    const stopAudioBtn = this.container.querySelector('#btn-stop-audio');
    stopAudioBtn?.addEventListener('click', () => {
      this.controller.stopAudio();
    });

    // Setup navigation
    const navTo001Btn = this.container.querySelector('#btn-nav-to-001');
    navTo001Btn?.addEventListener('click', () => {
      const db = this.controller.getDatabase();
      const s1 = db.getByKey('s1') || db.getByBookAndNumber('s', 1);
      if (s1) {
        this.controller.executeLookup(s1, 0);
      }
    });

    const navTo000Btn = this.container.querySelector('#btn-nav-to-000');
    navTo000Btn?.addEventListener('click', () => {
      const db = this.controller.getDatabase();
      const s0 = db.getByKey('s0') || db.getByBookAndNumber('s', 0);
      if (s0) {
        this.controller.executeLookup(s0, 0);
      }
    });

    // Starting Escape Pod buttons
    const podBtns = this.container.querySelectorAll<HTMLButtonElement>('.btn-pod-loc');
    podBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const loc = parseInt(btn.dataset.loc || '', 10);
        if (!isNaN(loc)) {
          const db = this.controller.getDatabase();
          const entries = db.getEntriesForNumber(loc);
          if (entries.length === 1) {
            this.controller.executeLookup(entries[0], 0);
          } else if (entries.length > 1) {
            this.controller.handleTextInput(String(loc));
          }
        }
      });
    });

    // Clickable .loc-num in result content
    this.container.querySelectorAll<HTMLElement>('.loc-num').forEach((el) => {
      el.style.cursor = 'pointer';
      el.title = `Jump to location ${el.textContent?.trim()}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const numText = el.textContent?.trim();
        if (numText) {
          const num = parseInt(numText, 10);
          if (!isNaN(num)) {
            const db = this.controller.getDatabase();
            if (num === 0) {
              const entry = db.getByKey('s0') || db.getByBookAndNumber('s', 0);
              if (entry) this.controller.executeLookup(entry, 0);
            } else if (num === 1) {
              const entry = db.getByKey('s1') || db.getByBookAndNumber('s', 1);
              if (entry) this.controller.executeLookup(entry, 0);
            } else {
              const entries = db.getEntriesForNumber(num);
              if (entries.length === 1) {
                this.controller.executeLookup(entries[0], 0);
              } else if (entries.length > 1) {
                this.controller.handleTextInput(numText);
              }
            }
          }
        }
      });
    });

    // Branch choice cards
    const choiceCards = this.container.querySelectorAll<HTMLElement>('.branch-choice-card');
    choiceCards.forEach((card) => {
      const summaryBtn = card.querySelector('.branch-summary-btn');
      summaryBtn?.addEventListener('click', () => {
        const idx = parseInt(card.dataset.choiceIndex || '0', 10);
        this.controller.selectBranchChoice(idx);
      });
    });
  }
}
