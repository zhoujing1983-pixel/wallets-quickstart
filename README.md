<div align="center">
<img width="180" alt="Finyx logo" src="./public/finyx.svg" />
<br />
<br />
<h1>Finyx Wallet Studio</h1>
<p>A Finyx-themed quickstart powered by Crossmint's wallet stack.</p>

<div align="center">
<a href="https://wallets.demos-crossmint.com/">Live demo</a> |
<a href="https://docs.crossmint.com/introduction/platform/wallets">Crossmint docs</a> |
<a href="https://www.crossmint.com/quickstarts">See all quickstarts</a>
</div>

<br />
<br />
</div>

## Introduction
Finyx Wallet Studio lets you brand a wallet flow with the Finyx voice while running on Crossmint Auth under the hood. The experience still uses the Crossmint SDKs so your email can act as the wallet signer.

**Learn how to:**
- Create a wallet rebranded as Finyx Wallet Studio
- View the USDXM balance (a Crossmint test stablecoin) and native tokens
- Track wallet activity in a modern feed
- Send USDXM or other tokens to any address

## Deploy
Deploy the Finyx Wallet Studio template to Vercel, ensuring you expose the required env variables to keep the Crossmint-powered backend keyed in.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCrossmint%2Fwallets-quickstart&env=NEXT_PUBLIC_FINYX_API_KEY)

## Setup
1. Clone the repository and enter the project directory:
   ```bash
   git clone https://github.com/crossmint/wallets-quickstart.git && cd wallets-quickstart
   ```
2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   # or
   pnpm install
   # or
   bun install
   ```
3. Prepare your environment file:
   ```bash
   cp .env.template .env
   ```
4. Request a Crossmint client API key (Finyx currently sits on top of Crossmint) and paste it into `.env`. The key needs the scopes `users.create`, `users.read`, `wallets.read`, `wallets.create`, `wallets:transactions.create`, `wallets:transactions.sign`, `wallets:balance.read`, and `wallets.fund`.
   ```bash
   NEXT_PUBLIC_FINYX_API_KEY=your_api_key

   # Check all supported chains: https://docs.crossmint.com/introduction/supported-chains
   NEXT_PUBLIC_CHAIN=your_chain
   ```
5. Run the dev server:
   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   # or
   bun dev
   ```

## Using in production
1. Create a [production Crossmint API key](https://docs.crossmint.com/introduction/platform/api-keys/client-side) and swap it into `NEXT_PUBLIC_FINYX_API_KEY` before you deploy.
