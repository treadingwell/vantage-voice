# Vantage Voice & Storybook Companion App — Architecture & Implementation Plan

> **For Subagents & Contributors**: This document is the single source of truth for the architecture, dataset schema, voice state machine, and module contracts of the Vantage Companion App in `d:\CODE PROJECTS\vantageapp`. Read this before implementing or modifying modules.

---

## 1. Executive Summary & Architecture Strategy

This application is a **100% Web-First Installable Progressive Web App (PWA)** (with optional Capacitor native packaging) designed for the board game **Vantage** by Stonemaier Games. It works **completely offline (camping / Airplane Mode)** on both Android and iOS.

### Core Pillars
1. **100% Offline Installable PWA**:
   - Uses Vite + TypeScript + `vite-plugin-pwa` (Workbox) and `CacheStorage` / `IndexedDB` to store the entire UI, SVG icons, Book of Secrets images, the complete `stories.json` database (~6,262 entries), and the offline speech model locally on the device.
2. **Local OS Text-to-Speech (`window.speechSynthesis`)**:
   - Uses the phone's built-in system voices offline on both Android and iOS with zero extra bundle size.
   - Includes an automatic **audio-unlock handler** on the first user interaction so hands-free TTS responses work seamlessly on iOS Safari and Android Chrome.
3. **Dual-Engine Local Speech-to-Text (STT)**:
   - **Engine A: In-Browser Offline WASM Engine (`vosk-browser`) — Camping / Airplane Mode Ready**:
     - Runs the lightweight `vosk-model-small-en-us-0.15` (~40 MB, cached locally in `IndexedDB` / `CacheStorage`) directly inside the browser via WebAssembly + Web Audio API.
     - **Grammar-Constrained Recognition**: Because we know every word in *Vantage* (the 8 book names, all ~250 action verbs from `stories.json`, numbers `zero`–`thousand`, directions, choice words, and `"done"`), we pass a **restricted vocabulary grammar** to the recognizer. This makes offline recognition fast, battery-friendly, and immune to mishearing out-of-vocabulary words.
     - **Silent Continuous Listening**: Unlike mobile `webkitSpeechRecognition` (which beeps and times out after 5 seconds of silence while rolling dice), the in-browser WASM engine listens silently for 30+ seconds while players roll and resolve dice until they say **"Done"**.
   - **Engine B: Browser Native Web Speech API (`webkitSpeechRecognition` / `SpeechRecognition`)**:
     - Available as an instant zero-download toggle or fallback before the offline voice model finishes its one-time local cache download.

---

## 2. Dataset & Domain Specification (`public/data/stories.json`)

The dataset is sourced from `https://vantage.rulepop.com/assets/stories-CU1EyUlD.json` and stored locally at `public/data/stories.json`.

### Key Format
- **Total Keys**: **6,262 keys** (`Record<string, StoryVariant | StoryVariant[]>`)
- Each key consists of a **1-letter book prefix** followed by the **unpadded entry number** (1 to 4 digits, e.g., `e236`, `d43`, `s1`, `m1016`):
  - `m` = **Move** (Blue)
  - `l` = **Look** (Purple)
  - `e` = **Engage** (Teal/Green)
  - `h` = **Help** (Orange)
  - `t` = **Take** (Yellow)
  - `o` = **Overpower** (Red)
  - `d` = **Depart** (Dark Blue — directional movement N/E/S/W)
  - `s` = **Book of Secrets** (145 entries, including puzzle solutions and `/figs/bos*.webp` images)

### Entry Object Schema (`StoryRawEntry`)
In `stories.json`, a key maps to either a **single object** OR an **array of objects** (437 keys have multiple options: 422 `d*` Depart keys and 15 `m*` Move keys):

```ts
export type BookPrefix = 'm' | 'l' | 'e' | 'h' | 't' | 'o' | 'd' | 's';

export type BookName =
  | 'move'
  | 'look'
  | 'engage'
  | 'help'
  | 'take'
  | 'overpower'
  | 'depart'
  | 'secret';

export interface StoryRawVariant {
  option?: string;      // Present on multi-option entries, e.g. "N", "E", "SURFACE", "DIVE"
  direction?: string;   // Present on depart entries, e.g. "N", "E", "S", "W", or custom text
  region?: string;      // Present on some look entries, e.g. "A".."F"
  cost?: number;        // Challenge dice cost (1..8)
  action?: string;      // HTML string, e.g. "<span class='engage'>TRANSMIT</span> a signal to your homeworld"
  result?: string;      // HTML string with <p>, <span class='loc-num'>, <span class='card-num'>, and optional <details><summary>Choice</summary><div>...</div></details>
  obscure?: boolean;    // Defaults to true; false on entries like s1 where result is not blurred
}
```

