import type { Json } from '@metamask/snaps-sdk';

export type SetBirthdayBlockParams = { latestBlock: number };

export type SignPcztParams = {
  pcztHexTring: string;
  signDetails: {
    recipient: string;
    amount: string;
  };
};

export type SignTransparentParams = {
  derivationPath: string;
  sighashes: string[];
  details: {
    toAddress: string;
    amount: string;
    network: string;
  };
  metadata?: {
    redeemScript?: string;
  };
};

export type TransparentPublicKeyParams = {
  derivationPath: string;
};

export interface SnapState extends Record<string, Json> {
  webWalletSyncStartBlock: string;
}
