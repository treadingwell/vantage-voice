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
- **Dual-Engine Local Speech Recognition (Camping / Airplane Mode Ready)**:
  - **Browser Native STT (`Web Speech API`)**: Zero-download voice recognition using the device's OS recognizer.
  - **Offline WASM STT (`vosk-browser`)**: One-tap download in **Settings (⚙️)** caches the compact (~40 MB) English speech model in `CacheStorage` (`vantage-vosk-model-cache-v1`) and constrains recognition to the exact vocabulary of *Vantage* (~1,350 words), enabling **100% offline recognition in Airplane Mode** and silent continuous listening while you roll dice.
- **Rulepop-Style Keypad & Quick Action Preview**:
  - Full 8-storybook icon selector (`Move`, `Look`, `Engage`, `Help`, `Take`, `Overpower`, `Depart`, `Secret`) and `0–9` numpad.
  - Enter any location number (like `236`) to see instant preview chips of all actions available at that location.

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
npm test
```

### 4. Build Offline Production PWA
```bash
npm run build
npm run preview
```

---

## 📱 Installing on Android & iOS (Offline / Camping Mode)

1. Open the hosted app in **Safari (iOS)** or **Chrome (Android)**.
2. Tap **Share $\rightarrow$ Add to Home Screen** (iOS) or **Install App** (Android).
3. Wait a few seconds on first launch for the Service Worker to precache the 6,262 story entries and figure images.
4. *(Optional — For Airplane Mode / Camping)*: Tap the **⚙️ Settings** icon in the bottom voice dock and click **Download Offline Voice Pack (~40 MB)** to cache the in-browser WebAssembly speech recognizer locally.
