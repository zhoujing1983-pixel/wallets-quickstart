import { tool } from "@voltagent/core";
import { z } from "zod";

const DUFFEL_BASE_URL =
  process.env.DUFFEL_BASE_URL ?? "https://api.duffel.com";
const DUFFEL_API_KEY = process.env.DUFFEL_API_KEY ?? "";
const LOG_YELLOW = "\u001b[33m";
const LOG_RESET = "\u001b[0m";

const passengerInputSchema = z
  .object({
    type: z.string().min(1).optional(),
    age: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.type && !value.age) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passenger must include type or age.",
      });
    }
    if (value.type && value.age) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passenger cannot include both type and age.",
      });
    }
  });

const sliceInputSchema = z.object({
  origin: z.string().min(3),
  destination: z.string().min(3),
  departure_date: z.string().min(8),
});

const offerRequestInputSchema = z.object({
  slices: z.array(sliceInputSchema).min(1),
  passengers: z.array(passengerInputSchema).min(1),
  cabin_class: z
    .enum(["first", "business", "premium_economy", "economy"])
    .optional(),
  max_connections: z.number().int().min(0).optional(),
  supplier_timeout: z.number().int().positive().optional(),
});

const offerSummarySchema = z.object({
  id: z.string(),
  total_amount: z.string(),
  total_currency: z.string(),
  slices: z.array(
    z.object({
      origin: z.string(),
      destination: z.string(),
      departure_date: z.string().optional(),
    })
  ),
  expires_at: z.string().optional(),
});

export type OfferRequestInput = z.infer<typeof offerRequestInputSchema>;
export type OfferSummary = z.infer<typeof offerSummarySchema>;

type OfferCondition = {
  allowed: boolean | null;
  penalty_amount: string | null;
  penalty_currency: string | null;
};

type OfferSegment = {
  id: string;
  origin: string;
  destination: string;
  departing_at: string | null;
  arriving_at: string | null;
  marketing_carrier: string | null;
  operating_carrier: string | null;
  flight_number: string | null;
};

type OfferSliceDetail = {
  origin: string;
  destination: string;
  departure_date?: string;
  segments: OfferSegment[];
  conditions?: {
    change_before_departure?: OfferCondition | null;
    refund_before_departure?: OfferCondition | null;
  };
};

export type OfferDetail = {
  id: string;
  total_amount: string;
  total_currency: string;
  slices: OfferSliceDetail[];
  expires_at?: string;
  conditions?: {
    change_before_departure?: OfferCondition | null;
    refund_before_departure?: OfferCondition | null;
  };
  included_baggage_text?: string;
  baggage_services?: Array<{
    id: string;
    total_amount: string;
    total_currency: string;
    segment_ids: string[];
    passenger_ids: string[];
    maximum_quantity: number | null;
  }>;
};

const ensureDuffelKey = () => {
  if (!DUFFEL_API_KEY) {
    throw new Error("Missing DUFFEL_API_KEY in environment.");
  }
};

const formatSliceLabel = (slice: any) => {
  const origin =
    slice?.origin?.iata_code ??
    slice?.origin?.iata_city_code ??
    slice?.origin?.iata_airport_code ??
    slice?.origin ??
    "UNK";
  const destination =
    slice?.destination?.iata_code ??
    slice?.destination?.iata_city_code ??
    slice?.destination?.iata_airport_code ??
    slice?.destination ??
    "UNK";
  const departureDate =
    slice?.departure_date ?? slice?.segments?.[0]?.departing_at?.slice(0, 10);
  return {
    origin: String(origin),
    destination: String(destination),
    departure_date:
      typeof departureDate === "string" ? departureDate : undefined,
  };
};

const mapOfferSummary = (offer: any): OfferSummary => ({
  id: String(offer?.id ?? ""),
  total_amount: String(offer?.total_amount ?? ""),
  total_currency: String(offer?.total_currency ?? ""),
  slices: Array.isArray(offer?.slices)
    ? offer.slices.map((slice: any) => formatSliceLabel(slice))
    : [],
  expires_at:
    typeof offer?.expires_at === "string" ? offer.expires_at : undefined,
});

const mapCondition = (value: any): OfferCondition | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const allowed =
    typeof value.allowed === "boolean" ? value.allowed : value.allowed ?? null;
  const penalty_amount =
    typeof value.penalty_amount === "string" ? value.penalty_amount : null;
  const penalty_currency =
    typeof value.penalty_currency === "string" ? value.penalty_currency : null;
  return {
    allowed,
    penalty_amount,
    penalty_currency,
  };
};

