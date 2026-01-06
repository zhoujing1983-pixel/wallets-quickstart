type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
};

const CROSSMINT_SERVER_SIDE_API_KEY = process.env
  .CROSSMINT_SERVER_SIDE_API_KEY as string;
const CROSSMINT_ENV = process.env.CROSSMINT_ENV || "staging";

const getBaseUrl = () =>
  CROSSMINT_ENV === "production"
    ? "https://www.crossmint.com"
    : "https://staging.crossmint.com";

const buildUrl = (path: string, query?: RequestOptions["query"]) => {
  const url = new URL(`${getBaseUrl()}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined) return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
};

const request = async <T>({
  method,
  path,
  body,
  query,
}: RequestOptions): Promise<{ ok: boolean; status: number; data: T }> => {
  if (!CROSSMINT_SERVER_SIDE_API_KEY) {
    throw new Error("CROSSMINT_SERVER_SIDE_API_KEY missing");
  }

  const url = buildUrl(path, query);
  console.log("[finyx-wallet-sdk] request", {
    method,
    url,
    body: body ?? null,
  });

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": CROSSMINT_SERVER_SIDE_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  console.log("[finyx-wallet-sdk] response", {
    status: res.status,
    body: data,
  });
  if (!res.ok) {
    console.error("[finyx-wallet-sdk] error", {
      status: res.status,
      body: data,
    });
  }
  return { ok: res.ok, status: res.status, data };
};

/**
 * Create (or return) a Crossmint wallet.
 *
 * Params:
 * - chainType: Crossmint chain type string (e.g. "solana", "evm").
 * - type: Wallet type string (e.g. "smart").
 * - owner: User locator (e.g. "email:someone@example.com").
 * - config: Optional Crossmint wallet config object (e.g. adminSigner).
 *
 * Returns:
 * - ok: HTTP success flag.
 * - status: HTTP status code.
 * - data: Crossmint response body for the wallet create call.
 */
export const createWallet = async (payload: {
  chainType: string;
  type: string;
  owner: string;
  config?: Record<string, unknown>;
}) =>
  request({
    method: "POST",
    path: "/api/2025-06-09/wallets",
    body: payload,
  });

/**
 * Fetch wallet balances for a wallet locator (address).
 *
 * Params:
 * - walletLocator: Wallet locator string (often the wallet address).
 * - tokens: Comma-separated token symbols (e.g. "USDC").
 *
 * Returns:
 * - ok: HTTP success flag.
 * - status: HTTP status code.
 * - data: Crossmint balances response body.
 */
export const getWalletBalances = async (params: {
  walletLocator: string;
  tokens: string;
}) =>
  request({
    method: "GET",
    path: `/api/2025-06-09/wallets/${params.walletLocator}/balances`,
    query: { tokens: params.tokens },
  });

/**
 * Fetch wallet transfer activity for a wallet locator.
 *
 * Params:
 * - walletLocator: Wallet locator string (often the wallet address).
 * - sort: Sort order ("asc" | "desc").
 * - chain: Chain name (e.g. "solana").
 * - tokens: Comma-separated token symbols (e.g. "USDC").
 * - status: Transfer status filter (e.g. "successful").
 *
 * Returns:
 * - ok: HTTP success flag.
 * - status: HTTP status code.
 * - data: Crossmint transfers response body.
 */
export const getWalletTransfers = async (params: {
  walletLocator: string;
  sort?: string;
  chain?: string;
  tokens?: string;
  status?: string;
}) =>
  request({
    method: "GET",
    path: `/api/unstable/wallets/${params.walletLocator}/transfers`,
    query: {
      sort: params.sort,
      chain: params.chain,
      tokens: params.tokens,
      status: params.status,
    },
  });
