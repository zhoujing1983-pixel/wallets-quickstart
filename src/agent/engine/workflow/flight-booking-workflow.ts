import { createWorkflow, andThen } from "@voltagent/core";
import type { Agent } from "@voltagent/core";
import { z } from "zod";
import { resolveIataCode } from "@/agent/airports/airports-index";
import {
  runDuffelSearchOffers,
  runDuffelGetOfferById,
  type OfferDetail,
  type OfferSummary,
} from "@/agent/tools/duffel-flight-tool";
import { buildSkillContextPrefix } from "@/agent/skills/skill-loader";
import { buildToolCallContextWithDisabled } from "@/agent/config/tool-call-policy";
import { getRedisClient } from "@/lib/redis";

type FlightWorkflowDeps = {
  agent: Agent;
  provider: string;
};

const flightSearchSchema = z.object({
  slices: z
    .array(
      z.object({
        origin: z.string().min(3),
        destination: z.string().min(3),
        departure_date: z.string().min(8),
      }),
    )
    .min(1),
  passengers: z
    .array(
      z.object({
        type: z.string().min(1).optional(),
        age: z.number().int().positive().optional(),
      }),
    )
    .min(1),
  cabin_class: z
    .enum(["first", "business", "premium_economy", "economy"])
    .optional(),
  max_connections: z.number().int().min(0).optional(),
});

type FlightSearch = z.infer<typeof flightSearchSchema>;

const offerConditionSchema = z.object({
  allowed: z.boolean().nullable().optional().default(null),
  penalty_amount: z.string().nullable().optional().default(null),
  penalty_currency: z.string().nullable().optional().default(null),
});

const offerSegmentSchema = z.object({
  id: z.string(),
  origin: z.string(),
  destination: z.string(),
  departing_at: z.string().nullable().optional().default(null),
  arriving_at: z.string().nullable().optional().default(null),
  marketing_carrier: z.string().nullable().optional().default(null),
  operating_carrier: z.string().nullable().optional().default(null),
  flight_number: z.string().nullable().optional().default(null),
});

const offerSliceSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  departure_date: z.string().optional(),
  segments: z.array(offerSegmentSchema).optional().default([]),
  conditions: z
    .object({
      change_before_departure: offerConditionSchema.nullable().optional(),
      refund_before_departure: offerConditionSchema.nullable().optional(),
    })
    .optional(),
});

const offerDetailSchema = z.object({
  id: z.string(),
  total_amount: z.string(),
  total_currency: z.string(),
  slices: z.array(offerSliceSchema),
  expires_at: z.string().optional(),
  conditions: z
    .object({
      change_before_departure: offerConditionSchema.nullable().optional(),
      refund_before_departure: offerConditionSchema.nullable().optional(),
    })
    .optional(),
  included_baggage_text: z.string().optional(),
  baggage_services: z
    .array(
      z.object({
        id: z.string(),
        total_amount: z.string(),
        total_currency: z.string(),
        segment_ids: z.array(z.string()),
        passenger_ids: z.array(z.string()),
        maximum_quantity: z.number().nullable(),
      }),
    )
    .optional(),
});

