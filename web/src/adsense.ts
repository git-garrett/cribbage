export const ADSENSE_PUBLISHER_ID = "ca-pub-1499137290535823";
export const ADSENSE_SCRIPT_ID = "strong-cribbage-adsense";

interface AdSensePageContext {
  hostname: string;
  isNativePlatform: boolean;
  authenticated: boolean;
  splashOpen: boolean;
}

export function shouldLoadAdSense(context: AdSensePageContext): boolean {
  return context.hostname === "cribbage.strongcribbage.com" &&
    !context.isNativePlatform &&
    context.authenticated &&
    !context.splashOpen;
}

export function maybeLoadAdSense(context: AdSensePageContext): void {
  if (!shouldLoadAdSense(context) || document.getElementById(ADSENSE_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = ADSENSE_SCRIPT_ID;
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUBLISHER_ID}`;
  script.crossOrigin = "anonymous";
  document.head.append(script);
}
