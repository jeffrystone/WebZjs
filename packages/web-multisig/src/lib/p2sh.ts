import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import bs58check from "bs58check";
import { Buffer } from "buffer";

const P2SH_TESTNET_PREFIX = 0x1cba;

const textEncoder = new TextEncoder();

function encodeOpNumber(value: number): number {
  if (value === 0) return 0x00;
  return 0x50 + value;
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, current) => sum + current.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function hexToBytes(value: string): Uint8Array | undefined {
  const normalized = value.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    return undefined;
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

function toPublicKeyBytes(input: string): Uint8Array {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return new Uint8Array();
  }
  return hexToBytes(trimmed) ?? textEncoder.encode(trimmed);
}

export function generateP2shMultisigAddress(
  keys: string[],
  threshold: number,
  prefix: number = P2SH_TESTNET_PREFIX
): { address: string; redeemScript: string } | undefined {
  const publicKeys = keys
    .map(toPublicKeyBytes)
    .filter((bytes) => bytes.length > 0)
    .map((bytes) => Buffer.from(bytes));

  if (publicKeys.length === 0 || threshold < 1 || threshold > publicKeys.length) {
    return undefined;
  }

  const sorted = publicKeys.map((key) => Buffer.from(key)).sort(Buffer.compare);
  const chunks: Uint8Array[] = [Uint8Array.from([encodeOpNumber(threshold)])];

  sorted.forEach((key) => {
    chunks.push(Uint8Array.from([key.length]));
    chunks.push(new Uint8Array(key));
  });

  chunks.push(Uint8Array.from([encodeOpNumber(sorted.length)]));
  chunks.push(Uint8Array.from([0xae])); // OP_CHECKMULTISIG

  const redeemScript = concatBytes(chunks);
  const scriptHash = hash160(redeemScript);

  const payload = Buffer.allocUnsafe(2 + scriptHash.length);
  payload.writeUInt16BE(prefix, 0);
  Buffer.from(scriptHash).copy(payload, 2);

  return {
    address: bs58check.encode(payload),
    redeemScript: Buffer.from(redeemScript).toString("hex")
  };
}

