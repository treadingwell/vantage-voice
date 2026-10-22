# Vantage Voice & Storybook Companion App

A standalone, **100% offline-capable Progressive Web App (PWA)** (with Capacitor support for Android & iOS) for looking up and reading entries from all 8 storybooks of the board game **Vantage** by Stonemaier Games.

Inspired by [vantage.rulepop.com/#story-lookup](https://vantage.rulepop.com/#story-lookup), this app stores the entire **6,262-entry** storybook dataset locally on your device and pairs it with **local Speech-to-Text (STT)** and **local Text-to-Speech (TTS)** for hands-free, spoiler-protected gameplay.

---

## ✨ Key Features

- **Natural Voice Lookups by Action Verb or Storybook**:
  - Say **"Transmit on 236"** or **"Engage 236"** $\rightarrow$ Automatically finds **Engage 236** (`TRANSMIT a signal to your homeworld`).
  - Say **"Stun on 236"**, **"Depart North 43"**, **"Dive on 51"**, or **"Book of Secrets 110"**.
- **Two-Step Spoiler-Protected Voice Flow**:
  1. **Action & Dice Cost Phase**: Displays the action while keeping the outcome **blurred** (`obscured`), and reads aloud: *"Roll 6 dice to transmit a signal to your homeworld."*
  2. **Wait for "Done"**: Automatically listens for you to say **"Done"** (or tap the **✓ DONE** button) after rolling and resolving your dice.
  3. **Outcome & Branching Choices**: Unblurs and reads the outcome aloud. If the result contains branching choices (e.g., *Overpower 236: "Let them live" / "Finish them"*), reads the option titles and waits for you to speak or tap your choice before revealing that specific branch.
- **Local Speech Recognition (Camping / Airplane Mode Ready)**, chosen in **Settings (⚙️)**:
  - **Browser Native STT (`Web Speech API`)**: Zero-download voice recognition using the device's OS recognizer.
  - **Vosk (offline, ~40 MB)**: Constrained to the exact vocabulary of *Vantage* (~1,350 words).
  - **Kroko streaming (offline, ~68 MB)**: Live word-by-word recognition via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx); the most accurate offline option. Kroko ASR community model by Banafo, CC-BY-SA 4.0.
- **Offline Neural Narrators**: Besides the phone's own voice, download **Supertonic 2** (~94 MB, 10 voices) or **Kitten Nano** (~28 MB, 8 voices). Switch narrators from the voice dock pill; adjust speed and the pause between sentences in Settings. Every downloaded model can be deleted again from Settings.
- **Rulepop-Style Keypad & Quick Action Preview**:
  - Full 8-storybook icon selector (`Move`, `Look`, `Engage`, `Help`, `Take`, `Overpower`, `Depart`, `Secret`) and `0–9` numpad.
  - Enter any location number (like `236`) to see instant preview chips of all actions available at that location.
- **🚀 Guided Game Setup Flow (Cards 000 & 001)**:
  - Quick-launch bar on the Lookup Pad for **Card 000 (Setup)** and **Card 001 (Escape Pods)**.
  - Say *"Location 000"*, *"Setup"*, *"Start game"*, *"000"*, or *"Card 001"*.
  - Full 4-step setup instructions from the back of the Book of Vantages, including the complete **21-Mission Skill Dice Lookup Table** and embedded visual card.
  - Smooth 1-tap navigation from Card 000 to Card 001, and direct jump buttons to all 6 starting Escape Pod locations (`002`–`007`).
- **🔁 Enhanced "Repeat" Voice Commands (Pre-Done & Post-Done)**:
  - Say **"Repeat"**, **"Say again"**, or **"One more time"** at any phase:
    - **Pre-Done (Obscured)**: Repeats the dice challenge & action prompt (e.g. *"Roll 6 dice to transmit a signal..."*) and keeps listening for *"Done"*.
    - **Post-Done (Revealed)**: Repeats the revealed outcome text (or branching outcome) and keeps listening hands-free.
  - Explicit voice targeting: Say **"Repeat action"** / **"Repeat prompt"** to hear the dice prompt again, or **"Repeat result"** to hear the revealed outcome.
  - On-screen one-tap **🔁 Repeat Pre-Done Prompt** and **🔁 Repeat Post-Done Result** buttons in the Story View.
