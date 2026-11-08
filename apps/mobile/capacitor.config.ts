import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.findback.app",
  appName: "Norfold",
  webDir: "dist",
  // Owner direction 2026-11-08: bridge logging is OFF in every packaged build.
  // `production` mirrored every WebView console line AND every plugin call
  // result/parameter into logcat, which exposed a Google OAuth access token,
  // SQL text and message bodies. Release diagnostics stay available through
  // the explicitly enabled DevTools attach point below and Sentry; they must
  // never be a world-readable log sink.
  loggingBehavior: "none",
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
