import BIP32Factory, { BIP32Interface } from "bip32";
import * as bip39 from "bip39";
import bs58check from "bs58check";
import { createHash } from "crypto";
import * as ecc from "tiny-secp256k1";

const bip32 = BIP32Factory(ecc);

export type Zip48Network = "mainnet" | "testnet";

export interface GenerateMnemonicOptions {
  strength?: 128 | 160 | 192 | 224 | 256;
  wordlist?: string[];
}

export interface Zip48DerivationParams {
  network: Zip48Network;
  account?: number;
  change?: 0 | 1;
  addressIndex?: number;
}

export interface DerivedZip48Key {
  path: string;
  node: BIP32Interface;
  xpub: string;
  xprv?: string;
}

export interface Zip48WalletCreationOptions extends GenerateMnemonicOptions {
  network?: Zip48Network;
  account?: number;
  change?: 0 | 1;
  addressIndex?: number;
  passphrase?: string;
  mnemonic?: string;
}

export interface Zip48Wallet {
  mnemonic: string;
  accountXpub: string;
  accountXprv?: string;
  receivingAddress: string;
  derivationPath: string;
  redeemScript: string;
}

export interface Zip48MultisigParticipant {
  mnemonic: string;
  accountXpub: string;
  accountXprv?: string;
  derivationPath: string;
  publicKey: string;
}

export interface CreateZip48MultisigOptions extends Omit<Zip48WalletCreationOptions, "mnemonic"> {
  mnemonics: string[];
  threshold: number;
}

export interface Zip48MultisigWallet {
  network: Zip48Network;
  threshold: number;
  address: string;
  redeemScript: string;
  participants: Zip48MultisigParticipant[];
}

export const ZIP48_SCRIPT_TYPE = 133000;

const SLIP44_COIN_TYPES: Record<Zip48Network, number> = {
  mainnet: 133,
  testnet: 1
};

const TRANSPARENT_VERSIONS = {
  mainnet: {
    p2pkh: 0x1cb8,
    p2sh: 0x1cbd
  },
  testnet: {
    p2pkh: 0x1d25,
    p2sh: 0x1cba
  }
} as const;

export function generateMnemonic(options: GenerateMnemonicOptions = {}): string {
  const { strength = 256, wordlist } = options;
  return bip39.generateMnemonic(strength, undefined, wordlist);
}

export function mnemonicToMasterNode(mnemonic: string, passphrase = ""): BIP32Interface {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error("Некорректная мнемоника BIP-39");
  }

  const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
  return bip32.fromSeed(seed);
}

export function deriveZip48AccountNode(
  masterNode: BIP32Interface,
  params: Zip48DerivationParams
): DerivedZip48Key {
  const { network, account = 0 } = params;
  validateAccount(account);
  const coinType = SLIP44_COIN_TYPES[network];
  const path = `m/48'/${coinType}'/${account}'/${ZIP48_SCRIPT_TYPE}'`;
  const node = masterNode.derivePath(path);

  return buildDerivedKey(path, node);
}

export function deriveZip48AddressNode(
  sourceNode: BIP32Interface,
  params: Zip48DerivationParams
): DerivedZip48Key {
  const accountNode = ensureAccountNode(sourceNode, params);
  const { change = 0, addressIndex = 0 } = params;

  validateChange(change);
  validateAddressIndex(addressIndex);

  const pathBase = buildZip48Path(params, false);
  const path = `${pathBase}/${change}/${addressIndex}`;
  const node = accountNode.derive(change).derive(addressIndex);

  return buildDerivedKey(path, node);
}

export function createZip48MultisigWallet(
  options: CreateZip48MultisigOptions
): Zip48MultisigWallet {
  const {
    mnemonics,
    threshold,
    network = "testnet",
    account = 0,
    change = 0,
    addressIndex = 0,
    passphrase = "",
    strength,
    wordlist
  } = options;

  if (!mnemonics || mnemonics.length === 0) {
    throw new Error("Необходимо передать хотя бы одну мнемонику для мультисиг-кошелька");
  }

  if (threshold < 1 || threshold > mnemonics.length) {
    throw new Error("Порог подписей должен быть в диапазоне от 1 до количества участников");
  }

  const participants: Zip48MultisigParticipant[] = mnemonics.map((rawMnemonic) => {
    const mnemonic =
      rawMnemonic?.trim().length > 0 ? rawMnemonic.trim() : generateMnemonic({ strength, wordlist });
    const master = mnemonicToMasterNode(mnemonic, passphrase);
    const accountNode = deriveZip48AccountNode(master, { network, account });
    const addressNode = deriveZip48AddressNode(accountNode.node, {
      network,
      account,
      change,
      addressIndex
    });

    return {
      mnemonic,
      accountXpub: accountNode.xpub,
      accountXprv: accountNode.xprv,
      derivationPath: addressNode.path,
      publicKey: Buffer.from(addressNode.node.publicKey).toString("hex")
    };
  });

  const publicKeys = participants.map((participant) => Buffer.from(participant.publicKey, "hex"));
  console.log('CREATING', publicKeys, threshold, network)
  const { address, redeemScript } = deriveP2shFromPublicKeys(publicKeys, threshold, network);

  return {
    network,
    threshold,
    address,
    redeemScript,
    participants
  };
}

