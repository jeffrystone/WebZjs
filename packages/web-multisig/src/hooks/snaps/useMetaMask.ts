import { useEffect, useState } from "react";

import { useMetaMaskContext } from "../../context/MetamaskContext";
import { useRequest } from "./useRequest";
import type { GetSnapsResponse } from "../../types";
import { defaultSnapOrigin } from "../../config";

export const useMetaMask = () => {
  const { provider, setInstalledSnap, installedSnap } = useMetaMaskContext();
  const request = useRequest();
  const [isFlask, setIsFlask] = useState(false);

  const snapsDetected = provider !== null;

  const detectFlask = async () => {
    const clientVersion = await request({
      method: "web3_clientVersion"
    });

    const isFlaskDetected = (clientVersion as string[])?.includes("flask");

    setIsFlask(isFlaskDetected);
  };

  const getSnap = async () => {
    const snaps = (await request({
      method: "wallet_getSnaps"
    })) as GetSnapsResponse;

    setInstalledSnap(snaps[defaultSnapOrigin] ?? null);
  };

  useEffect(() => {
    const detect = async () => {
      if (provider) {
        await detectFlask();
        await getSnap();
      }
    };

    detect().catch(console.error);
  }, [provider]);

  return { isFlask, snapsDetected, installedSnap, getSnap };
};