const mapSegment = (segment: any): OfferSegment => {
  const origin =
    segment?.origin?.iata_code ??
    segment?.origin?.iata_city_code ??
    segment?.origin?.iata_airport_code ??
    segment?.origin ??
    "UNK";
  const destination =
    segment?.destination?.iata_code ??
    segment?.destination?.iata_city_code ??
    segment?.destination?.iata_airport_code ??
    segment?.destination ??
    "UNK";
  const marketingCarrier =
    segment?.marketing_carrier?.name ??
    segment?.marketing_carrier?.iata_code ??
    null;
  const operatingCarrier =
    segment?.operating_carrier?.name ??
    segment?.operating_carrier?.iata_code ??
    null;
  const flightNumber =
    typeof segment?.marketing_carrier_flight_number === "string"
      ? segment.marketing_carrier_flight_number
      : typeof segment?.operating_carrier_flight_number === "string"
        ? segment.operating_carrier_flight_number
        : null;
  return {
    id: String(segment?.id ?? ""),
    origin: String(origin),
    destination: String(destination),
    departing_at:
      typeof segment?.departing_at === "string" ? segment.departing_at : null,
    arriving_at:
      typeof segment?.arriving_at === "string" ? segment.arriving_at : null,
    marketing_carrier: marketingCarrier,
    operating_carrier: operatingCarrier,
    flight_number: flightNumber,
  };
};

const formatBaggageItemDetail = (item: any) => {
  const quantity =
    typeof item?.quantity === "number"
      ? item.quantity
      : typeof item?.maximum_quantity === "number"
        ? item.maximum_quantity
        : 1;
  const type =
    typeof item?.type === "string" ? item.type.replace(/_/g, " ") : "baggage";
  const weight =
    item?.weight && typeof item.weight?.value === "number"
      ? `${item.weight.value}${item.weight.unit ?? ""}`
      : "";
  const dimensions =
    item?.dimensions &&
    typeof item.dimensions?.length === "number" &&
    typeof item.dimensions?.width === "number" &&
    typeof item.dimensions?.height === "number"
      ? `${item.dimensions.length}x${item.dimensions.width}x${item.dimensions.height}${item.dimensions.unit ?? ""}`
      : "";
  const metaFields = [
    weight ? `重量 ${weight}` : "",
    dimensions ? `尺寸 ${dimensions}` : "",
  ].filter(Boolean);
  const meta = metaFields.length > 0 ? `（${metaFields.join("，")}）` : "";
  return `类型 ${type}，数量 ${quantity}${meta}`;
};

const formatBaggageItems = (items: any[]) => {
  return items.map(formatBaggageItemDetail).filter(Boolean);
};

const extractFreeBaggageText = (offer: any) => {
  const sliceSegments = Array.isArray(offer?.slices)
    ? offer.slices.flatMap((slice: any) =>
        Array.isArray(slice?.segments) ? slice.segments : [],
      )
    : [];
  const passengerLookup = new Map<string, string>();
  if (Array.isArray(offer?.passengers)) {
    for (const passenger of offer.passengers) {
      const id = typeof passenger?.id === "string" ? passenger.id : "";
      if (!id) continue;
      const rawType =
        typeof passenger?.type === "string" ? passenger.type : null;
      const normalizedType = rawType ? rawType.toLowerCase() : null;
      let label = "乘客";
      if (normalizedType === "adult") {
        label = "成人";
      } else if (normalizedType === "child") {
        label = "儿童";
      } else if (normalizedType === "infant_without_seat") {
        label = "婴儿（无座）";
      } else if (normalizedType === "infant_with_seat") {
        label = "婴儿（有座）";
      } else if (typeof passenger?.age === "number") {
        label = `乘客（${passenger.age}岁）`;
      }
      passengerLookup.set(id, label);
    }
  }
  const segmentLines = sliceSegments
    .map((segment: any) => {
      const options = segment?.passenger_baggage_options;
      if (!options || typeof options !== "object") {
        return null;
      }
      const segmentLabel = `${segment?.origin?.iata_code ?? "UNK"}→${
        segment?.destination?.iata_code ?? "UNK"
      }`;
      const passengerLines = Object.entries(options)
        .map(([passengerId, items]) => {
          const list = Array.isArray(items) ? formatBaggageItems(items) : [];
          if (list.length === 0) {
            return null;
          }
          const label = passengerLookup.get(passengerId) ?? passengerId;
          return `${label}: ${list.join(", ")}`;
        })
        .filter(Boolean) as string[];
      if (passengerLines.length === 0) {
        return null;
      }
      return `${segmentLabel} 免费额度：${passengerLines.join("；")}`;
    })
    .filter(Boolean) as string[];
  if (segmentLines.length > 0) {
    return segmentLines.join("；");
  }
  const passengerBaggages = Array.isArray(offer?.passengers)
    ? offer.passengers
        .map((passenger: any) => passenger?.baggages)
        .filter(Boolean)
        .flat()
    : [];
  if (passengerBaggages.length > 0) {
    const items = formatBaggageItems(passengerBaggages);
    if (items.length > 0) {
      return `免费：${Array.from(new Set(items)).join(", ")}`;
    }
  }
  return undefined;
};

