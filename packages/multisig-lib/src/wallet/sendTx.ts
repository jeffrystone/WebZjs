import { TatumSDK, Network, ZCash } from "@tatumio/tatum";
import bs58check from "bs58check";
import { createHash } from "crypto";
import { bitgo, networks, ECPair, Transaction } from "@bitgo/utxo-lib";

import {
  deriveP2shFromPublicKeys,
  deriveZip48AccountNode,
  deriveZip48AddressNode,
  mnemonicToMasterNode,
  Zip48Network
} from "./zip48";

const ZATOSHI_PER_ZEC = 100_000_000;
const DEFAULT_FEE = 0.0001;

interface RpcUtxo {
  txid: string;
  vout: number;
  amount: number;
  confirmations: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
  scriptPubKey?: string;
}

interface SignResponse {
  hex: string;
  complete: boolean;
  errors?: unknown[];
}

export interface SendZecOptions {
  mnemonic?: string;
  mnemonics?: string[];
  threshold?: number;
  toAddress: string;
  amount: number;
  fee?: number;
  network?: Zip48Network;
  passphrase?: string;
  account?: number;
  change?: 0 | 1;
  addressIndex?: number;
}

export interface SendZecResult {
  txId: string;
  rawTransaction: string;
  fromAddress: string;
  changeAmount: number;
  totalInput: number;
  feePaid: number;
  inputs: RpcUtxo[];
}

