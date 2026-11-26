/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  /** reCAPTCHA Enterprise site key for App Check on the hosted site. */
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;
  /** App Check debug token for localhost. Register it in the Firebase console. */
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
}
