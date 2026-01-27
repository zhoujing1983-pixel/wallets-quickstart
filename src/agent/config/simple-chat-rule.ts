import {
  SIMPLE_CHAT_BLACKLIST,
  SIMPLE_CHAT_LEXICON,
  SIMPLE_CHAT_LENGTH_THRESHOLDS,
  SIMPLE_CHAT_QUESTION_MARKERS,
  SIMPLE_CHAT_STRONG_BUSINESS_PATTERNS,
} from "@/agent/config/simple-chat-lexicon";

type RuleMatch = {
  isSimple: boolean;
  reason: string;
};

const SIMPLE_CHAT_KEYWORDS = Object.values(SIMPLE_CHAT_LEXICON).flat();

const containsAny = (text: string, keywords: string[]) =>
  keywords.some((word) => text.includes(word));

export const matchSimpleChatRule = (input: string): RuleMatch => {
  const text = input.trim().toLowerCase();
  if (!text) {
    return { isSimple: true, reason: "empty" };
  }
  if (containsAny(text, SIMPLE_CHAT_BLACKLIST)) {
    return { isSimple: false, reason: "blacklist keyword" };
  }
  if (SIMPLE_CHAT_STRONG_BUSINESS_PATTERNS.some((pattern) => pattern.test(text))) {
    return { isSimple: false, reason: "business pattern" };
  }
  if (containsAny(text, SIMPLE_CHAT_QUESTION_MARKERS)) {
    return { isSimple: false, reason: "question marker" };
  }
  if (containsAny(text, SIMPLE_CHAT_KEYWORDS)) {
    return { isSimple: true, reason: "simple chat keyword" };
  }
  const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const asciiCharCount = (text.match(/[a-z0-9]/g) || []).length;
  if (
    chineseCharCount > 0 &&
    chineseCharCount <= SIMPLE_CHAT_LENGTH_THRESHOLDS.maxChineseChars
  ) {
    return { isSimple: true, reason: "short chinese" };
  }
  if (
    chineseCharCount === 0 &&
    asciiCharCount > 0 &&
    asciiCharCount <= SIMPLE_CHAT_LENGTH_THRESHOLDS.maxAsciiChars
  ) {
    return { isSimple: true, reason: "short ascii" };
  }
  return { isSimple: false, reason: "default" };
};
