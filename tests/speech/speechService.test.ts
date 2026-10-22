import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SpeechService,
  speechService,
  DEFAULT_VOSK_MODEL_URL,
  VOSK_CACHE_NAME,
} from '../../src/speech/speechService';

describe('SpeechService (Dual-Engine STT + Local TTS)', () => {
  let service: SpeechService;

  beforeEach(() => {
    service = new SpeechService();
  });

  afterEach(() => {
    service.stopSpeaking();
    service.stopListening();
    vi.restoreAllMocks();
  });

  describe('Initialization and State', () => {
    it('exports singleton and class instances', () => {
      expect(speechService).toBeInstanceOf(SpeechService);
      expect(service).toBeInstanceOf(SpeechService);
    });

    it('initializes with default state', () => {
      const state = service.getState();
      expect(state.isListening).toBe(false);
      expect(state.isSpeaking).toBe(false);
      expect(state.engine).toBe('web-speech');
      expect(state.offlineModelReady).toBe(false);
      expect(service.getSpeechRate()).toBe(1.0);
      expect(service.isMuted()).toBe(false);
    });

    it('notifies state change listeners on subscription', () => {
      const stateSpy = vi.fn();
      const unsub = service.onStateChange(stateSpy);
      expect(stateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isListening: false,
          isSpeaking: false,
          engine: 'web-speech',
        })
      );
      unsub();
    });
  });

  describe('TTS Rate and Mute Controls', () => {
    it('clamps speech rate between 0.8 and 1.4', () => {
      service.setSpeechRate(0.5);
      expect(service.getSpeechRate()).toBe(0.8);

      service.setSpeechRate(2.0);
      expect(service.getSpeechRate()).toBe(1.4);

      service.setSpeechRate(1.1);
      expect(service.getSpeechRate()).toBe(1.1);
    });

    it('toggles and sets mute state', () => {
      expect(service.isMuted()).toBe(false);
      service.setMuted(true);
      expect(service.isMuted()).toBe(true);
      service.toggleMuted();
      expect(service.isMuted()).toBe(false);
    });
  });

  describe('Audio Unlock', () => {
    it('executes unlockAudio cleanly without throwing', async () => {
      const result = await service.unlockAudio();
      expect(result).toBe(true);
    });
  });

  describe('Engine Switching and Vocabulary', () => {
    it('switches STT engine mode', async () => {
      expect(service.getEngine()).toBe('web-speech');
      await service.setEngine('offline-wasm');
      expect(service.getEngine()).toBe('offline-wasm');
      await service.setEngine('web-speech');
      expect(service.getEngine()).toBe('web-speech');
    });

    it('sets restricted vocabulary words with [unk] token', () => {
      service.setVocabulary(['transmit', 'craft', 'done', 'look']);
      // Access private or internal method to verify grammar string
      const grammarStr = (service as any).getVoskGrammarString();
      expect(grammarStr).toBeDefined();
      const parsed = JSON.parse(grammarStr);
      expect(parsed).toContain('transmit');
      expect(parsed).toContain('craft');
      expect(parsed).toContain('done');
      expect(parsed).toContain('look');
      expect(parsed).toContain('[unk]');
    });
  });

  describe('Voice Selection', () => {
    it('selects preferred local English voice if present', () => {
      const mockVoices = [
        {
          name: 'French Voice',
          lang: 'fr-FR',
          localService: true,
          default: false,
          voiceURI: 'fr',
        },
        {
          name: 'English Remote',
          lang: 'en-US',
          localService: false,
          default: false,
          voiceURI: 'en-remote',
        },
        {
          name: 'Samantha (Natural)',
          lang: 'en-US',
          localService: true,
          default: false,
          voiceURI: 'samantha',
        },
      ] as SpeechSynthesisVoice[];

      (service as any).availableVoices = mockVoices;
      (service as any).autoSelectPreferredVoice();

      const selected = service.getSelectedVoice();
      expect(selected).not.toBeNull();
      expect(selected?.voiceURI).toBe('samantha');
    });
  });

  describe('Speak Execution', () => {
    it('resolves immediately when muted without calling speechSynthesis', async () => {
      service.setMuted(true);
      const onStart = vi.fn();
      const onEnd = vi.fn();

      await service.speak('Hello world', { onStart, onEnd });
      expect(onStart).toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalled();
      expect(service.isSpeaking()).toBe(false);
    });

    it('resolves immediately when given empty text', async () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();

      await service.speak('   ', { onStart, onEnd });
      expect(onStart).toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalled();
    });
  });

  describe('Transcript Listeners', () => {
    it('notifies transcript listeners and supports unsubscribe', () => {
      const listener = vi.fn();
      const unsub = service.onTranscript(listener);

      (service as any).notifyTranscript('transmit on 236', true, ['transmit on 236', 'transit on 236']);
      expect(listener).toHaveBeenCalledWith('transmit on 236', true, ['transmit on 236', 'transit on 236']);

      unsub();
      (service as any).notifyTranscript('done', true);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Offline Model Caching', () => {
    it('checks if offline model is cached in CacheStorage', async () => {
      const cached = await service.isOfflineModelCached();
      expect(typeof cached).toBe('boolean');
    });

    it('uses correct default Vosk model URL and cache name', () => {
      expect(DEFAULT_VOSK_MODEL_URL).toContain('vosk-model-small-en-us-0.15.tar.gz');
      expect(VOSK_CACHE_NAME).toBe('vantage-vosk-model-cache-v1');
    });
  });
});
