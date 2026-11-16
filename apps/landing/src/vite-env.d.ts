/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Alamat halaman SSO, mis. https://auth.workingspace.id */
  readonly VITE_AUTH_URL?: string;
  /** Alamat Akasha, mis. https://akasha.workingspace.id */
  readonly VITE_AKASHA_URL?: string;
}
