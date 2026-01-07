"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_WELCOME_MESSAGE } from "@/lib/agent-chat-config";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function AgentChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const assistantAvatar = "/agent/diane-cheung.jpg";

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  useEffect(() => {
    const defaultMessage: ChatMessage = {
      id: "welcome",
      role: "assistant",
      content: AGENT_WELCOME_MESSAGE,
    };
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("finyx-agent-chat");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch {
        // Ignore invalid storage state.
      }
    }
    setMessages([defaultMessage]);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (messages.length === 0) return;
    window.localStorage.setItem("finyx-agent-chat", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    setIsOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isOpen]);

  const sendMessage = async () => {
    const prompt = input.trim();
    if (!prompt || isSending) return;
    setInput("");
    const userMessage: ChatMessage = { id: createId(), role: "user", content: prompt };
    setMessages((prev) => [...prev, userMessage]);
    setIsSending(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: prompt }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Agent request failed.");
      }
      const replyText =
        typeof data?.data?.text === "string" && data.data.text.trim().length > 0
          ? data.data.text
          : "I did not get a response. Please try again.";
      setMessages((prev) => [
        ...prev,
        { id: createId(), role: "assistant", content: replyText },
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Agent request failed.";
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          content: `Sorry, I could not reach the agent. ${message}`,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleClear = () => {
    const fresh: ChatMessage[] = [
      {
        id: "welcome",
        role: "assistant",
        content: AGENT_WELCOME_MESSAGE,
      },
    ];
    setMessages(fresh);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("finyx-agent-chat", JSON.stringify(fresh));
    }
  };

  const handleCloseChat = () => {
    setIsCloseConfirmOpen(true);
  };

  const handleConfirmClose = () => {
    handleClear();
    setIsOpen(false);
    setIsCloseConfirmOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 font-[var(--font-geist-sans)]">
      {isOpen ? (
        <div className="relative flex h-[600px] w-[380px] max-w-[92vw] flex-col rounded-[32px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.2)] overflow-hidden">
          <div className="relative border-b border-slate-100 bg-gradient-to-b from-slate-50 via-white to-white px-5 pb-4 pt-4">
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                aria-label="Close chat"
                onClick={handleCloseChat}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
              >
                <img src="/agent/close.svg" alt="Close" className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Minimize chat"
                onClick={() => setIsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
              >
                <img src="/agent/minimize.svg" alt="" className="h-4 w-4" />
              </button>
            </div>
          </div>
          {!isOnline ? (
            <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              You are offline. Messages will fail until the connection returns.
            </div>
          ) : null}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-[#fafafa]"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-end gap-2 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" ? (
                  <img
                    src={assistantAvatar}
                    alt="Agent"
                    className="h-10 w-10 rounded-full object-cover ring-1 ring-white shadow-sm"
                  />
                ) : null}
                <div
                  className={
                    message.role === "user"
                      ? "ml-auto w-fit max-w-[76%] rounded-[22px] bg-slate-900 px-4 py-3 text-sm text-white shadow-[0_12px_28px_rgba(15,23,42,0.2)]"
                      : "mr-auto w-fit max-w-[76%] rounded-[22px] bg-white px-4 py-3 text-sm text-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.08)] border border-slate-100"
                  }
                >
                  {message.content}
                </div>
              </div>
            ))}
            {isSending ? (
              <div className="flex items-center gap-2">
                <img
                  src={assistantAvatar}
                  alt="Agent"
                  className="h-10 w-10 rounded-full object-cover ring-1 ring-white shadow-sm"
                />
                <div className="mr-auto w-fit rounded-[22px] bg-white px-4 py-3 text-xs text-slate-500 shadow-[0_10px_24px_rgba(15,23,42,0.08)] border border-slate-100">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" />
                    <span
                      className="h-2 w-2 rounded-full bg-slate-400 animate-bounce"
                      style={{ animationDelay: "120ms" }}
                    />
                    <span
                      className="h-2 w-2 rounded-full bg-slate-400 animate-bounce"
                      style={{ animationDelay: "240ms" }}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="mt-auto border-t border-slate-100 bg-white px-4 py-4">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.02)]">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"
                aria-label="Add"
              >
                <img src="/agent/plus.svg" alt="" className="h-5 w-5" />
              </button>
              <textarea
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a message..."
                className="flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!canSend}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-md transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <img src="/agent/send.svg" alt="Send" className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <button
                type="button"
                onClick={handleClear}
                className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-500 hover:text-slate-700"
              >
                Clear chat
              </button>
              <span>Powered by Finyx Agent</span>
            </div>
          </div>
          {isCloseConfirmOpen ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/25 backdrop-blur-sm">
              <div className="relative w-[86%] rounded-[24px] bg-white px-6 pb-6 pt-10 shadow-[0_30px_70px_rgba(15,23,42,0.3)]">
                <button
                  type="button"
                  aria-label="Close dialog"
                  onClick={() => setIsCloseConfirmOpen(false)}
                  className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl border-2 border-slate-900 text-slate-900"
                >
                  <img src="/agent/close.svg" alt="Close" className="h-4 w-4" />
                </button>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-200">
                  <img src="/agent/exit.svg" alt="" className="h-7 w-7" />
                </div>
                <p className="mt-6 text-center text-lg font-semibold text-slate-900">
                  Do you really want to close the chat?
                </p>
                <button
                  type="button"
                  onClick={handleConfirmClose}
                  className="mt-6 w-full rounded-full bg-[#dd3c16] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(221,60,22,0.3)] hover:bg-[#c63313]"
                >
                  Close the chat
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Open chat"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_14px_36px_rgba(15,23,42,0.4)] hover:bg-slate-800"
      >
        <img
          src="/agent/robot.svg"
          alt="Open agent chat"
          className="h-6 w-6 transition-transform group-hover:scale-105"
        />
      </button>
    </div>
  );
}
