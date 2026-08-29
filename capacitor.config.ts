import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.garrett.cribbage",
  appName: "Cribbage",
  webDir: "dist",
  server: {
    url: "https://cribbage.strongcribbage.com",
  },
};

export default config;