### Example Entries from `stories.json`
- **`e236` (Single Entry)**:
  ```json
  {
    "cost": 6,
    "action": "<span class='engage'>TRANSMIT</span> a signal to your homeworld",
    "result": "<p>The early days of basic training finally prove useful as you apply the fundamentals of radio signals to the tower. You tap into the tower’s system to send a quick burst that your homeworld should recognize if anyone’s listening. Your rescuers will need to triangulate the signal to find you, but this is a good start. Gain destiny <span class='card-num'>1598</span> if you do not already have it. Either way, add 1 signal token to that destiny.</p>"
  }
  ```
- **`o236` (Entry with Branching `<details>` Choices in `result`)**:
  ```json
  {
    "cost": 4,
    "action": "<span class='overpower'>STUN</span> a sentient as it emerges from the tower",
    "result": "<p>A translucent pink sentient blinks into existence from one of the lights on the tower. You catch it off guard, slamming it to the ground. They beg for you to let them live, offering a lesson in magic in exchange. Choose one:</p><details><summary>Let them live</summary><div><p>Gain lesson <span class='card-num'>1424</span>.</p></div></details><details><summary>Finish them</summary><div><p>The allure of the sentient’s life force is too much for you to resist. They blink out of existence, and you lose 1 morale and gain 2 health.</p></div></details>"
  }
  ```
- **`d43` (Multi-Option Array Entry)**:
  ```json
  [
    {
      "option": "E",
      "direction": "E",
      "cost": 5,
      "action": "<span class='move'>ENTER</span> east into a glowing door",
      "result": "<p>You step into an elevator...</p>"
    },
    {
      "option": "N",
      "direction": "N",
      "cost": 2,
      "action": "<span class='move'>EVADE</span> north around the nest...",
      "result": "<p>Your augsuit catches on the nest...</p>"
    }
  ]
  ```

### Reverse Action Verb Index ("Transmit on 236")
Every location/card number (e.g., `236`) has up to 8 keys (`m236`, `l236`, `e236`, `h236`, `t236`, `o236`, `d236`, `s236`).
At startup, `storyDb.ts` parses every entry's `action` HTML to extract the uppercase/span action verb (e.g., `TRANSMIT`, `WADE`, `CRAFT`, `STUDY`, `SCALE`, `STUN`, `HACK`) and builds:
1. **Per-Number Verb Map**: `number -> Array<{ key, prefix, bookName, verb, option, direction, variant }>`
   - For `236`:
     - `"scale"` / `"move"` $\rightarrow$ `m236`
     - `"study"` / `"look"` $\rightarrow$ `l236`
     - `"transmit"` / `"engage"` $\rightarrow$ `e236`
     - `"craft"` / `"help"` $\rightarrow$ `h236`
     - `"hack"` / `"take"` $\rightarrow$ `t236`
     - `"stun"` / `"overpower"` $\rightarrow$ `o236`
     - `"wade"` / `"depart"` / `"north"` $\rightarrow$ `d236`
2. **Global Vocabulary Set**: Set of all unique action verbs, book names, directions, and choice keywords across all 6,262 entries to feed into the Vosk grammar and fuzzy matcher.

---

## 3. Voice Interaction & State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle: App Ready
    Idle --> ListeningCommand: Tap Mic / Wake Command
    ListeningCommand --> Disambiguating: Multi-Option Match (e.g. "Depart 43")
    ListeningCommand --> ActionPhase: Single Entry Match (e.g. "Transmit on 236")
    
    Disambiguating --> ActionPhase: User says/taps Option ("North" / "Dive")
    
    state ActionPhase {
        [*] --> SpeakCostAndAction
        SpeakCostAndAction --> WaitingForDone: TTS reads "Roll 6 dice to transmit a signal to your homeworld."
        WaitingForDone --> RevealResult: User says "Done" / "Ready" OR taps "Done"
    }
    
    RevealResult --> SpeakResult: Unblur result & TTS reads outcome aloud
    SpeakResult --> BranchingChoice: Entry has <details> choices
    SpeakResult --> Idle: No sub-choices
    
    BranchingChoice --> SpeakSubResult: User says/taps choice ("Let them live")
    SpeakSubResult --> Idle: TTS reads chosen outcome
