---
name: duffel-flight-booking
description: Handle flight search/booking with Duffel Offer Requests API. Use when user asks about flights, air tickets, booking, or multi-city itineraries; collect missing trip details and search offers.
keywords: ["flight", "air ticket", "airfare", "flight booking", "book flight", "机票", "订票", "航班", "机票预订", "多城市", "多程"]
---

# Duffel Flight Booking

目标：把机票搜索需求转成 Duffel Offer Requests 的结构化请求，并返回可选报价。

要点：
- 必填：`slices`（origin/destination/departure_date）、`passengers`（type 或 age）。
- 多城市：多个 slices 按顺序传入。
- 输出：中文回复 + 3-6 条报价摘要（金额、航段/航司、行李、退改）。

参考资料：`references/duffel-offer-requests.md`
