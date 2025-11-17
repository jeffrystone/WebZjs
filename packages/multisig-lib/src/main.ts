import {
  createZip48MultisigWallet,
  Zip48MultisigWallet,
  Zip48WalletCreationOptions
} from "./wallet/zip48";

export interface WalletAndFaucetResult {
  wallet: Zip48MultisigWallet;
  faucet?: Awaited<any>;
}

const DEFAULT_TEST_MNEMONIC =
  "minute amazing design draw proof canal remember angle sugar wood enact squirrel";
const DEFAULT_TEST_MNEMONIC_2 =
  "wonder prevent celery pitch board picture alpha must spirit muffin fox payment";
// const DEFAULT_TEST_MNEMONIC_3 = 
//   "craft next grocery able pitch addict easily inmate social image bubble equip twelve unique heavy tobacco unaware clerk pull mobile hybrid kitten address student";

export interface MultisigCreationOptions extends Omit<Zip48WalletCreationOptions, "mnemonic"> {
  mnemonics?: string[];
  threshold?: number;
}

export async function createWalletAndFundTestnet(
  options: MultisigCreationOptions = {}
): Promise<WalletAndFaucetResult> {
  const defaultMnemonics = [DEFAULT_TEST_MNEMONIC, DEFAULT_TEST_MNEMONIC_2, /*DEFAULT_TEST_MNEMONIC_3*/];
  const mnemonics =
    options.mnemonics && options.mnemonics.length > 0 ? options.mnemonics : defaultMnemonics;
  const threshold = options.threshold ?? Math.min(2, mnemonics.length);

  const wallet = createZip48MultisigWallet({
    ...options,
    mnemonics,
    threshold,
    network: "testnet"
  });

  return { wallet };
}

