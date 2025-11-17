export const DEFAULT_ZIP48_PATHS = {
  mainnet: "m/48'/133'/0'/133000'/0/0",
  testnet: "m/48'/1'/0'/133000'/0/0"
} as const;

export type Zip48Network = keyof typeof DEFAULT_ZIP48_PATHS;

