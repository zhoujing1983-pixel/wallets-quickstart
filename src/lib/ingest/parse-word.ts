import mammoth from "mammoth";

export type ParsedDoc = {
  content: string;
  meta?: string;
};

export const parseWord = async (buffer: Buffer): Promise<ParsedDoc> => {
  const result = await mammoth.extractRawText({ buffer });
  return { content: result.value ?? "" };
};
