import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.findback.app",
  appName: "Norfold",
  webDir: "dist",
  // Owner direction 2026-11-07: a release build must still yield real
  // diagnostics. `production` forwards WebView console output to logcat in
  // release, and webContentsDebuggingEnabled lets an authorised developer
  // attach Chrome DevTools over USB to the installed app. Both are local-only
  // surfaces; no transport, endpoint or credential changes.
  loggingBehavior: "production",
  android: {
    webContentsDebuggingEnabled: true,
  },
  server: {
    // Web assets live inside the APK; the app talks only to hosted Supabase (HTTPS).
    androidScheme: "https",
  },
  plugins: {
    ShortLinkResolver: {},
  },
};

export default config;
