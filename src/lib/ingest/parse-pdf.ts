import { PDFParse } from "pdf-parse";

export type ParsedDoc = {
  content: string;
  meta?: string;
};

export const parsePdf = async (buffer: Buffer): Promise<ParsedDoc> => {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return { content: result.text ?? "" };
};
