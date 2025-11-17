import type { RequestArguments } from "@metamask/providers";

import { useMetaMaskContext } from "../../context/MetamaskContext";

export type Request = (params: RequestArguments) => Promise<unknown | null>;

export const useRequest = () => {
  const { provider, setError } = useMetaMaskContext();

  const request: Request = async ({ method, params }) => {
    try {
      const data =
        (await provider?.request({
          method,
          params
        } as RequestArguments)) ?? null;

      return data;
    } catch (requestError) {
      setError(requestError as Error);

      throw requestError;
    }
  };

  return request;
};


