import * as xlsx from "xlsx";

export type ParsedDoc = {
  content: string;
  meta?: string;
};

export const parseExcel = (buffer: Buffer): ParsedDoc => {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const lines: string[] = [];
  workbook.SheetNames.forEach((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Array<
      Array<string | number | boolean | null>
    >;
    lines.push(`# Sheet: ${name}`);
    rows.forEach((row) => {
      const cells = row
        .map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      if (cells.length > 0) {
        lines.push(cells.join(" | "));
      }
    });
  });
  return { content: lines.join("\n") };
};
