declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.bin?url" {
  const url: string;
  export default url;
}

declare module "*.json?url" {
  const url: string;
  export default url;
}
