import { CrossmintWallets, createCrossmint } from "@crossmint/wallets-sdk";

const crossmint = createCrossmint({
  apiKey: "sk_staging_9zjqyDu6gM1K3difEFpACDehXvXUYFWi7gqF1pcxdMAQMZFXE9emZJq9VkFN1ev9iRJ9mfpy3JKRadJqA3aWT9ZML8etZcFcghFc7h8FS3f4QzGZEr9zdBavbSaejYzBCtoeA4Y9kaHqCwhBvXR7idbv6ba7ukqkMZPHMMuiM9q8egNP2XyxJBcPyoLsgHHKF2GN69vwYVAwcHfpHyX8CCTY",
});

const crossmintWallets = CrossmintWallets.from(crossmint);

async function main() {
  const wallet = await crossmintWallets.createWallet({
    chain: "solana",
    signer: {
      type: "external-wallet",
      address: "GBcbaSEvQiR5LqKddpjdt2cCsJtjcZcx5913yxZgFxqq",
    },
    owner: "COMPANY",
    alias: "treasury",
  });

  console.log(wallet.address);
}

main().catch((error) => {
  console.error("Failed to create treasury wallet:", error);
  process.exit(1);
});