const extractJsonPayload = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return null;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(",")}}`;
};

const buildFlightCacheKey = (
  conversationId: string | undefined,
  search: FlightSearch,
) => {
  const scope = conversationId?.trim() || "anonymous";
  return `flight:offers:${scope}:${stableStringify(search)}`;
};

const pickTopOfferSummaries = (offers: OfferSummary[], count = 3) => {
  const sorted = [...offers].sort((a, b) => {
    const aPrice = Number(a.total_amount);
    const bPrice = Number(b.total_amount);
    if (Number.isFinite(aPrice) && Number.isFinite(bPrice)) {
      return aPrice - bPrice;
    }
    return a.total_amount.localeCompare(b.total_amount);
  });
  return sorted.slice(0, count);
};

const normalizeDateInput = (value: string | undefined) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const cnMatch =
    trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})(日|号)?$/);
  if (cnMatch) {
    const [, y, m, d] = cnMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const slashMatch = trimmed.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return trimmed;
};

const normalizeLocationInput = (value: string | undefined) => {
  if (!value) return undefined;
  return resolveIataCode(value);
};

const normalizeFlightSearch = (payload: any): FlightSearch | null => {
  const slices = Array.isArray(payload?.slices)
    ? payload.slices
        .map((slice: any) => ({
          origin:
            typeof slice?.origin === "string"
              ? normalizeLocationInput(slice.origin)
              : undefined,
          destination:
            typeof slice?.destination === "string"
              ? normalizeLocationInput(slice.destination)
              : undefined,
          departure_date:
            typeof slice?.departure_date === "string"
              ? normalizeDateInput(slice.departure_date)
              : undefined,
        }))
        .filter(
          (slice: any) =>
            slice.origin && slice.destination && slice.departure_date,
        )
    : [];
  const passengers = Array.isArray(payload?.passengers)
    ? payload.passengers
        .map((passenger: any) => {
          const type =
            typeof passenger?.type === "string"
              ? passenger.type.trim()
              : undefined;
          const age =
            typeof passenger?.age === "number" && Number.isFinite(passenger.age)
              ? passenger.age
              : undefined;
          if (type && !age) {
            return { type };
          }
          if (!type && age) {
            return { age };
          }
          return null;
        })
        .filter(Boolean)
    : [];
  const cabin_class =
    payload?.cabin_class === "first" ||
    payload?.cabin_class === "business" ||
    payload?.cabin_class === "premium_economy" ||
    payload?.cabin_class === "economy"
      ? payload.cabin_class
      : undefined;
  const max_connections =
    typeof payload?.max_connections === "number" &&
    Number.isFinite(payload.max_connections)
      ? payload.max_connections
      : undefined;
  const normalized = {
    slices,
    passengers,
    cabin_class,
    max_connections,
  };
  const parsed = flightSearchSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
};

const computeMissingFlightFields = (search: FlightSearch | null) => {
  const missing = new Set<string>();
  if (!search || search.slices.length === 0) {
    missing.add("slices");
  }
  if (!search || search.passengers.length === 0) {
    missing.add("passengers");
  }
  return Array.from(missing);
};

const flightMissingFieldLabels: Record<string, string> = {
  slices: "行程信息（出发地/目的地/出发日期）",
  passengers: "乘客人数与类型/年龄",
};

const formatMissingFlightReply = (missing: string[]) => {
  const labels = missing
    .map((field) => flightMissingFieldLabels[field])
    .filter(Boolean);
  if (labels.length === 0) {
    return "为了帮你查机票，还需要补充一些信息。";
  }
  return `为了帮你查机票，请补充：${labels.join("、")}。`;
};

const parseFlightQueryHeuristic = (query: string): FlightSearch | null => {
  const cleanedQuery = query
    .trim()
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "");
  const dateMatch =
    cleanedQuery.match(/\d{4}-\d{1,2}-\d{1,2}/) ??
    cleanedQuery.match(/\d{4}年\d{1,2}月\d{1,2}(日|号)?/) ??
    cleanedQuery.match(/\d{4}[/.]\d{1,2}[/.]\d{1,2}/);
  const routeMatch =
    cleanedQuery.match(
      /([\u4e00-\u9fa5A-Za-z]+)\s*到\s*([\u4e00-\u9fa5A-Za-z]+)/,
    ) ??
    cleanedQuery.match(
      /([\u4e00-\u9fa5A-Za-z]+)\s*[-→>]\s*([\u4e00-\u9fa5A-Za-z]+)/,
    ) ??
    cleanedQuery.match(
      /从\s*([\u4e00-\u9fa5A-Za-z]+)\s*到\s*([\u4e00-\u9fa5A-Za-z]+)/,
    );
  const passengerMatches = Array.from(
    cleanedQuery.matchAll(/(\d+)\s*(位|个)?\s*(成人|儿童|小孩|婴儿)/g),
  );
  const passengers: Array<{ type: string }> = [];
  const addPassengers = (type: string, count: number) => {
    for (let i = 0; i < count; i += 1) {
      passengers.push({ type });
    }
  };
  for (const match of passengerMatches) {
    const count = Number(match[1] ?? 0);
    const rawType = match[3];
    if (!count || !rawType) continue;
    if (rawType === "成人") {
      addPassengers("adult", count);
    } else if (rawType === "儿童" || rawType === "小孩") {
      addPassengers("child", count);
    } else if (rawType === "婴儿") {
      addPassengers("infant_without_seat", count);
    }
  }
  if (passengers.length === 0) {
    const countMatch = cleanedQuery.match(/(\d+)\s*(位|个)?\s*成人/);
    if (countMatch) {
      const count = Number(countMatch[1] ?? 0);
      if (count > 0) {
        addPassengers("adult", count);
      }
    }
  }
  if (!routeMatch || !dateMatch) {
    return null;
  }
  const slices = [
    {
      origin: normalizeLocationInput(routeMatch[1]),
      destination: normalizeLocationInput(routeMatch[2]),
      departure_date: normalizeDateInput(dateMatch[0]),
    },
  ];
  return normalizeFlightSearch({
    slices,
    passengers,
  });
};

const coerceSummaryToDetail = (offer: OfferSummary): OfferDetail => ({
  id: offer.id,
  total_amount: offer.total_amount,
  total_currency: offer.total_currency,
  slices: offer.slices.map((slice) => ({
    origin: slice.origin,
    destination: slice.destination,
    departure_date: slice.departure_date,
    segments: [],
  })),
  expires_at: offer.expires_at,
  conditions: undefined,
  included_baggage_text: undefined,
  baggage_services: undefined,
});

export const createFlightBookingWorkflow = ({
  agent,
  provider,
}: FlightWorkflowDeps) =>
  createWorkflow(
    {
      id: "flight-booking-workflow",
      name: "Flight Booking Workflow",
      purpose: "Search flight offers via Duffel and summarize results.",
      input: z.object({
        query: z.string().min(1),
        options: z
          .object({
            userId: z.string().optional(),
            conversationId: z.string().optional(),
            enableThinking: z.boolean().optional(),
          })
          .optional(),
      }),
      result: z.object({
        search: flightSearchSchema.optional(),
        offerRequestId: z.string().optional(),
        offers: z.array(offerDetailSchema).optional(),
        replyText: z.string(),
        reason: z.string().optional(),
      }),
    },
    andThen({
      id: "flight-booking-run",
      name: "机票预订流程",
      purpose: "Extract flight search details and call Duffel offers API.",
      inputSchema: z.object({
        query: z.string().min(1),
        options: z
          .object({
            userId: z.string().optional(),
            conversationId: z.string().optional(),
            enableThinking: z.boolean().optional(),
          })
          .optional(),
      }),
      outputSchema: z.object({
        search: flightSearchSchema.optional(),
        offerRequestId: z.string().optional(),
        offerCount: z.number().int().optional(),
        offers: z.array(offerDetailSchema).optional(),
        replyText: z.string(),
        reason: z.string().optional(),
      }),
      execute: async ({ data }) => {
        const skillContextPrefix = await buildSkillContextPrefix(data.query, {
          forceSkills: ["duffel-flight-booking"],
        });
        const offerIdMatch = data.query.match(/off_[A-Za-z0-9]+/i);
        if (offerIdMatch) {
          const offerId = offerIdMatch[0];
          try {
            const detail = await runDuffelGetOfferById(offerId, true);
            const segments = detail.slices
              .flatMap((slice) => slice.segments ?? [])
              .map((segment) => {
                const carrier =
                  segment.operating_carrier ??
                  segment.marketing_carrier ??
                  "未知航司";
                const flightNo = segment.flight_number ?? "未知航班号";
                const depart = segment.departing_at ?? "未知起飞时间";
                const arrive = segment.arriving_at ?? "未知降落时间";
                return `- ${carrier} ${flightNo} ${depart} → ${arrive}`;
              });
            const detailText = [`报价 ${offerId} 详情：`, ...segments].join(
              "\n",
            );
            return {
              replyText: detailText,
            };
          } catch (error) {
            return {
              replyText: `获取报价详情失败：${offerId}`,
            };
          }
        }
        const useLlmExtract =
          (process.env.FLIGHT_EXTRACT_MODE ?? "rule").toLowerCase() === "llm";
        let rawText = "";
        let payload: string | null = null;
        if (useLlmExtract) {
          const enableThinking =
            typeof data.options?.enableThinking === "boolean"
              ? data.options.enableThinking
              : undefined;
          const requestHeaders =
            provider === "qwen" && enableThinking !== undefined
              ? { "x-qwen-enable-thinking": String(enableThinking) }
              : undefined;
          const extractionPromptSections = [
            skillContextPrefix,
            "你是机票预订助手，请从用户消息中抽取 Duffel Offer Request 所需的 JSON。",
            "只返回 JSON，不要输出任何额外文字或 markdown。",
            JSON.stringify(
              {
                slices: [
                  {
                    origin: "SFO",
                    destination: "JFK",
                    departure_date: "2025-02-10",
                  },
                ],
                passengers: [{ type: "adult" }],
                cabin_class: "economy",
                max_connections: 1,
              },
              null,
              2,
            ),
            "规则：",
            "- 尽量使用 IATA 城市/机场代码作为出发地和目的地。",
            "- 多城市行程需要按顺序输出多个 slices。",
            "- 若日期缺失，字段留空即可。",
            `用户消息：\n${data.query}`,
          ].filter(Boolean);
          const extractionPrompt = extractionPromptSections.join("\n\n");
          const extractionResult = await agent.generateText(extractionPrompt, {
            userId: data.options?.userId,
            conversationId: data.options?.conversationId,
            headers: requestHeaders,
            context: buildToolCallContextWithDisabled("llm"),
          });
          rawText =
            typeof extractionResult.text === "string"
              ? extractionResult.text
              : "";
          payload = extractJsonPayload(rawText);
        } else {
          payload = extractJsonPayload(data.query);
        }
        let search: FlightSearch | null = null;
        if (payload) {
          try {
            const parsed = JSON.parse(payload);
            search = normalizeFlightSearch(parsed);
          } catch (error) {
            console.warn("[flight-workflow] failed to parse JSON", error);
          }
        }
        if (!search) {
          const heuristicSearch = parseFlightQueryHeuristic(data.query);
          if (heuristicSearch) {
            search = heuristicSearch;
          }
        }
        if (!search) {
          console.log("[flight-workflow] extraction failed", {
            query: data.query,
            rawText,
          });
        }
        const missingFields = computeMissingFlightFields(search);
        if (missingFields.length > 0 || !search) {
          if (rawText && rawText.trim()) {
            return {
              replyText: rawText.trim(),
              reason: "抽取失败，直接返回模型输出。",
            };
          }
          return {
            replyText: formatMissingFlightReply(missingFields),
            reason: "缺少必要的行程或乘客信息，需补充后才能查询报价。",
          };
        }
        console.log(
          "\u001b[33m[flight-workflow] duffel request payload\u001b[0m",
          {
            slices: search.slices,
            passengers: search.passengers,
            cabin_class: search.cabin_class,
            max_connections: search.max_connections,
          },
        );
        const cacheKey = buildFlightCacheKey(
          data.options?.conversationId,
          search,
        );
        let offerResult: { offerRequestId: string; offers: OfferSummary[] } | null =
          null;
        const redisClient = await getRedisClient();
        if (redisClient) {
          try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
              const parsed = JSON.parse(cached) as {
                offerRequestId?: string;
                offers?: OfferSummary[];
              };
              if (parsed?.offers && Array.isArray(parsed.offers)) {
                offerResult = {
                  offerRequestId: parsed.offerRequestId ?? "",
                  offers: parsed.offers,
                };
              }
            }
          } catch (error) {
            console.warn("[flight-workflow] cache read failed", error);
          }
        }
        if (!offerResult) {
          offerResult = await runDuffelSearchOffers(search, 6);
          if (redisClient) {
            try {
              await redisClient.set(cacheKey, JSON.stringify(offerResult), {
                EX: 60 * 30,
              });
            } catch (error) {
              console.warn("[flight-workflow] cache write failed", error);
            }
          }
        }
        const offers: OfferSummary[] = offerResult.offers ?? [];
        const totalOfferCount = offers.length;
        const topOffers = pickTopOfferSummaries(offers, 3);
        const detailTargets = topOffers.map((offer) => offer.id);
        const detailedOffers = await Promise.all(
          detailTargets.map(async (offerId) => {
            try {
              return await runDuffelGetOfferById(offerId, true);
            } catch (error) {
              console.warn("[flight-workflow] failed to load offer", {
                offerId,
                error: error instanceof Error ? error.message : String(error),
              });
              return null;
            }
          }),
        );
        const detailedMap = new Map(
          detailedOffers
            .filter((offer): offer is OfferDetail => Boolean(offer))
            .map((offer) => [offer.id, offer]),
        );
        const offersForReply: OfferDetail[] = topOffers.map(
          (offer) => detailedMap.get(offer.id) ?? coerceSummaryToDetail(offer),
        );
        const replyText =
          totalOfferCount === 0
            ? "暂时没有找到可用的机票报价。可以调整日期或出发地再试试。"
            : "";
        return {
          search,
          offerRequestId: offerResult.offerRequestId,
          offerCount: totalOfferCount,
          offers: offersForReply,
          replyText,
          reason:
            offersForReply.length === 0
              ? "已完成需求解析并调用 Duffel 搜索，但未返回可用报价。"
              : "已解析行程与乘客信息，调用 Duffel 获取报价并整理为中文模板。",
        };
      },
    }),
  );