export async function sendZecFromMnemonic(options: SendZecOptions): Promise<any> {
  const {
    mnemonic,
    mnemonics,
    threshold: providedThreshold,
    toAddress,
    amount,
    fee = DEFAULT_FEE,
    network = "testnet",
    passphrase = "",
    account = 0,
    change = 0,
    addressIndex = 0
  } = options;

  const mnemonicList =
    mnemonics && mnemonics.length > 0
      ? mnemonics.map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 0)
      : mnemonic && mnemonic.trim()
        ? [mnemonic.trim()]
        : [];

  if (mnemonicList.length === 0) {
    throw new Error("Необходимо передать мнемонику(и) для отправки средств");
  }

  if (!toAddress || !toAddress.trim()) {
    throw new Error("Нужно указать адрес получателя");
  }

  if (amount <= 0) {
    throw new Error("Сумма перевода должна быть больше нуля");
  }

  const normalizedAmount = roundZec(amount);
  const normalizedFee = roundZec(fee);
  const participantNodes = mnemonicList.map((phrase) => {
    const master = mnemonicToMasterNode(phrase, passphrase);
    const accountNode = deriveZip48AccountNode(master, { network, account }).node;
    const addressNode = deriveZip48AddressNode(accountNode, {
      network,
      account,
      change,
      addressIndex
    }).node;

    if (!addressNode.privateKey) {
      throw new Error("Невозможно получить приватный ключ для указанного пути");
    }

    const publicKey = Buffer.from(addressNode.publicKey);
    const privateKey = Buffer.from(addressNode.privateKey);
    return {
      publicKey,
      privateKey
    };
  });

  const publicKeys = participantNodes.map((participant) => participant.publicKey);
  const threshold = providedThreshold ?? publicKeys.length;

  if (threshold < 1 || threshold > publicKeys.length) {
    throw new Error("Порог подписей должен быть в диапазоне от 1 до количества участников");
  }

  const keyHexToParticipant = new Map(
    participantNodes.map((participant) => [participant.publicKey.toString("hex"), participant])
  );
  console.log('LOL', keyHexToParticipant.entries())

  const sortedKeys = [...publicKeys].sort(Buffer.compare);
  const { address: fromAddress, redeemScript } = deriveP2shFromPublicKeys(
    sortedKeys,
    threshold,
    network
  );

  const signingParticipants: { publicKey: Buffer; privateKey: Buffer }[] = [];
  for (const key of sortedKeys) {
    const participant = keyHexToParticipant.get(key.toString("hex"));
    if (participant) {
      signingParticipants.push(participant);
    }
    if (signingParticipants.length === threshold) {
      break;
    }
  }

  if (signingParticipants.length < threshold) {
    throw new Error("Недостаточно приватных ключей для указанного порога подписей");
  }

  const tatum = await TatumSDK.init<ZCash>({
    network: Network.ZCASH_TESTNET,
    apiKey:
      process.env.TATUM_ZCASH_TESTNET_KEY?.trim() ||
      "t-69192712259e38c1aa9a99a0-100dc99dfdc847269c12f54b"
  });

  const rpc = tatum.rpc as unknown as { rpcCall: (method: string, params?: unknown[]) => Promise<any> };

  try {
    await importWatchOnly(rpc, fromAddress, redeemScript);

    const usedUtxo: RpcUtxo = {
      txid: "4db3698dbb4065a8c14d432263880312597e709f09a17b23b935b0edc8873967",
      vout: 0,
      amount: 0.3,
      confirmations: 80,
      spendable: true,
      solvable: true,
      safe: true,
      scriptPubKey: buildP2shScriptPubKey(redeemScript)
    };
    console.log('BUILD START');
    const totalInputZec = usedUtxo.amount;
    const totalInputSats = Math.round(totalInputZec * ZATOSHI_PER_ZEC);
    const amountSats = Math.round(normalizedAmount * ZATOSHI_PER_ZEC);
    const feeSats = Math.round(normalizedFee * ZATOSHI_PER_ZEC);
    const changeAmount = roundZec(totalInputZec - normalizedAmount - normalizedFee);
    const changeSats = Math.round(changeAmount * ZATOSHI_PER_ZEC);

    if (changeSats < 0) {
      throw new Error("Недостаточно средств для отправки и комиссии");
    }

    console.log('BUILDING');
    const txb = new bitgo.ZcashTransactionBuilder(networks.zcashTest);
    txb.setDefaultsForVersion(networks.zcashTest, bitgo.ZcashTransaction.VERSION4_BRANCH_NU6_1);
    txb.setExpiryHeight(0);
    console.log('ADDING INPUT', usedUtxo.txid, usedUtxo.vout, undefined, undefined, totalInputSats);
    txb.addInput(usedUtxo.txid, usedUtxo.vout, undefined, undefined, totalInputSats);
    console.log('ADDING OUTPUT', toAddress, amountSats);
    txb.addOutput(toAddress, amountSats);
    console.log('ADDING CHANGE', fromAddress, changeSats);
    if (changeSats > 0) {
      txb.addOutput(fromAddress, changeSats);
    }

    for (const participant of signingParticipants) {
      const keyPair = ECPair.fromPrivateKey(participant.privateKey);
      console.log('SIGNING', keyPair.publicKey.toString('hex'));
      txb.sign({
        prevOutScriptType: "p2sh-p2ms",
        vin: 0,
        keyPair,
        redeemScript: Buffer.from(redeemScript, "hex"),
        hashType: Transaction.SIGHASH_ALL
      });
    }

    const signedTx = txb.build();
    const signedHex = signedTx.toBuffer().toString("hex");

    const parsedTx = bitgo.ZcashTransaction.fromBuffer(
      Buffer.from(signedHex, "hex"),
      false,
      "number",
      networks.zcashTest
    );
    // console.log("SIGNED TX (decoded):", {
    //   version: parsedTx.version,
    //   ins: parsedTx.ins.map((input) => ({
    //     hash: Buffer.from(input.hash).reverse().toString("hex"),
    //     index: input.index,
    //     script: input.script.toString("hex"),
    //     sequence: input.sequence
    //   })),
    //   outs: parsedTx.outs.map((output) => ({
    //     value: Number(output.value) / ZATOSHI_PER_ZEC,
    //     script: output.script.toString("hex")
    //   }))
    // });
    // console.log("SIGNED RAW TX", signedHex);

    const txId = await rpc.rpcCall("sendrawtransaction", [signedHex]);

    return {
      txId,
      rawTransaction: signedHex,
      fromAddress,
      changeAmount,
      totalInput: totalInputZec,
      feePaid: normalizedFee,
      inputs: [usedUtxo]
    };
  } finally {
    await tatum.destroy();
  }
}

async function importWatchOnly(
  rpc: { rpcCall: (method: string, params?: unknown[]) => Promise<any> },
  address: string,
  redeemScript: string
): Promise<void> {
  try {
    await rpc.rpcCall("importaddress", [redeemScript, "", false, true]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("is already imported")) {
      throw error;
    }
  }

  try {
    await rpc.rpcCall("importaddress", [address, "", false]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("is already imported")) {
      throw error;
    }
  }
}

function buildP2shScriptPubKey(redeemScriptHex: string): string {
  const redeemScript = Buffer.from(redeemScriptHex, "hex");
  const hash = hash160(redeemScript);
  return Buffer.concat([
    Buffer.from([0xa9, 0x14]), // OP_HASH160, push 20 bytes
    hash,
    Buffer.from([0x87]) // OP_EQUAL
  ]).toString("hex");
}

function hash160(buffer: Buffer): Buffer {
  const sha256 = createHash("sha256").update(buffer).digest();
  return createHash("ripemd160").update(sha256).digest();
}

function roundZec(value: number): number {
  return Math.round(value * ZATOSHI_PER_ZEC) / ZATOSHI_PER_ZEC;
}

