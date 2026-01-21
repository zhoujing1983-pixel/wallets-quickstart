import { NextResponse } from "next/server";
import { workflowService } from "@/agent/services/workflow-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await workflowService.saveWorkflow(body ?? {});

    return NextResponse.json({
      success: true,
      data: { id: result.id },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Save failed.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("id");

    if (workflowId) {
      const workflow = await workflowService.getWorkflow(workflowId);
      if (!workflow) {
        return NextResponse.json(
          { success: false, error: "Workflow not found." },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, data: workflow });
    }

    const result = await workflowService.listWorkflows(30);
    return NextResponse.json({
      success: true,
      data: result.map((row) => ({
        id: row.id,
        name: row.name,
        updatedAt: row.updatedAt,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Fetch failed.",
      },
      { status: 500 }
    );
  }
}
