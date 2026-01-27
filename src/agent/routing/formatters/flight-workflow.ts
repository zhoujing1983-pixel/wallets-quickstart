type FlightWorkflowResult = {
  replyText?: string;
  offers?: unknown;
  offerRequestId?: unknown;
  offerCount?: unknown;
  search?: unknown;
  reason?: unknown;
};

type OfferSummaryLike = {
  id?: string;
  total_amount?: string;
  total_currency?: string;
};

const pickTopOffers = (offers: OfferSummaryLike[], count = 3) => {
  const sorted = [...offers].sort((a, b) => {
    const aPrice = Number(a.total_amount ?? "");
    const bPrice = Number(b.total_amount ?? "");
    if (Number.isFinite(aPrice) && Number.isFinite(bPrice)) {
      return aPrice - bPrice;
    }
    return String(a.total_amount ?? "").localeCompare(
      String(b.total_amount ?? ""),
    );
  });
  return sorted.slice(0, count);
};

const buildSummary = (offers: OfferSummaryLike[], totalCount: number) => {
  if (offers.length === 0) {
    return "暂时没有找到可用的机票报价。可以调整日期或出发地再试试。";
  }
  const topOffers = pickTopOffers(offers, 3);
  const header = `已为你找到 ${totalCount} 个报价，以下为价格最低的 3 个：`;
  const lines = topOffers.map((offer, index) => {
    const price = [offer.total_amount, offer.total_currency]
      .filter(Boolean)
      .join(" ");
    return `${index + 1}. ${price}`;
  });
  return [header, ...lines].join("\n");
};

export const formatFlightWorkflowResult = (result: FlightWorkflowResult) => {
  const offers = Array.isArray(result.offers)
    ? (result.offers as OfferSummaryLike[])
    : [];
  const totalCount =
    typeof result.offerCount === "number" && Number.isFinite(result.offerCount)
      ? result.offerCount
      : offers.length;
  const text =
    typeof result.replyText === "string" && result.replyText.trim()
      ? result.replyText.trim()
      : buildSummary(offers, totalCount);
  return {
    text,
    sources: [],
    offers,
    offerRequestId:
      typeof result.offerRequestId === "string" ? result.offerRequestId : "",
    search:
      result.search && typeof result.search === "object" ? result.search : null,
    reason: typeof result.reason === "string" ? result.reason : "",
  };
};
