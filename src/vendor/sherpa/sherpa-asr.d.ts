import type { OnlineRecognizer, SherpaModule } from './sherpa';

export function createOnlineRecognizer(
  module: SherpaModule,
  config: Record<string, unknown>
): OnlineRecognizer;
