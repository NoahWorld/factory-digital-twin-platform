/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRODUCT_NAME?: string;
  readonly VITE_IOT_API_PREFIX?: string;
  readonly VITE_IOT_HOME_PATH?: string;
  readonly VITE_IOT_LOGIN_PATH?: string;
  readonly VITE_IOT_RESOURCE_ORIGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