- **🪜 Progressive Sequential Results (e.g. Overpower 235 DIG)**:
  - For chained sequential entries, reveals only one step at a time, keeping deeper subsequent results spoiler-protected.
  - Say **"Continue"** or tap the continue button to roll and advance to the next step, or say **"Done"** / **"Stop"** to finish at the current depth.
  - Automatically extracts intermediate dice roll actions for each continue step, reading voice instructions cleanly without repetition.
- **🔊 AudioContext Isolation & Speech RMS Loudness Normalization**:
  - TTS playback runs on an isolated audio context, preventing OS-level microphone capture from ducking playback volume during short option prompts.
  - Speech RMS loudness normalization (-18 dBFS) and peak limiting maintain uniform volume across all prompts and story readings.
- **🎲 Variable 'X' Challenge Dice Markers**:
  - Full support for open dice challenges (`cost: "X"`), read aloud as *"Roll any number of dice; [action]"* with dedicated `#i-cost-x` badges.
- **🎨 High-Contrast Dark Theme & Polished SVG Sprites**:
  - Challenge dice badges feature dark slate backgrounds (`#1e293b`), silver borders (`#cbd5e1`), and crisp white digits (`#ffffff`), eliminating low-contrast yellow-on-white text in Take actions.
  - Key game icons—Dig (silver-white), Repair (cyan), Boost energy cubes (luminous cyan), Reserve (slate/cyan), Secret (gold emblem on lightened base), and dice slots—are brightened for high visibility against the dark space background.
  - Inline story text game terms (health, morale, time, boost, reserve) are styled with authentic theme colors.

---

## 🗺️ Future Roadmap: Destination & Journey Tracking

Planned features for future iterations of the Vantage Companion App:

1. **Automatic Destination Extraction & Breadcrumb Trail**:
   - Parse `"Go to <span class='loc-num'>241</span>"`, `"exit to 649"`, and ocean tide tables (`058`, `056`, `054`) from revealed outcomes to automatically record the crew's chronological path and current location.
2. **Multi-Player Crew Location Tracker**:
   - Track each player's individual crewmember position, region (`A`–`F`), and terrain type (Land, City, Interior, Ocean, Sky, Underground) starting from their escape pods (`002`–`007`) across the planetary grid.
3. **Visited Locations & Action Memory Log**:
   - Keep a persistent digital ledger of visited cards and performed actions (enforcing the 1-action-per-location rule vs. repeatable City/Ocean/Sky locations) and remember persistent structures left on locations.
4. **Fog-of-War Directional Node Graph & Waypoint Notes**:
   - Build a spoiler-free directional connection graph (`N`/`E`/`S`/`W` Depart routes) with player notes (e.g., *"Location 236: Long-range transmitter tower for homeworld signal"*).

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Development Server
```bash
npm run dev
```

### 3. Run Unit Tests & Typecheck
```bash
npm run typecheck
npm test   # 120 tests (vitest + jsdom)
```

### 4. Build Offline Production PWA
```bash
npm run build
npm run preview
```

### 5. Offline Speech Models
Narrators (opt-in downloads in Settings; all run on one CPU thread via sherpa-onnx WASM):

| Narrator | Download | Desktop speed |
|---|---|---|
| Supertonic 2 (int8, 4 steps) | 94 MB | ~4x faster than real time |
| Kitten Nano 0.8 (int8) | 28 MB | ~2x faster than real time |
| Kokoro v1.0 (int8, English voices + US lexicon) | 143 MB | ~1.4x slower than real time |

The sherpa-onnx models (narrators and Kroko recognition) are served from `public/models/`, which is
gitignored. Fetch them before previewing locally; `npm run deploy` does this automatically:
```bash
npm run fetch-models
```

The browser build of sherpa-onnx in `src/vendor/sherpa/` is generated from the pinned npm package.
Regenerate it after upgrading `sherpa-onnx`:
```bash
npm run vendor-sherpa
```

To check how story text will sound before it reaches a narrator (numbers, symbols, punctuation):
```bash
npx vite-node scripts/audit-speech.ts
```

---

## 📱 Installing on Android & iOS (Offline / Camping Mode)

1. Open the hosted app in **Safari (iOS)** or **Chrome (Android)**.
2. Tap **Share $\rightarrow$ Add to Home Screen** (iOS) or **Install App** (Android).
3. Wait a few seconds on first launch for the Service Worker to precache the 6,262 story entries and figure images.
4. *(Optional — For Airplane Mode / Camping)*: Tap the **⚙️ Settings** icon in the bottom voice dock and download an offline recognizer (Vosk or Kroko) and, if you like, a neural narrator (Supertonic or Kitten).
