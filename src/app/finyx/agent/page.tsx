"use client";

import { useMemo, useState } from "react";
import { AgentChatWidget } from "@/components/agent-chat-widget";

const sections = [
  {
    id: "overview",
    label: "Overview",
    title: "Agent Command Center",
    description:
      "Monitor your agent, review recent activity, and configure core behaviors.",
    bullets: [
      "Check health, latency, and ingestion status.",
      "Review recent chat sessions and outcomes.",
      "Validate the RAG pipeline end-to-end.",
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge Base",
    title: "Knowledge Base",
    description: "Manage indexed documents, chunking rules, and embedding updates.",
    bullets: [
      "Review indexed files and chunk counts.",
      "Trigger a forced reindex when sources change.",
      "Tune chunk sizes and overlap for retrieval quality.",
    ],
  },
  {
    id: "tools",
    label: "Tools & Integrations",
    title: "Tools & Integrations",
    description: "Configure tools, web access, and connected services.",
    bullets: [
      "Enable or disable tool access per environment.",
      "Manage API keys and rate limits.",
      "Audit tool usage for compliance.",
    ],
  },
  {
    id: "settings",
    label: "Settings",
    title: "Agent Settings",
    description: "Tune model, instructions, and fallback behavior.",
    bullets: [
      "Select model provider and runtime options.",
      "Control RAG fallback thresholds.",
      "Manage response tone and guardrails.",
    ],
  },
];

export default function AgentManagementPage() {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "overview");
  const activeSection = useMemo(
    () => sections.find((section) => section.id === activeId) ?? sections[0],
    [activeId]
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-6 px-6 py-8">
        <section
          className="rounded-[32px] overflow-hidden shadow-[0_30px_80px_rgba(5,12,41,0.15)]"
          style={{
            backgroundImage: "url('/agent/agent-banner.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center 25%",
          }}
        >
          <div className="flex flex-col gap-4 px-6 py-10 backdrop-brightness-75">
            <p className="text-xs uppercase tracking-[0.4em] text-white/70">
              Finyx Agent
            </p>
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">
              AI Agent Operations Console
            </h1>
            <p className="max-w-3xl text-sm text-white/80">
              Manage knowledge, tools, and runtime behavior from a single command
              center.
            </p>
          </div>
        </section>

        <div className="flex min-h-[calc(100vh-22rem)] gap-6">
          <aside className="w-64 shrink-0">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Agent Admin
            </p>
            <nav className="mt-5 flex flex-col gap-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveId(section.id)}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition ${
                    activeId === section.id
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="font-medium">{section.label}</span>
                  <span className="text-xs opacity-70">↗</span>
                </button>
              ))}
            </nav>
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
              Future tools and admin panels can be added here.
            </div>
          </div>
        </aside>

          <main className="flex-1">
            <div className="rounded-3xl border border-slate-200 bg-white px-10 py-10 shadow-sm">
              <div className="flex flex-col gap-4">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  {activeSection?.label}
                </span>
                <h1 className="text-3xl font-semibold text-slate-900">
                  {activeSection?.title}
                </h1>
                <p className="text-base text-slate-600">
                  {activeSection?.description}
                </p>
              </div>
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {activeSection?.bullets.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600"
                  >
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-10 rounded-2xl border border-dashed border-slate-200 px-6 py-5 text-sm text-slate-500">
                This space is reserved for future management tooling. Connect
                metrics, ingestion logs, and audit trails here.
              </div>
            </div>
          </main>

          <aside className="w-[420px] shrink-0">
            <div className="sticky top-6 h-[calc(100vh-16rem)]">
              <AgentChatWidget variant="panel" defaultOpen />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
