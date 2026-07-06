/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_KAKAO_APP_KEY: string;
  readonly VITE_NAVER_CLIENT_ID: string;
  readonly VITE_QONVERSION_PROJECT_KEY: string;
  readonly VITE_QONVERSION_ENVIRONMENT: string;
  readonly VITE_QONVERSION_ENTITLEMENT_ID: string;
  readonly VITE_QONVERSION_KIDS_MODE: string;
  readonly VITE_QONVERSION_PROXY_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