const mapOfferDetail = (offer: any): OfferDetail => {
  const slices: OfferSliceDetail[] = Array.isArray(offer?.slices)
    ? offer.slices.map((slice: any) => ({
        ...formatSliceLabel(slice),
        segments: Array.isArray(slice?.segments)
          ? slice.segments.map(mapSegment)
          : [],
        conditions: {
          change_before_departure: mapCondition(
            slice?.conditions?.change_before_departure,
          ),
          refund_before_departure: mapCondition(
            slice?.conditions?.refund_before_departure,
          ),
        },
      }))
    : [];
  const services = Array.isArray(offer?.available_services)
    ? offer.available_services
        .filter((service: any) => service?.type === "baggage")
        .map((service: any) => ({
          id: String(service?.id ?? ""),
          total_amount: String(service?.total_amount ?? ""),
          total_currency: String(service?.total_currency ?? ""),
          segment_ids: Array.isArray(service?.segment_ids)
            ? service.segment_ids.map((id: any) => String(id))
            : [],
          passenger_ids: Array.isArray(service?.passenger_ids)
            ? service.passenger_ids.map((id: any) => String(id))
            : [],
          maximum_quantity:
            typeof service?.maximum_quantity === "number"
              ? service.maximum_quantity
              : null,
        }))
    : [];
  return {
    id: String(offer?.id ?? ""),
    total_amount: String(offer?.total_amount ?? ""),
    total_currency: String(offer?.total_currency ?? ""),
    slices,
    expires_at:
      typeof offer?.expires_at === "string" ? offer.expires_at : undefined,
    conditions: {
      change_before_departure: mapCondition(
        offer?.conditions?.change_before_departure,
      ),
      refund_before_departure: mapCondition(
        offer?.conditions?.refund_before_departure,
      ),
    },
    included_baggage_text: extractFreeBaggageText(offer),
    baggage_services: services.length > 0 ? services : undefined,
  };
};

export const runDuffelSearchOffers = async (
  input: OfferRequestInput,
  maxOffers = 10
) => {
  ensureDuffelKey();
  const url = new URL("/air/offer_requests", DUFFEL_BASE_URL);
  if (typeof input.supplier_timeout === "number") {
    url.searchParams.set("supplier_timeout", String(input.supplier_timeout));
  }
  const payload = {
    data: {
      slices: input.slices,
      passengers: input.passengers,
      cabin_class: input.cabin_class,
      max_connections: input.max_connections,
    },
  };
  console.log(
    `${LOG_YELLOW}[duffel:request] POST ${url.toString()}${LOG_RESET}`,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip",
        "Duffel-Version": "v2",
      },
      body: payload,
    }
  );
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Encoding": "gzip",
      "Duffel-Version": "v2",
      Authorization: `Bearer ${DUFFEL_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  console.log(`${LOG_YELLOW}[duffel:response]${LOG_RESET}`, {
    status: response.status,
    statusText: response.statusText,
    body: responseText.slice(0, 4000),
  });
  if (!response.ok) {
    throw new Error(
      `Duffel offer request failed: ${response.status} ${response.statusText} ${responseText}`
    );
  }
  const json = JSON.parse(responseText) as any;
  const data = json?.data ?? {};
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  const trimmed = offers.slice(0, maxOffers).map(mapOfferSummary);
  return {
    offerRequestId: String(data?.id ?? ""),
    offers: trimmed,
  };
};

export const runDuffelGetOfferById = async (
  offerId: string,
  returnAvailableServices = true
) => {
  ensureDuffelKey();
  const url = new URL(`/air/offers/${offerId}`, DUFFEL_BASE_URL);
  if (returnAvailableServices) {
    url.searchParams.set("return_available_services", "true");
  }
  console.log(
    `${LOG_YELLOW}[duffel:request] GET ${url.toString()}${LOG_RESET}`,
    {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "Duffel-Version": "v2",
      },
    }
  );
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "Duffel-Version": "v2",
      Authorization: `Bearer ${DUFFEL_API_KEY}`,
    },
  });
  const responseText = await response.text();
  console.log(`${LOG_YELLOW}[duffel:response]${LOG_RESET}`, {
    status: response.status,
    statusText: response.statusText,
    body: responseText.slice(0, 4000),
  });
  if (!response.ok) {
    throw new Error(
      `Duffel get offer failed: ${response.status} ${response.statusText} ${responseText}`
    );
  }
  const json = JSON.parse(responseText) as any;
  const offer = json?.data ?? {};
  return mapOfferDetail(offer);
};

export const duffelSearchOffersTool = tool({
  name: "duffel_search_offers",
  description:
    "Search for flight offers via Duffel Offer Requests. Provide slices and passengers (type or age). Supports multi-city by passing multiple slices.",
  parameters: offerRequestInputSchema.extend({
    maxOffers: z.number().int().min(1).max(50).optional(),
  }),
  outputSchema: z.object({
    offerRequestId: z.string(),
    offers: z.array(offerSummarySchema),
  }),
  execute: async ({ maxOffers, ...input }) => {
    console.log("\n[tool:exec] duffel_search_offers", {
      slices: input.slices?.length ?? 0,
      passengers: input.passengers?.length ?? 0,
    });
    const result = await runDuffelSearchOffers(input, maxOffers ?? 10);
    console.log("\n[tool:exec] duffel_search_offers result", {
      offerRequestId: result.offerRequestId,
      offers: result.offers.length,
    });
    return result;
  },
});
