import { NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { callPageIndexTool } from "@/agent/tools/pageindex-mcp";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

const isPdfBuffer = (buffer: Buffer) =>
  buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from("%PDF"));

const parseToolPayload = (output: unknown) => {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const content = record.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== "object") return null;
  const items = content.content as Array<Record<string, unknown>> | undefined;
  const first = Array.isArray(items) ? items[0] : undefined;
  if (first && typeof first.text === "string") {
    try {
      return JSON.parse(first.text) as Record<string, unknown>;
    } catch {
      return { raw: first.text };
    }
  }
  return (content.structuredContent as Record<string, unknown>) ?? null;
};

export async function POST(request: Request) {
  let tempPath: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      return NextResponse.json(
        { success: false, error: "Missing PDF file." },
        { status: 400 },
      );
    }
    const uploadFile = file as File;
    if (uploadFile.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { success: false, error: "PDF too large (max 100MB)." },
        { status: 413 },
      );
    }
    const filename =
      typeof uploadFile.name === "string" && uploadFile.name.trim()
        ? uploadFile.name.trim()
        : "document.pdf";
    if (!filename.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { success: false, error: "Only PDF files are supported." },
        { status: 400 },
      );
    }
    const arrayBuffer = await uploadFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!isPdfBuffer(buffer)) {
      return NextResponse.json(
        { success: false, error: "Invalid PDF file." },
        { status: 400 },
      );
    }
    const safeName = filename.replace(/[^\w.-]+/g, "_");
    tempPath = path.join(
      os.tmpdir(),
      `pageindex-${Date.now()}-${crypto.randomUUID()}-${safeName}`,
    );
    await fs.writeFile(tempPath, buffer);
    const result = await callPageIndexTool("process_document", {
      url: tempPath,
    });
    const payload = parseToolPayload(result);
    return NextResponse.json({
      success: true,
      data: {
        filename,
        result: payload ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 502 },
    );
  } finally {
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
