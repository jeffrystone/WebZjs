import "../shims/nodeGlobals";
import { Buffer } from "buffer";
import { bitgo, networks, ECPair, Transaction, script as bscript } from "@bitgo/utxo-lib";
import type { RpcUtxo, ZcashNetwork } from "../services/zcashRpc";

const ZATOSHI_PER_ZEC = 100_000_000;

const NETWORKS_MAP: Record<ZcashNetwork, typeof networks.zcash> = {
  mainnet: networks.zcash,
  testnet: networks.zcashTest
};

interface BaseTransactionOptions {
  network: ZcashNetwork;
  utxos: RpcUtxo[];
  amount: number;
  fee: number;
  fromAddress: string;
  toAddress: string;
  redeemScript: string;
}

export interface BuildUnsignedTransactionOptions extends BaseTransactionOptions {}

export interface BuildTransactionOptions extends BaseTransactionOptions {
  signingKeys: string[];
  threshold: number;
}

export interface SignedTransactionPayload {
  rawHex: string;
  totalInput: number;
  change: number;
  feeUsed: number;
  inputs: RpcUtxo[];
}

export interface UnsignedTransactionPayload {
  txHex: string;
  totalInput: number;
  change: number;
  amount: number;
  fee: number;
  inputs: RpcUtxo[];
  network: ZcashNetwork;
  redeemScript: string;
  fromAddress: string;
  toAddress: string;
}

export function buildSignedTransaction({
  network,
  utxos,
  amount,
  fee,
  fromAddress,
  toAddress,
  redeemScript,
  signingKeys,
  threshold
}: BuildTransactionOptions): SignedTransactionPayload {
  if (amount <= 0) {
    throw new Error("Сумма перевода должна быть больше нуля");
  }
  if (fee < 0) {
    throw new Error("Комиссия не может быть отрицательной");
  }
  if (!redeemScript || redeemScript.length === 0) {
    throw new Error("Redeem script обязателен для P2SH multisig");
  }

  const signers = signingKeys
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => toKeyPair(key, NETWORKS_MAP[network]));

  if (signers.length < threshold) {
    throw new Error(`Для подписи необходимо минимум ${threshold} ключей`);
  }

  const prepared = prepareTransactionBuilder({
    network,
    utxos,
    amount,
    fee,
    fromAddress,
    toAddress,
    redeemScript
  });

  const redeemBuffer = Buffer.from(redeemScript, "hex");

  signers.forEach((keyPair) => {
    prepared.selected.forEach((_, vin) => {
      prepared.builder.sign({
        prevOutScriptType: "p2sh-p2ms",
        vin,
        keyPair,
        redeemScript: redeemBuffer,
        hashType: Transaction.SIGHASH_ALL
      });
    });
  });

  const signed = prepared.builder.build();
  const rawHex = signed.toBuffer().toString("hex");

  return {
    rawHex,
    totalInput: prepared.totalInput,
    change: prepared.change,
    feeUsed: fee,
    inputs: prepared.selected
  };
}

export function buildUnsignedTransaction(
  options: BuildUnsignedTransactionOptions
): UnsignedTransactionPayload {
  const prepared = prepareTransactionBuilder(options);
  const incomplete = prepared.builder.buildIncomplete();
  return {
    txHex: incomplete.toBuffer().toString("hex"),
    totalInput: prepared.totalInput,
    change: prepared.change,
    amount: options.amount,
    fee: options.fee,
    inputs: prepared.selected,
    network: options.network,
    redeemScript: options.redeemScript,
    fromAddress: options.fromAddress,
    toAddress: options.toAddress
  };
}

export function computeInputSighashes(
  txHex: string,
  redeemScript: string,
  network: ZcashNetwork
): string[] {
  const tx = bitgo.ZcashTransaction.fromBuffer(
    Buffer.from(txHex, "hex"),
    false,
    "number",
    NETWORKS_MAP[network]
  );
  const redeemBuffer = Buffer.from(redeemScript, "hex");
  return tx.ins.map((_, vin) =>
    tx.hashForSignature(vin, redeemBuffer, Transaction.SIGHASH_ALL).toString("hex")
  );
}

export function finalizeTransactionWithSignatures({
  txHex,
  redeemScript,
  network,
  orderedSignatureSets
}: {
  txHex: string;
  redeemScript: string;
  network: ZcashNetwork;
  orderedSignatureSets: string[][];
}): string {
  const tx = bitgo.ZcashTransaction.fromBuffer(
    Buffer.from(txHex, "hex"),
    false,
    "number",
    NETWORKS_MAP[network]
  );
  const redeemBuffer = Buffer.from(redeemScript, "hex");

  tx.ins.forEach((_, vin) => {
    const inputSignatures = orderedSignatureSets.map((set) => set[vin]).filter(Boolean);
    if (!inputSignatures.length) {
      throw new Error(`Нет подписей для входа ${vin}`);
    }
    const chunks = [Buffer.alloc(0), ...inputSignatures.map((sig) => Buffer.from(sig, "hex")), redeemBuffer];
    const scriptSig = bscript.compile(chunks);
    tx.setInputScript(vin, scriptSig);
  });

  return tx.toBuffer().toString("hex");
}

function pickUtxos(utxos: RpcUtxo[], target: number): RpcUtxo[] {
  const sorted = [...utxos].sort(
    (a, b) => (b.confirmations ?? 0) - (a.confirmations ?? 0) || b.amount - a.amount
  );
  const picked: RpcUtxo[] = [];
  let sum = 0;
  for (const utxo of sorted) {
    picked.push(utxo);
    sum += utxo.amount;
    if (sum >= target) {
      break;
    }
  }
  return picked;
}

function prepareTransactionBuilder(options: BaseTransactionOptions) {
  const { network, utxos, amount, fee, fromAddress, toAddress, redeemScript } = options;
  const targetAmount = amount + fee;
  const selected: RpcUtxo[] = pickUtxos(utxos, targetAmount);
  const totalInput = selected.reduce((sum, utxo) => sum + utxo.amount, 0);
  console.log('CHECK', totalInput)
  if (totalInput < targetAmount) {
    throw new Error("Недостаточно средств на мультисиг-адресе");
  }

  const amountSats = Math.round(amount * ZATOSHI_PER_ZEC);
  const change = totalInput - amount - fee;
  const changeSats = Math.max(0, Math.round(change * ZATOSHI_PER_ZEC));

  const builder = new bitgo.ZcashTransactionBuilder(NETWORKS_MAP[network]);
  builder.setDefaultsForVersion(
    NETWORKS_MAP[network],
    bitgo.ZcashTransaction.VERSION4_BRANCH_NU6_1
  );
  builder.setExpiryHeight(0);

  selected.forEach((utxo) => {
    const satoshis = Math.round(utxo.amount * ZATOSHI_PER_ZEC);
    builder.addInput(utxo.txid, utxo.vout, undefined, undefined, satoshis);
  });

  builder.addOutput(toAddress, amountSats);
  if (changeSats > 0) {
    builder.addOutput(fromAddress, changeSats);
  }

  return {
    builder,
    selected,
    totalInput,
    change
  };
}

function toKeyPair(key: string, network: typeof networks.zcash): ReturnType<typeof ECPair.fromWIF> {
  if (/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(key)) {
    return ECPair.fromWIF(key, network);
  }

  const normalized = key.replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return ECPair.fromPrivateKey(Buffer.from(normalized, "hex"), { network });
  }

  throw new Error("Некорректный формат приватного ключа. Используйте WIF или 32-байтовый HEX.");
}


