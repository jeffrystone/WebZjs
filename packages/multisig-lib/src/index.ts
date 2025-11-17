import { createWalletAndFundTestnet } from "./main";
import { sendZecFromMnemonic } from "./wallet/sendTx";

async function main(): Promise<void> {
  const walletResult = await createWalletAndFundTestnet({
    threshold: 2
  });
  console.log("Созданный мультисиг и результат faucet:", walletResult);

  const txResult = await sendZecFromMnemonic({
    mnemonics: walletResult.wallet.participants.map((participant) => participant.mnemonic),
    threshold: walletResult.wallet.threshold,
    toAddress: walletResult.wallet.address,
    amount: 0.02
  });

  console.log("Результат отправки:", txResult);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export * from "./wallet/zip48";
export { createWalletAndFundTestnet } from "./main";
export { sendZecFromMnemonic } from "./wallet/sendTx";