import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stonemaier.vantage.companion',
  appName: 'Vantage Companion',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
