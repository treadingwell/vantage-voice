import { BookPrefix, BOOKS, BOOK_BY_PREFIX, StoryLookupResult } from '../data/types';
import { renderIconSvg } from './svgSprites';
import { VoiceController } from './voiceController';

export class LookupPad {
  private container: HTMLElement;
  private controller: VoiceController;
  private selectedPrefix: BookPrefix | null = null;
  private enteredDigits = '';
  private unsubController: (() => void) | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement, controller: VoiceController) {
    this.container = container;
    this.controller = controller;

    this.unsubController = this.controller.onStateChange(() => {
      this.renderRecentLookups();
    });

    this.boundKeyHandler = this.handleKeyDown.bind(this);
    window.addEventListener('keydown', this.boundKeyHandler);

    this.render();
  }

  public dispose(): void {
    if (this.unsubController) {
      this.unsubController();
      this.unsubController = null;
    }
    if (this.boundKeyHandler) {
      window.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
  }

  public setBook(prefix: BookPrefix | null): void {
    this.selectedPrefix = prefix;
    this.updateDisplay();
  }

  public setNumber(digits: string): void {
    this.enteredDigits = digits.slice(0, 4);
    this.updateDisplay();
  }

  public clear(): void {
    this.enteredDigits = '';
    this.updateDisplay();
  }

  public resetAll(): void {
    this.selectedPrefix = null;
    this.enteredDigits = '';
    this.updateDisplay();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Ignore keyboard input if focus is on an input or textarea
    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable))
    ) {
      return;
    }

    // Don't intercept if story view or modal is active
    const state = this.controller.getState();
    if (state.activeResult !== null && state.mode !== 'DISAMBIGUATING') {
      return;
    }

    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      this.addDigit(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      this.removeDigit();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.submitLookup();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.clear();
    } else {
      // Hotkeys for book selection
      const key = e.key.toLowerCase();
      if (['m', 'l', 'e', 'h', 't', 'o', 'd', 's'].includes(key)) {
        e.preventDefault();
        const prefix = key as BookPrefix;
        this.selectedPrefix = this.selectedPrefix === prefix ? null : prefix;
        this.updateDisplay();
      }
    }
  }

  private addDigit(digit: string): void {
    if (this.enteredDigits.length >= 4) return;
    this.enteredDigits += digit;
    this.updateDisplay();
  }

  private removeDigit(): void {
    if (this.enteredDigits.length === 0) return;
    this.enteredDigits = this.enteredDigits.slice(0, -1);
    this.updateDisplay();
  }

  private submitLookup(): void {
    if (!this.enteredDigits) return;
    const num = parseInt(this.enteredDigits, 10);
    if (isNaN(num)) return;

    const db = this.controller.getDatabase();

    if (this.selectedPrefix) {
      const match = db.getByBookAndNumber(this.selectedPrefix, num);
      if (match) {
        this.controller.executeLookup(match, null);
      }
    } else {
      const entries = db.getEntriesForNumber(num);
      if (entries.length === 1) {
        this.controller.executeLookup(entries[0], null);
      } else if (entries.length > 1) {
        this.controller.handleTextInput(this.enteredDigits);
      }
    }
  }

  private checkLookupValidity(): {
    valid: boolean;
    entries: StoryLookupResult[];
    exactMatch: StoryLookupResult | null;
  } {
    if (!this.enteredDigits) {
      return { valid: false, entries: [], exactMatch: null };
    }
    const num = parseInt(this.enteredDigits, 10);
    if (isNaN(num)) {
      return { valid: false, entries: [], exactMatch: null };
    }

    const db = this.controller.getDatabase();

    if (this.selectedPrefix) {
      const match = db.getByBookAndNumber(this.selectedPrefix, num);
      return {
        valid: match !== null,
        entries: match ? [match] : [],
        exactMatch: match,
      };
    } else {
      const entries = db.getEntriesForNumber(num);
      return {
        valid: entries.length > 0,
        entries,
        exactMatch: entries.length === 1 ? entries[0] : null,
      };
    }
  }

  public render(): void {
    this.container.innerHTML = `
      <div class="lookup-pad-card">
        <!-- Quick Text/Voice Command Bar -->
        <div class="quick-command-bar">
          <form class="quick-command-form" id="quick-command-form">
            <span class="command-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              id="quick-command-input"
              class="quick-command-input"
              placeholder='Type or say: "Transmit on 236", "Depart 43", "e236"'
              autocomplete="off"
              spellcheck="false"
            />
            <button type="submit" class="btn-quick-submit" title="Lookup Command">Go</button>
          </form>
        </div>

        <!-- Recent Lookups History -->
        <div class="recent-lookups-wrapper" id="recent-lookups-wrapper">
          <div class="recent-lookups-list" id="recent-lookups-list"></div>
        </div>

        <!-- Main Display Bar -->
        <div class="display-bar" id="display-bar">
          <div class="display-book-chip" id="display-book-chip">
            <span class="chip-icon" id="display-chip-icon"></span>
            <span class="chip-label" id="display-chip-label">Any Book</span>
          </div>

          <div class="display-digits" id="display-digits">
            <span class="digits-text" id="digits-text">---</span>
          </div>

          <button type="button" class="btn-clear-digits" id="btn-clear-digits" aria-label="Clear digits" title="Clear">
            ✕
          </button>
        </div>

        <!-- Action Preview Chips (Dynamically populated when digits are entered) -->
        <div class="action-previews" id="action-previews"></div>

        <!-- 8 Storybook Icon Buttons -->
        <div class="storybook-grid" id="storybook-grid">
          ${BOOKS.map((book) => {
            return `
              <button
                type="button"
                class="book-btn"
                data-prefix="${book.prefix}"
                data-name="${book.name}"
                title="${book.label} (${book.prefix.toUpperCase()})"
                aria-label="${book.label}"
                style="--book-accent: ${book.color};"
              >
                <div class="book-btn-icon">
                  ${renderIconSvg(book.keyIconId, 'book-svg-icon')}
                </div>
                <span class="book-btn-label">${book.label}</span>
              </button>
            `;
          }).join('')}
        </div>

        <!-- 0-9 Numpad Grid -->
        <div class="numpad-grid">
          <button type="button" class="numpad-btn" data-key="1">1</button>
          <button type="button" class="numpad-btn" data-key="2">2</button>
          <button type="button" class="numpad-btn" data-key="3">3</button>

          <button type="button" class="numpad-btn" data-key="4">4</button>
          <button type="button" class="numpad-btn" data-key="5">5</button>
          <button type="button" class="numpad-btn" data-key="6">6</button>

          <button type="button" class="numpad-btn" data-key="7">7</button>
          <button type="button" class="numpad-btn" data-key="8">8</button>
          <button type="button" class="numpad-btn" data-key="9">9</button>

          <button type="button" class="numpad-btn numpad-backspace" id="btn-backspace" aria-label="Backspace">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path>
              <line x1="18" y1="9" x2="12" y2="15"></line>
              <line x1="12" y1="9" x2="18" y2="15"></line>
            </svg>
          </button>
          <button type="button" class="numpad-btn" data-key="0">0</button>
          <button type="button" class="numpad-btn numpad-submit" id="btn-submit" aria-label="Submit" disabled>
            <span class="submit-label">Go</span>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
    this.updateDisplay();
    this.renderRecentLookups();
  }

  private bindEvents(): void {
    // Quick Command Form
    const form = this.container.querySelector('#quick-command-form') as HTMLFormElement;
    const input = this.container.querySelector('#quick-command-input') as HTMLInputElement;

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (val) {
        this.controller.handleTextInput(val);
        input.value = '';
        input.blur();
      }
    });

    // Book buttons
    const bookBtns = this.container.querySelectorAll<HTMLButtonElement>('.book-btn');
    bookBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const prefix = btn.dataset.prefix as BookPrefix;
        this.selectedPrefix = this.selectedPrefix === prefix ? null : prefix;
        this.updateDisplay();
      });
    });

    // Clear book selection when chip is clicked
    const bookChip = this.container.querySelector('#display-book-chip');
    bookChip?.addEventListener('click', () => {
      if (this.selectedPrefix) {
        this.selectedPrefix = null;
        this.updateDisplay();
      }
    });

    // Digits clear button
    const clearBtn = this.container.querySelector('#btn-clear-digits');
    clearBtn?.addEventListener('click', () => {
      this.clear();
    });

    // Numpad number buttons
    const numBtns = this.container.querySelectorAll<HTMLButtonElement>('.numpad-btn[data-key]');
    numBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (key) {
          this.addDigit(key);
        }
      });
    });

    // Backspace button
    const backspaceBtn = this.container.querySelector('#btn-backspace');
    backspaceBtn?.addEventListener('click', () => {
      this.removeDigit();
    });

    // Submit button
    const submitBtn = this.container.querySelector('#btn-submit') as HTMLButtonElement;
    submitBtn?.addEventListener('click', () => {
      this.submitLookup();
    });
  }

  private updateDisplay(): void {
    const chip = this.container.querySelector('#display-book-chip') as HTMLElement;
    const chipIcon = this.container.querySelector('#display-chip-icon') as HTMLElement;
    const chipLabel = this.container.querySelector('#display-chip-label') as HTMLElement;
    const digitsText = this.container.querySelector('#digits-text') as HTMLElement;
    const clearDigitsBtn = this.container.querySelector('#btn-clear-digits') as HTMLElement;
    const submitBtn = this.container.querySelector('#btn-submit') as HTMLButtonElement;
    const actionPreviewsEl = this.container.querySelector('#action-previews') as HTMLElement;

    if (!chip || !digitsText || !submitBtn) return;

    // Update active book button styles
    const bookBtns = this.container.querySelectorAll<HTMLButtonElement>('.book-btn');
    bookBtns.forEach((btn) => {
      const prefix = btn.dataset.prefix as BookPrefix;
      if (prefix === this.selectedPrefix) {
        btn.classList.add('is-selected');
      } else {
        btn.classList.remove('is-selected');
      }
    });

    // Update book chip in display bar
    if (this.selectedPrefix) {
      const meta = BOOK_BY_PREFIX[this.selectedPrefix];
      chip.className = `display-book-chip has-book book-theme-${meta.name}`;
      chip.style.setProperty('--chip-color', meta.color);
      chipIcon.innerHTML = renderIconSvg(meta.iconId, 'chip-svg-icon');
      chipLabel.textContent = meta.label;
    } else {
      chip.className = 'display-book-chip no-book';
      chip.style.removeProperty('--chip-color');
      chipIcon.innerHTML = `<span class="icon-all-books" aria-hidden="true">✦</span>`;
      chipLabel.textContent = 'All Books';
    }

    // Update digits
    if (this.enteredDigits) {
      digitsText.textContent = this.enteredDigits;
      digitsText.classList.add('has-value');
      clearDigitsBtn?.classList.add('is-visible');
    } else {
      digitsText.textContent = '---';
      digitsText.classList.remove('has-value');
      clearDigitsBtn?.classList.remove('is-visible');
    }

    // Check validity
    const { valid, entries, exactMatch } = this.checkLookupValidity();

    submitBtn.disabled = !valid;
    if (valid) {
      submitBtn.classList.add('is-ready');
    } else {
      submitBtn.classList.remove('is-ready');
    }

    // Update Action Preview Chips. The slot keeps a fixed height whether empty or full,
    // so the keys below never move while typing quickly.
    if (actionPreviewsEl) {
      if (!this.enteredDigits || entries.length === 0) {
        const hint = this.enteredDigits
          ? `No ${this.selectedPrefix ? BOOK_BY_PREFIX[this.selectedPrefix].label + ' ' : ''}entry ${this.enteredDigits}`
          : 'Enter a location number to see its actions';
        actionPreviewsEl.innerHTML = `<span class="preview-hint">${hint}</span>`;
        actionPreviewsEl.classList.remove('has-previews');
      } else {
        actionPreviewsEl.classList.add('has-previews');

        if (this.selectedPrefix && exactMatch) {
          // Single match with verb preview
          const v = exactMatch.variants[0];
          const verb = v?.primaryVerb ? v.primaryVerb.toUpperCase() : 'ENTRY';
          actionPreviewsEl.innerHTML = `
            <div class="preview-single-action" style="--book-color: ${BOOK_BY_PREFIX[exactMatch.prefix].color};">
              ${renderIconSvg(BOOK_BY_PREFIX[exactMatch.prefix].iconId, 'preview-icon')}
              <span class="preview-book-name">${exactMatch.bookName.toUpperCase()} ${exactMatch.paddedNumber}:</span>
              <span class="preview-verb">${verb}</span>
              ${v?.cost !== null && v?.cost !== undefined && String(v.cost) !== "0" ? `<span class="preview-cost">[Cost: ${v.cost}]</span>` : ''}
            </div>
          `;
        } else {
          // Multiple actions on this number (e.g. 236 has Move, Look, Engage, etc.)
          actionPreviewsEl.innerHTML = `
            <div class="preview-chips-container">
              <div class="preview-chips-scroll">
                ${entries
                  .map((entry) => {
                    const meta = BOOK_BY_PREFIX[entry.prefix];
                    const v = entry.variants[0];
                    const verb = v?.primaryVerb ? v.primaryVerb.toUpperCase() : meta.label.toUpperCase();
                    return `
                      <button
                        type="button"
                        class="preview-chip"
                        data-key="${entry.key}"
                        style="--chip-accent: ${meta.color};"
                        title="${meta.label}: ${verb}"
                      >
                        ${renderIconSvg(meta.iconId, 'preview-chip-icon')}
                        <span class="preview-chip-verb">${verb}</span>
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `;

          // Bind click to preview chips
          actionPreviewsEl.querySelectorAll<HTMLButtonElement>('.preview-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
              const key = btn.dataset.key;
              if (key) {
                const entry = this.controller.getDatabase().getByKey(key);
                if (entry) {
                  this.controller.executeLookup(entry, null);
                }
              }
            });
          });
        }
      }
    }
  }

  private renderRecentLookups(): void {
    const listEl = this.container.querySelector('#recent-lookups-list');
    const wrapperEl = this.container.querySelector('#recent-lookups-wrapper');
    if (!listEl || !wrapperEl) return;

    const recents = this.controller.getState().recentLookups;
    if (recents.length === 0) {
      wrapperEl.classList.remove('is-visible');
      listEl.innerHTML = '';
      return;
    }

    wrapperEl.classList.add('is-visible');
    listEl.innerHTML = recents
      .map((item) => {
        const meta = BOOKS.find((b) => b.name === item.bookName) ?? BOOK_BY_PREFIX['e'];
        return `
          <button
            type="button"
            class="recent-chip"
            data-key="${item.key}"
            data-variant="${item.variantIndex !== undefined ? item.variantIndex : ''}"
            style="--recent-accent: ${meta.color};"
          >
            ${renderIconSvg(meta.iconId, 'recent-chip-icon')}
            <span class="recent-chip-label">${item.label}</span>
          </button>
        `;
      })
      .join('');

    listEl.querySelectorAll<HTMLButtonElement>('.recent-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const vIdxStr = btn.dataset.variant;
        const vIdx = vIdxStr !== '' && vIdxStr !== undefined ? parseInt(vIdxStr, 10) : null;
        if (key) {
          const entry = this.controller.getDatabase().getByKey(key);
          if (entry) {
            this.controller.executeLookup(entry, vIdx);
          }
        }
      });
    });
  }
}
