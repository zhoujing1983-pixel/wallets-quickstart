"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_WELCOME_MESSAGE } from "@/lib/agent-chat-config";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type AgentChatWidgetProps = {
  variant?: "floating" | "panel";
  defaultOpen?: boolean;
};

// 生成用于消息与会话的唯一 ID。
const createId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// 生成当前时间戳用于消息显示。
const createTimestamp = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
// 匹配 <think>...</think> 的思考片段。
const THINK_TAG_REGEX = /<think>([\s\S]*?)<\/think>/gi;

// 拆分思考内容与最终回答，供 UI 展示。
const splitThinkContent = (content: string) => {
  THINK_TAG_REGEX.lastIndex = 0;
  const thinkChunks: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = THINK_TAG_REGEX.exec(content)) !== null) {
    if (match[1]) {
      const cleaned = match[1].trim();
      if (cleaned) {
        thinkChunks.push(cleaned);
      }
    }
  }
  const answer = content.replace(THINK_TAG_REGEX, "").trim();
  return {
    think: thinkChunks.length > 0 ? thinkChunks.join("\n\n") : null,
    answer,
  };
};

export function AgentChatWidget({
  variant = "floating",
  defaultOpen = false,
}: AgentChatWidgetProps) {
  // 根据渲染模式决定布局与初始化状态。
  const isPanel = variant === "panel";
  const [isOpen, setIsOpen] = useState(isPanel || defaultOpen);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const [useLlmDirectly, setUseLlmDirectly] = useState(false);
  const [useThink, setUseThink] = useState(false);
  const [supportsThink, setSupportsThink] = useState(false);
  const [expandedThinks, setExpandedThinks] = useState<Record<string, boolean>>(
    {}
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const userIdRef = useRef<string>("");
  const conversationIdRef = useRef<string>("");
  const assistantAvatar = "/agent/cat-avatar.jpg";

  // 判断是否允许发送消息。
  const canSend = useMemo(
    () => input.trim().length > 0 && !isSending,
    [input, isSending]
  );

  useEffect(() => {
    // 初始化欢迎消息、用户与会话 ID，并恢复本地缓存聊天记录。
    const defaultMessage: ChatMessage = {
      id: "welcome",
      role: "assistant",
      content: AGENT_WELCOME_MESSAGE,
      timestamp: createTimestamp(),
    };
    if (typeof window === "undefined") return;
    const getOrCreateId = (key: string) => {
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const next = createId();
      window.localStorage.setItem(key, next);
      return next;
    };
    userIdRef.current = getOrCreateId("finyx-agent-user-id");
    conversationIdRef.current = getOrCreateId("finyx-agent-conversation-id");
    const stored = window.localStorage.getItem("finyx-agent-chat");
    const ragMode = window.localStorage.getItem("finyx-agent-rag-mode");
    const thinkMode = window.localStorage.getItem("finyx-agent-think-mode");
    if (ragMode === "llm") {
      setUseLlmDirectly(true);
    }
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = parsed.map((msg) => ({
            ...msg,
            timestamp: msg.timestamp ?? createTimestamp(),
          }));
          setMessages(normalized);
          return;
        }
      } catch {
        // Ignore invalid storage state.
      }
    }
    setMessages([defaultMessage]);
  }, []);

  useEffect(() => {
    // 拉取后端配置，判断是否支持 think 模式并恢复本地设置。
    let mounted = true;
    const loadConfig = async () => {
      try {
        const res = await fetch("/api/agent/config");
        const data = await res.json();
        if (!mounted) return;
        if (res.ok && data?.success) {
          const supported = Boolean(data?.data?.supportsThink);
          setSupportsThink(supported);
          if (supported) {
            const thinkMode = window.localStorage.getItem(
              "finyx-agent-think-mode"
            );
            if (thinkMode === "on") {
              setUseThink(true);
            }
          } else {
            setUseThink(false);
          }
        }
      } catch {
        if (mounted) {
          setSupportsThink(false);
          setUseThink(false);
        }
      }
    };
    if (typeof window !== "undefined") {
      loadConfig();
    }
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    // 持久化聊天记录到本地存储。
    if (typeof window === "undefined") return;
    if (messages.length === 0) return;
    window.localStorage.setItem("finyx-agent-chat", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    // 监听网络状态变化，更新在线状态提示。
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
    // 新消息或面板打开时自动滚动到底部。
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isOpen]);

  // 发送用户输入并追加机器人回复。
  const sendMessage = async () => {
    const prompt = input.trim();
    if (!prompt || isSending) return;
    const requestPrompt =
      supportsThink && !useThink && !prompt.includes("/no_think")
        ? `${prompt} /no_think`
        : prompt;
    setInput("");
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: prompt,
      timestamp: createTimestamp(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsSending(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: requestPrompt,
          options: {
            userId: userIdRef.current,
            conversationId: conversationIdRef.current,
            ragMode: useLlmDirectly ? "llm" : "rag",
          },
        }),
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
        {
          id: createId(),
          role: "assistant",
          content: replyText,
          timestamp: createTimestamp(),
        },
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
          timestamp: createTimestamp(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  // 清空聊天记录并重置会话 ID。
  const handleClear = () => {
    const fresh: ChatMessage[] = [
      {
        id: "welcome",
        role: "assistant",
        content: AGENT_WELCOME_MESSAGE,
        timestamp: createTimestamp(),
      },
    ];
    setMessages(fresh);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("finyx-agent-chat", JSON.stringify(fresh));
      const nextConversationId = createId();
      window.localStorage.setItem(
        "finyx-agent-conversation-id",
        nextConversationId
      );
      conversationIdRef.current = nextConversationId;
    }
  };

  // 打开关闭确认弹层。
  const handleCloseChat = () => {
    setIsCloseConfirmOpen(true);
  };

  // 确认关闭后清空并收起聊天。
  const handleConfirmClose = () => {
    handleClear();
    setIsOpen(false);
    setIsCloseConfirmOpen(false);
  };

  // 切换 RAG/LLM 模式并持久化设置。
  const toggleRagMode = () => {
    setUseLlmDirectly((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "finyx-agent-rag-mode",
          next ? "llm" : "rag"
        );
      }
      return next;
    });
  };

  // 切换 think 展示并持久化设置。
  const toggleThinkMode = () => {
    setUseThink((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "finyx-agent-think-mode",
          next ? "on" : "off"
        );
      }
      return next;
    });
  };

  // 展开或收起某条消息的 think 面板。
  const toggleThinkPanel = (messageId: string) => {
    setExpandedThinks((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  // Enter 发送，Shift+Enter 换行。
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  // 根据渲染模式选择容器样式。
  const containerClass = isPanel
    ? "relative flex h-full w-full flex-col font-[var(--font-geist-sans)]"
    : "fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 font-[var(--font-geist-sans)]";

  // 根据渲染模式选择聊天壳样式。
  const chatShellClass = isPanel
    ? "relative flex h-full w-full flex-col rounded-[24px] border border-slate-200 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.12)] overflow-hidden"
    : "relative flex h-[600px] w-[380px] max-w-[92vw] flex-col rounded-[32px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.2)] overflow-hidden";

  return (
    <div className={containerClass}>
      {isOpen ? (
        <div className={chatShellClass}>
          {/* 顶部栏与操作按钮 */}
          <div className="relative border-b border-slate-100 bg-gradient-to-b from-slate-50 via-white to-white px-5 pb-4 pt-4">
            {!isPanel ? (
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
            ) : null}
          </div>
          {/* 离线提示 */}
          {!isOnline ? (
            <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              You are offline. Messages will fail until the connection returns.
            </div>
          ) : null}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-[#fafafa]"
          >
            {/* 消息列表 */}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-start gap-2 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" ? (
                  <div
                    className="h-10 w-10 rounded-full bg-cover bg-center ring-1 ring-white shadow-sm"
                    style={{ backgroundImage: `url(${assistantAvatar})` }}
                    aria-hidden="true"
                  />
                ) : null}
                <div
                  className={
                    message.role === "user"
                      ? "ml-auto w-fit max-w-[76%] rounded-[22px] bg-slate-800/90 px-4 py-3 text-sm text-white shadow-[0_12px_28px_rgba(15,23,42,0.2)]"
                      : "mr-auto w-fit max-w-[76%] rounded-[22px] bg-white px-4 py-3 text-sm text-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.08)] border border-slate-100"
                  }
                >
                  <div className="flex flex-col gap-1 whitespace-pre-wrap break-words">
                    {message.role === "assistant" ? (
                      <>
                        {/* 解析并展示 think/回答内容 */}
                        {(() => {
                          const { think, answer } = splitThinkContent(
                            message.content
                          );
                          const showThink = useThink && Boolean(think);
                          const isExpanded = Boolean(
                            expandedThinks[message.id]
                          );
                          return (
                            <>
                              {/* think 模式开关与面板 */}
                              {showThink ? (
                                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                  <button
                                    type="button"
                                    onClick={() => toggleThinkPanel(message.id)}
                                    className="h-5 w-5 rounded-full border border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600"
                                    aria-label="Toggle think details"
                                  >
                                    {isExpanded ? "v" : ">"}
                                  </button>
                                  <span>Think</span>
                                </div>
                              ) : null}
                              {showThink && isExpanded ? (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600 whitespace-pre-wrap">
                                  {think}
                                </div>
                              ) : null}
                              <span>{answer}</span>
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        {/* 用户消息内容 */}
                        <span>{message.content}</span>
                      </>
                    )}
                    {/* 时间戳 */}
                    <span
                      className={`text-right text-[11px] ${
                        message.role === "user"
                          ? "text-slate-200/80"
                          : "text-slate-500"
                      }`}
                    >
                      {message.timestamp ?? createTimestamp()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {/* 发送中的加载提示 */}
            {isSending ? (
              <div className="flex items-start gap-2">
                <div
                  className="h-10 w-10 rounded-full bg-cover bg-center ring-1 ring-white shadow-sm"
                  style={{ backgroundImage: `url(${assistantAvatar})` }}
                  aria-hidden="true"
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
          {/* 输入区与底部操作 */}
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
            {/* 清空聊天与开关区域 */}
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-500 hover:text-slate-700"
                >
                  Clear chat
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleRagMode}
                    className="relative h-6 w-11 rounded-full border border-slate-200 bg-slate-100 transition"
                  >
                    <span
                      className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition ${
                        useLlmDirectly
                          ? "left-6 bg-slate-900"
                          : "left-1 bg-slate-400"
                      }`}
                    />
                  </button>
                  <span className="text-[11px] text-slate-500">LLM</span>
                </div>
                {/* Think 模式开关 */}
                {supportsThink ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleThinkMode}
                      className="relative h-6 w-11 rounded-full border border-slate-200 bg-slate-100 transition"
                    >
                      <span
                        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition ${
                          useThink
                            ? "left-6 bg-slate-900"
                            : "left-1 bg-slate-400"
                        }`}
                      />
                    </button>
                    <span className="text-[11px] text-slate-500">Think</span>
                  </div>
                ) : null}
              </div>
              <span className="text-[11px] font-semibold text-[#f5b347]">
                Powered by Finyx
              </span>
            </div>
          </div>
          {/* 关闭确认弹层 */}
          {isCloseConfirmOpen && !isPanel ? (
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
      {/* 浮动打开按钮 */}
      {!isPanel ? (
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
      ) : null}
    </div>
  );
}
