import { Box, Divider, Heading, Text } from '@metamask/snaps-sdk/jsx';
import { SignTransparentParams } from '../types';
import { hexStringToUint8Array } from '../utils/hexStringToUint8Array';
import { snapConfirm } from '../utils/dialogs';
import { assert, array, object, optional, string } from 'superstruct';
import { signSync, utils } from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { ensureDerivationPath, requestPrivateKey, splitDerivationPath } from '../utils/derivation';

const SIGHASH_ALL = 0x01;

const SignTransparentStruct = object({
  derivationPath: string(),
  sighashes: array(string()),
  details: object({
    toAddress: string(),
    amount: string(),
    network: string()
  }),
  metadata: optional(
    object({
      redeemScript: optional(string())
    })
  )
});

function ensureHmacSupport() {
  if (!utils.hmacSha256Sync) {
    utils.hmacSha256Sync = (key, ...msgs) => {
      const message = concatUint8Arrays(msgs);
      return hmac(sha256, key, message);
    };
  }
}

export async function signTransparent(params: SignTransparentParams, origin: string): Promise<string[]> {
  ensureHmacSupport();
  assert(params, SignTransparentStruct);
  ensureDerivationPath(params.derivationPath);

  const confirmed = await snapConfirm({
    title: 'Подписание прозрачной транзакции',
    prompt: (
      <Box>
        <Heading>Transparent Multisig</Heading>
        <Divider />
        <Text>Origin: {origin}</Text>
        <Text>Recipient: {params.details.toAddress}</Text>
        <Text>Amount: {params.details.amount} ZEC</Text>
        <Text>Network: {params.details.network}</Text>
      </Box>
    )
  });

  if (!confirmed) {
    throw new Error('Пользователь отклонил подпись');
  }

  const derivationPathSegments = splitDerivationPath(params.derivationPath);
  const privateKey = await requestPrivateKey(derivationPathSegments);

  const signatures = params.sighashes.map((hashHex) => {
    if (typeof hashHex !== 'string' || hashHex.length !== 64) {
      throw new Error('Некорректный sighash');
    }
    const digest = hexStringToUint8Array(hashHex);
    const derSignature = signSync(digest, privateKey, { der: true });
    const fullSignature = new Uint8Array(derSignature.length + 1);
    fullSignature.set(derSignature, 0);
    fullSignature[derSignature.length] = SIGHASH_ALL;
    return uint8ArrayToHex(fullSignature);
  });

  return signatures;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 1) {
    return arrays[0];
  }
  const totalLength = arrays.reduce((sum, current) => sum + current.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
}

