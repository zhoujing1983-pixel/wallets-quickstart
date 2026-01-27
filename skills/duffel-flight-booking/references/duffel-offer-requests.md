# Duffel Offer Requests (summary)

Use Duffel Offer Requests to search flight offers.

Required request data:
- `slices`: array of { origin, destination, departure_date }
- `passengers`: array of passengers (type or age)

Optional fields:
- `cabin_class`: first | business | premium_economy | economy
- `max_connections`: maximum number of connections

Notes:
- Multi-city is supported by sending multiple slices in order.
- Use `DUFFEL_API_KEY` with `Authorization: Bearer <key>` and `Duffel-Version: v2` headers.
- Offer details (segments, carriers, conditions, baggage) can be fetched via `GET /air/offers/{id}` with `return_available_services=true`.
- Duffel recommends showing the operating carrier name prominently in offer displays.
