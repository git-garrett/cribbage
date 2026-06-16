declare const __APP_VERSION__: string;

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.bin?url" {
  const url: string;
  export default url;
}
