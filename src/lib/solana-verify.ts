import { VersionedTransaction } from "@solana/web3.js";

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const toKeyString = (entry: any) => {
  if (typeof entry === "string") return entry;
  if (typeof entry?.toBase58 === "function") return entry.toBase58();
  if (typeof entry?.toString === "function") return entry.toString();
  if (typeof entry?.pubkey === "string") return entry.pubkey;
  if (typeof entry?.pubkey?.toBase58 === "function") {
    return entry.pubkey.toBase58();
  }
  if (typeof entry?.pubkey?.toString === "function") {
    return entry.pubkey.toString();
  }
  return null;
};

export const verifySolanaMemoSignature = async (params: {
  rpcUrl: string;
  signature: string;
  walletAddress: string;
}) => {
  const { rpcUrl, signature, walletAddress } = params;
  let accountKeys: any[] = [];
  let instructions: any[] = [];
  let innerInstructions: any[] = [];
  let parsedInnerInstructions: any[] = [];
  let parsedInstructions: any[] = [];
  try {
    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          {
            commitment: "confirmed",
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
    });
    const rpcJson = await rpcRes.json();
    const raw =
      rpcJson?.result?.transaction?.[0] &&
      typeof rpcJson.result.transaction[0] === "string"
        ? rpcJson.result.transaction[0]
        : null;
    if (!raw) {
      console.error("[solana-verify] base64 transaction missing", {
        signature,
        rpcError: rpcJson?.error ?? null,
      });
      return false;
    }
    const decoded = VersionedTransaction.deserialize(
      Buffer.from(raw, "base64")
    );
    const decodedMessage: any = decoded.message;
    accountKeys =
      decodedMessage.staticAccountKeys ??
      decodedMessage.getAccountKeys?.().staticAccountKeys ??
      [];
    instructions =
      decodedMessage.compiledInstructions ?? decodedMessage.instructions ?? [];
    innerInstructions = rpcJson?.result?.meta?.innerInstructions ?? [];
    parsedInnerInstructions = innerInstructions.flatMap(
      (entry: any) => entry?.instructions ?? []
    );
    parsedInstructions = rpcJson?.result?.transaction?.message?.instructions ?? [];
  } catch (error) {
    console.error("[solana-verify] rpc decode failed", {
      signature,
      error: String(error),
    });
    return false;
  }

  const accountKeyStrings = accountKeys
    .map(toKeyString)
    .filter((value): value is string => Boolean(value));
  if (!accountKeyStrings.includes(walletAddress)) {
    console.error("[solana-verify] wallet not in account keys", {
      signature,
      walletAddress,
      accountKeyStrings,
    });
    return false;
  }

  console.error("[solana-verify] instruction dump", {
    signature,
    instructions,
    accountKeyStrings,
  });

  const memoProgramIndexes = accountKeyStrings
    .map((key, index) => (key === MEMO_PROGRAM_ID ? index : -1))
    .filter((index) => index >= 0);

  const memoFoundInOuter = instructions.some((ix: any) => {
    if (typeof ix?.programId === "string") {
      return ix.programId === MEMO_PROGRAM_ID;
    }
    if (typeof ix?.programIdIndex === "number") {
      return memoProgramIndexes.includes(ix.programIdIndex);
    }
    return false;
  });

  const memoFoundInParsed = parsedInstructions.some((ix: any) => {
    if (typeof ix?.programId === "string") {
      return ix.programId === MEMO_PROGRAM_ID;
    }
    if (typeof ix?.program === "string") {
      return ix.program === "spl-memo";
    }
    return false;
  });

  const memoFoundInInner = parsedInnerInstructions.some((ix: any) => {
    if (typeof ix?.programId === "string") {
      return ix.programId === MEMO_PROGRAM_ID;
    }
    if (typeof ix?.programIdIndex === "number") {
      return memoProgramIndexes.includes(ix.programIdIndex);
    }
    if (typeof ix?.program === "string") {
      return ix.program === "spl-memo";
    }
    return false;
  });

  const memoFound = memoFoundInOuter || memoFoundInParsed || memoFoundInInner;

  console.error("[solana-verify] inner instructions", {
    signature,
    parsedInnerInstructions,
  });

  if (!memoFound) {
    console.error("[solana-verify] memo not found", {
      signature,
      memoProgramIndexes,
      instructions,
      parsedInstructions,
      parsedInnerInstructions,
      accountKeyStrings,
    });
  }

  return memoFound;
};
