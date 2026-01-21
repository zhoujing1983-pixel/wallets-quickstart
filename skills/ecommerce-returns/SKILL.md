---
name: ecommerce-returns
description: Handle ecommerce return/refund requests: verify order, check policy, gather details, and provide next steps or escalation.
keywords: ["return", "refund", "exchange", "cancel", "cancellation", "return policy", "refund policy", "return request", "退货", "退款", "换货", "退货流程", "退货政策"]
---

# Ecommerce Returns

## When to use
- User asks to return/refund/cancel an order.
- User reports damaged/incorrect item or wants an exchange.
- User asks about return policy or eligibility.

## Project-specific context
- Available tools: `local_rag_query` and `fetch_website_content` only.
- There is no built-in order/return/refund API in this codebase.
- Use RAG to read return policy docs if they are ingested into `rag-docs/`.

## Workflow (high-level)
1. **Identify the request type**
   - Return, refund, exchange, cancellation, damaged/defective, wrong item, late delivery.
2. **Collect required info**
   - Order ID, purchase date, buyer email/phone, item(s), quantity, reason, condition, photos if damaged.
3. **Check policy**
   - Use `local_rag_query` to locate return window, exclusions, shipping rules, refund method.
   - If no policy is found, ask for policy details or explain limitations.
4. **Determine eligibility**
   - Compare purchase date + condition + category to policy.
   - If not eligible, explain clearly and offer alternatives (store credit, repair, warranty, escalation).
5. **Prepare next steps**
   - If eligible: summarize return request details and tell user what happens next.
   - If ineligible or missing data: request missing fields or escalate.

## Tool usage
- `local_rag_query`: search for "return policy", "refund window", "non-returnable items", "restocking fee".
- `fetch_website_content`: fetch public policy pages if user provides a URL.

## Output template (use in final response)
- A short decision: eligible / not eligible / need more info.
- A concise checklist of what the user must do next.
- A summary block of the captured return request.

## Safety / escalation
- Do not promise refunds or shipping labels unless the system supports it.
- If the user requests financial actions, explain that the agent cannot process refunds without an integrated system.

## Data capture checklist (ask only what is missing)
- Order ID
- Buyer email/phone
- Item(s) and quantity
- Purchase date
- Reason for return
- Condition + photos (if damaged/defective)
- Preferred resolution (refund/exchange/store credit)

## Example response skeleton
Decision: Eligible (pending confirmation)
Next steps:
1) Please provide: order ID, item name, purchase date, and photos (if damaged).
2) We will confirm eligibility and send return instructions.

Return summary:
- Order: {orderId}
- Buyer: {email/phone}
- Item(s): {items}
- Reason: {reason}
- Condition: {condition}
- Requested resolution: {refund/exchange/store credit}
