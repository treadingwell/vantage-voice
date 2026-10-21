import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stonemaier.vantage.voice',
  appName: 'Vantage Voice',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