```

### Detailed Walkthrough of the Flow ("Transmit on 236")
1. **Command Phase (`ListeningCommand`)**:
   - User taps the microphone (or uses hands-free mode) and says: *"Transmit on 236"* (also supports *"two thirty six"*, *"two three six"*, *"engage 236"*, *"236 transmit"*).
2. **Disambiguation Phase (`Disambiguating` — Only when needed)**:
   - If the user says *"Depart 43"* and `d43` has both `East (ENTER)` and `North (EVADE)` options (and the user didn't already say *"Depart North 43"* or *"Evade on 43"*), the app displays the radio options and asks: *"Multiple options for Depart 043: East, Enter; or North, Evade. Which one?"*
3. **Action Phase (`ActionPhase` — Spoiler-Protected)**:
   - UI displays **Engage 236**:
     - Shows the **Action Banner**: `[Cost: 6] TRANSMIT a signal to your homeworld`
     - Shows the **Result Box**: **Blurred / Obscured** (`filter: blur(8px)`) with a prominent **"DONE — Reveal & Read Result"** button.
   - **TTS Speaks**: *"Roll 6 dice to transmit a signal to your homeworld."* (If `cost` is `1`: *"Roll 1 die to..."*; if `cost` is undefined/null: reads the action text directly; if `obscure === false` such as `s1`, proceeds straight to reading the entry).
   - **Auto-Listen for "Done" (`WaitingForDone`)**: Immediately after TTS finishes speaking the prompt, the STT engine listens for confirmation keywords (`"done"`, `"ready"`, `"read"`, `"reveal"`, `"continue"`, `"finished"`, `"okay"`, or `"cancel"` / `"back"`).
4. **Result Phase (`SpeakResult`)**:
   - User says **"Done"** (or taps the **Done** button).
   - The main result text unblurs smoothly. (Nested `<details>` sub-choices remain collapsed/spoiler-protected until chosen!)
   - **TTS Speaks**: *"The early days of basic training finally prove useful as you apply the fundamentals of radio signals to the tower... Gain destiny 1598 if you do not already have it. Either way, add 1 signal token to that destiny."*
5. **Branching Choices Phase (`BranchingChoice` — e.g., Overpower 236 "Stun on 236")**:
   - If the result HTML contains `<details><summary>...</summary><div>...</div></details>` blocks:
   - TTS reads the intro paragraph, then announces the choices: *"Option 1: Let them live. Option 2: Finish them. Which do you choose?"*
   - STT listens for the option summary text or option number (*"Let them live"*, *"Finish them"*, *"Option 1"*, *"First one"*), opens only that `<details>` block, unblurs its inner content, and reads that specific outcome aloud.

---

## 4. Natural Language & Speech Processing Specifications

### Spoken Number Normalization (`src/speech/voiceParser.ts`)
Must convert any combination of spoken number words or digits into the canonical integer string (`"1"`..`"9999"`):
- Single digits sequence: `"two three six"` $\rightarrow$ `236`, `"zero four one"` / `"oh four one"` $\rightarrow$ `41`
- Compound numbers: `"two thirty six"` $\rightarrow$ `236`, `"two hundred and thirty six"` $\rightarrow$ `236`, `"fourteen twenty four"` $\rightarrow$ `1424`, `"one thousand five hundred ninety eight"` $\rightarrow$ `1598`
- Homophones for numbers: `"to"` / `"too"` $\rightarrow$ `2`, `"for"` / `"fore"` $\rightarrow$ `4`, `"won"` $\rightarrow$ `1`, `"ate"` $\rightarrow$ `8`, `"oh"` $\rightarrow$ `0`.

### Fuzzy Verb & Book Matching
- Once the entry number (e.g., `236`) is extracted from the transcript, look up all available entries for `236` in `storyDb`.
- Match the remaining words in the transcript against:
  1. Exact or fuzzy match on the **action verb** for that number (e.g., `"transmit"` matches `e236`'s `TRANSMIT`; `"evade"` matches `d43`'s `N` variant `EVADE`).
  2. Exact or fuzzy match on the **book name** (`move`, `look`, `engage`, `help`, `take`, `overpower`, `depart`, `secret` / `book of secrets`).
  3. Cardinal direction (`north`, `south`, `east`, `west`) for `depart` entries.
- Uses Levenshtein distance / normalized similarity so minor STT variations (e.g., `"transmits"`, `"transit"`, `"stunning"`, `"studying"`) still resolve accurately to the right action on that location.

### TTS Natural Speech Formatting (`src/speech/ttsFormatter.ts`)
- **Action Prompt Formatter**:
  - Strips HTML tags (`<span class='engage'>TRANSMIT</span> a signal...` $\rightarrow$ `"transmit a signal..."`).
  - Expands direction codes if present (`N` $\rightarrow$ `"north"`, `E` $\rightarrow$ `"east"`, `S` $\rightarrow$ `"south"`, `W` $\rightarrow$ `"west"`).
  - If `cost > 0`: formats as `"Roll ${cost} ${cost === 1 ? 'die' : 'dice'} to ${actionText}."`
  - If no cost: formats as `"${actionText}."`
- **Result Text Formatter**:
  - Parses the HTML DOM of `result`.
  - Extracts the main body paragraphs (everything outside `<details>`) and cleans up symbols (e.g. `$15` $\rightarrow$ `"15 coins"`, `/` between skills like `move/look/engage (058)` $\rightarrow$ `"move, look, or engage: 058"`).
  - Extracts each `<details>` block into `{ summary: string, bodyHtml: string, bodySpeech: string }[]` so main text and branching choices are handled cleanly.

---

## 5. Project Directory Structure & Module Contracts

```text
d:\CODE PROJECTS\vantageapp\
├── PLAN.md                     # This architecture & implementation specification
├── README.md                   # User & developer guide
├── index.html                  # App shell + inline SVG sprite sheet from Rulepop
├── package.json                # Vite + TypeScript + vite-plugin-pwa + vosk-browser + Capacitor
├── tsconfig.json               # TypeScript configuration
├── vite.config.ts              # Vite + vite-plugin-pwa configuration for 100% offline caching
├── capacitor.config.ts         # Capacitor configuration for optional Android/iOS native builds
├── public/
│   ├── manifest.webmanifest    # Installable PWA manifest
│   ├── icons/                  # App icons & UI assets
│   ├── data/
│   │   └── stories.json        # Local 6,262-entry storybook database
│   └── figs/                   # Local Book of Secrets solution images (bos*.webp)
└── src/
    ├── main.ts                 # App initialization & UI binding
    ├── styles/
    │   └── main.css            # Rulepop-inspired styling, book color themes, spoiler blur, voice dock
    ├── data/
    │   ├── types.ts            # Shared TypeScript interfaces
    │   └── storyDb.ts          # Loads stories.json, builds Reverse Action Verb Index & vocabulary
    ├── speech/
    │   ├── ttsFormatter.ts     # Converts HTML entries into natural spoken prompts & choice lists
    │   ├── voiceParser.ts      # Parses spoken numbers, "transmit on 236", "done", and choices
    │   └── speechService.ts    # Unified TTS + Dual-Engine STT (Vosk Offline WASM + Web Speech API)
    └── ui/
        ├── svgIcons.ts         # Helper for rendering Rulepop SVG icons (#i-move, #i-cost-6, etc.)
        ├── lookupPad.ts        # 8-book selector + 0-9 numpad controller + text search bar
        ├── storyView.ts        # Spoiler-protected entry viewer, "Done" trigger & branching choices
        └── voiceController.ts  # State machine coordinating STT -> Lookup -> TTS -> "Done" -> TTS