export function buildZip48Path(params: Zip48DerivationParams, includeLeaf = true): string {
  const { network, account = 0, change = 0, addressIndex = 0 } = params;
  validateAccount(account);
  const coinType = SLIP44_COIN_TYPES[network];
  const basePath = `m/48'/${coinType}'/${account}'/${ZIP48_SCRIPT_TYPE}'`;

  if (!includeLeaf) {
    return basePath;
  }

  validateChange(change);
  validateAddressIndex(addressIndex);

  return `${basePath}/${change}/${addressIndex}`;
}

function buildDerivedKey(path: string, node: BIP32Interface): DerivedZip48Key {
  const xpub = node.neutered().toBase58();
  const xprv = node.isNeutered() ? undefined : node.toBase58();
  return { path, node, xpub, xprv };
}

function ensureAccountNode(
  sourceNode: BIP32Interface,
  params: Zip48DerivationParams
): BIP32Interface {
  if (sourceNode.depth === 0) {
    return deriveZip48AccountNode(sourceNode, params).node;
  }

  if (sourceNode.depth === 4) {
    return sourceNode;
  }

  throw new Error(
    "Для deriveZip48AddressNode передайте мастер-узел или уже полученный ZIP-48 аккаунт-узел (depth = 4)"
  );
}

function validateAccount(account: number): void {
  if (!Number.isInteger(account) || account < 0) {
    throw new Error("Номер аккаунта должен быть целым неотрицательным числом");
  }
}

function validateChange(change: number): void {
  if (change !== 0 && change !== 1) {
    throw new Error("Поле change может принимать только значения 0 (external) или 1 (internal)");
  }
}

function validateAddressIndex(addressIndex: number): void {
  if (!Number.isInteger(addressIndex) || addressIndex < 0) {
    throw new Error("Индекс адреса должен быть целым неотрицательным числом");
  }
}

export function deriveP2shFromPublicKeys(
  publicKeys: Buffer[],
  threshold: number,
  network: Zip48Network
): { address: string; redeemScript: string } {
  if (threshold < 1 || threshold > publicKeys.length || threshold > 16) {
    throw new Error("Недопустимый порог подписи для P2SH");
  }

  const sortedKeys = [...publicKeys].sort(Buffer.compare);
  const redeemScript = buildSortedMultiRedeemScript(sortedKeys, threshold);
  const scriptHash = hash160(redeemScript);
  const version = TRANSPARENT_VERSIONS[network].p2sh;
  const address = encodeTransparentAddress(scriptHash, version);

  return {
    address,
    redeemScript: redeemScript.toString("hex")
  };
}

function buildSortedMultiRedeemScript(publicKeys: Buffer[], threshold: number): Buffer {
  const opThreshold = encodeOpNumber(threshold);
  const opPubCount = encodeOpNumber(publicKeys.length);
  const chunks: Buffer[] = [Buffer.from([opThreshold])];

  for (const key of publicKeys) {
    if (key.length !== 33) {
      throw new Error("Публичный ключ должен быть в сжатом формате (33 байта)");
    }
    chunks.push(Buffer.from([key.length]), key);
  }

  chunks.push(Buffer.from([opPubCount]), Buffer.from([0xae])); // OP_CHECKMULTISIG
  return Buffer.concat(chunks);
}

function encodeOpNumber(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 16) {
    throw new Error("OP_N поддерживает значения в диапазоне 0..16");
  }

  if (value === 0) {
    return 0x00;
  }

  return 0x50 + value;
}

function hash160(buffer: Buffer): Buffer {
  const sha256 = createHash("sha256").update(buffer).digest();
  return createHash("ripemd160").update(sha256).digest();
}

function encodeTransparentAddress(hash: Buffer, version: number): string {
  const payload = Buffer.allocUnsafe(2 + hash.length);
  payload.writeUInt16BE(version, 0);
  hash.copy(payload, 2);
  return bs58check.encode(payload);
}

