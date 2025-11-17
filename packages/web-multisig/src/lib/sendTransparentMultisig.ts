import { broadcastRawTransaction, getTransparentBalance, ZcashNetwork } from "../services/zcashRpc";
import { buildSignedTransaction } from "./transactions";

export interface SendMultisigOptions {
  address: string;
  redeemScript: string;
  toAddress: string;
  amount: number;
  fee: number;
  signingKeys: string[];
  threshold: number;
  network: ZcashNetwork;
}

export async function sendTransparentMultisig(options: SendMultisigOptions) {
  const { address, redeemScript, network } = options;
  const { utxos, balance } = await getTransparentBalance(address, redeemScript, network);

  if (balance <= 0) {
    throw new Error("Нет доступных средств на выбранном мультисиг-адресе");
  }

  const signed = buildSignedTransaction({
    network,
    utxos,
    amount: options.amount,
    fee: options.fee,
    fromAddress: address,
    toAddress: options.toAddress,
    redeemScript,
    signingKeys: options.signingKeys,
    threshold: options.threshold
  });

  const txId = await broadcastRawTransaction(signed.rawHex, network);

  return {
    txId,
    ...signed
  };
}


