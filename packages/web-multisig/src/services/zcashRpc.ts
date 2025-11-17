type ZcashNetwork = "mainnet" | "testnet";

export interface RpcConfig {
  url: string;
  apiKey?: string;
  basicAuth?: string;
}

export interface RpcUtxo {
  txid: string;
  vout: number;
  amount: number;
  scriptPubKey?: string;
  confirmations?: number;
  spendable?: boolean;
  solvable?: boolean;
}

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
  id: string | number | null;
}

const DEFAULT_ENDPOINTS: Record<ZcashNetwork, string> = {
  testnet: "https://zcash-testnet.gateway.tatum.io",
  mainnet: "https://api-eu1.tatum.io/v3/blockchain/node/zcash-mainnet"
};

const rpcConfig: Record<ZcashNetwork, RpcConfig> = {
  testnet: {
    url: import.meta.env.VITE_ZCASH_TESTNET_RPC_URL ?? DEFAULT_ENDPOINTS.testnet,
    apiKey:
      import.meta.env.VITE_ZCASH_TESTNET_RPC_KEY ??
      import.meta.env.VITE_ZCASH_RPC_API_KEY ??
      import.meta.env.VITE_TATUM_API_KEY
  },
  mainnet: {
    url: import.meta.env.VITE_ZCASH_MAINNET_RPC_URL ?? DEFAULT_ENDPOINTS.mainnet,
    apiKey:
      import.meta.env.VITE_ZCASH_MAINNET_RPC_KEY ??
      import.meta.env.VITE_ZCASH_RPC_API_KEY ??
      import.meta.env.VITE_TATUM_API_KEY
  }
};

function buildHeaders(config: RpcConfig): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }

  if (config.basicAuth) {
    headers.Authorization = `Basic ${btoa(config.basicAuth)}`;
  }

  return headers;
}

async function rpcCall<T>(
  method: string,
  params: unknown[] = [],
  network: ZcashNetwork
): Promise<T> {
  const config = rpcConfig[network];
  if (!config.url) {
    throw new Error(`RPC URL не настроен для сети ${network}`);
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify({
      id: Date.now(),
      jsonrpc: "2.0",
      method,
      params
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RPC ${method} failed: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error) {
    throw new Error(`${payload.error.code}: ${payload.error.message}`);
  }
  if (payload.result === undefined) {
    throw new Error(`Пустой ответ RPC (${method})`);
  }

  return payload.result;
}

export async function ensureWatchOnly(
  address: string,
  redeemScript: string | undefined,
  network: ZcashNetwork
): Promise<void> {
  if (!redeemScript) {
    await rpcCall("importaddress", [address, "", false], network).catch((error: Error) => {
      if (!error.message.includes("already have this key")) {
        throw error;
      }
    });
    return;
  }

  await rpcCall("importaddress", [redeemScript, "", false, true], network).catch((error: Error) => {
    if (!error.message.includes("already have this script")) {
      throw error;
    }
  });

  await rpcCall("importaddress", [address, "", false], network).catch((error: Error) => {
    if (!error.message.includes("already have this key")) {
      throw error;
    }
  });
}

export async function listTransparentUtxos(
  address: string,
  redeemScript: string | undefined,
  network: ZcashNetwork
): Promise<RpcUtxo[]> {
  await ensureWatchOnly(address, redeemScript, network);
  const utxos = await rpcCall<RpcUtxo[]>(
    "listunspent",
    [0, 9999999, [address], true, { include_watchonly: true }],
    network
  );
  return utxos.filter((utxo) => typeof utxo.amount === "number" && utxo.amount > 0);
}

export async function getTransparentBalance(
  address: string,
  redeemScript: string | undefined,
  network: ZcashNetwork
): Promise<{ balance: number; utxos: RpcUtxo[] }> {
  const utxos = await listTransparentUtxos(address, redeemScript, network);
  const balance = utxos.reduce((sum, utxo) => sum + utxo.amount, 0);
  return { balance, utxos };
}

export async function broadcastRawTransaction(
  rawHex: string,
  network: ZcashNetwork
): Promise<string> {
  return rpcCall<string>("sendrawtransaction", [rawHex], network);
}

export type { ZcashNetwork, RpcUtxo };