```

---

## 6. Parallel Work Breakdown for Subagents

1. **Workstream 1: Project Scaffolding & Local Assets (`package.json`, `vite.config.ts`, `public/data/stories.json`, `public/figs/*`, `index.html`)**
   - Initialize Vite + TypeScript project, download `stories.json`, extract SVG symbols (`#i-move`, `#key-move`, `#i-cost-1`..`8`, etc.) and Book of Secrets `bos*.webp` figures from `vantage.rulepop.com` so the app has 100% local assets.
2. **Workstream 2: Data Layer, Reverse Action Index & NLP Parser (`src/data/*`, `src/speech/ttsFormatter.ts`, `src/speech/voiceParser.ts`)**
   - Implement `types.ts`, `storyDb.ts`, `ttsFormatter.ts`, and `voiceParser.ts` with comprehensive unit tests covering `"transmit on 236"`, spoken number variations, multi-option entries (`d43`, `m51`), and branching `<details>` choices (`o236`).
3. **Workstream 3: Speech Service (`src/speech/speechService.ts`)**
   - Implement local TTS (`window.speechSynthesis` with iOS/Android audio unlock, voice selection, rate control) and Dual-Engine STT:
     - Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)
     - Offline WASM Engine (`vosk-browser` loading `vosk-model-small-en-us-0.15.tar.gz` with local caching, download progress UI, and Vantage grammar constraint).
4. **Workstream 4: UI Components & Voice State Machine (`src/ui/*`, `src/styles/main.css`, `src/main.ts`)**
   - Build the Rulepop-inspired Storybook Lookup grid, Numpad, Voice Control Dock, Offline Model Manager modal, and Spoiler-Protected Story Viewer wired to the complete voice interaction loop.
5. **Workstream 5: Verification, Build & Git Commits**
   - Run TypeScript typechecking, unit tests, production PWA bundle build (`npm run build`), verify Service Worker precaching, and commit cleanly to git.
