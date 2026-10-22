import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  canPromptInstall,
  detectPlatform,
  initInstallPrompt,
  isRunningInstalled,
  onInstallStateChange,
  promptInstall,
} from '../../src/ui/installPrompt';

function fakeInstallEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('detectPlatform', () => {
  it('recognizes iPhone, iPad (desktop-mode Safari) and Android', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 5)).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('other');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe('other');
  });
});

describe('install prompt', () => {
  beforeAll(() => initInstallPrompt());

  it('holds the browser install event and opens it from our button once', async () => {
    const listener = vi.fn();
    const unsub = onInstallStateChange(listener);
    const event = fakeInstallEvent('accepted');
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(canPromptInstall()).toBe(true);
    expect(listener).toHaveBeenCalled();

    expect(await promptInstall()).toBe(true);
    expect(event.prompt).toHaveBeenCalledOnce();
    // The browser's event can't be reused
    expect(canPromptInstall()).toBe(false);
    expect(await promptInstall()).toBe(false);
    unsub();
  });

  it('reports a dismissed dialog', async () => {
    window.dispatchEvent(fakeInstallEvent('dismissed'));
    expect(await promptInstall()).toBe(false);
  });

  it('counts as installed after the browser reports the install', () => {
    window.dispatchEvent(fakeInstallEvent('accepted'));
    window.dispatchEvent(new Event('appinstalled'));
    expect(canPromptInstall()).toBe(false);
    expect(isRunningInstalled()).toBe(true);
  });
});
