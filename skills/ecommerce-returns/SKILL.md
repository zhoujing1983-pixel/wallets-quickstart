---
name: ecommerce-returns
description: Handle ecommerce return/refund requests: verify order, check policy, gather details, and provide next steps or escalation.
keywords: ["return", "refund", "exchange", "cancel", "cancellation", "return policy", "refund policy", "return request", "退货", "退款", "换货", "退货流程", "退货政策"]
---

# Ecommerce Returns

> 目标：把“退货/退款/换货”需求梳理成清晰流程，既能自然对话，也能输出结构化信息供后续系统处理。

## When to use
- User asks to return/refund/cancel an order.
- User reports damaged/incorrect item or wants an exchange.
- User asks about return policy or eligibility.
> 触发场景提示：只要用户表达“想退/不满意/要换/要退款/取消订单”，都可以进此流程。

## Project-specific context
- Available tools: `local_rag_query` and `fetch_website_content` only.
- There is no built-in order/return/refund API in this codebase.
- Use RAG to read return policy docs if they are ingested into `rag-docs/`.
> 说明：目前没有真实退货/退款接口，本技能负责“问清楚 + 判断 + 输出下一步”，不直接执行退款动作。

## Workflow (high-level)
1. **Identify the request type**
   - Return, refund, exchange, cancellation, damaged/defective, wrong item, late delivery.
   - 备注：不同类型会影响规则（如“损坏/错发”通常更容易通过）。
2. **Collect required info**
   - Order ID, purchase date, buyer email/phone, item(s), quantity, reason, condition, photos if damaged.
   - 备注：一次只问缺的字段，避免像表单轰炸。
3. **Check policy**
   - Use `local_rag_query` to locate return window, exclusions, shipping rules, refund method.
   - If no policy is found, ask for policy details or explain limitations.
   - 备注：如果 `references/return-policy.md` 有内容，优先依据它。
4. **Determine eligibility**
   - Compare purchase date + condition + category to policy.
   - If not eligible, explain clearly and offer alternatives (store credit, repair, warranty, escalation).
   - 备注：表达要友好、给替代方案，避免“一刀切”。
5. **Prepare next steps**
   - If eligible: summarize return request details and tell user what happens next.
   - If ineligible or missing data: request missing fields or escalate.
   - 备注：对话输出要“像客服说话”，不要暴露内部字段名。

## Tool usage
- `local_rag_query`: search for "return policy", "refund window", "non-returnable items", "restocking fee".
- `fetch_website_content`: fetch public policy pages if user provides a URL.
> 小贴士：如果用户给了政策链接，先抓取再回答，避免“猜政策”。

## Output template (use in final response)
- A short decision: eligible / not eligible / need more info.
- A concise checklist of what the user must do next.
- A summary block of the captured return request.
> 注意：这些是“内部结构化结果”，对用户输出时要自然表达。

## Safety / escalation
- Do not promise refunds or shipping labels unless the system supports it.
- If the user requests financial actions, explain that the agent cannot process refunds without an integrated system.
> 关键原则：不承诺“已退款/已生成运单”，只能说“已记录/将跟进”。

## Data capture checklist (ask only what is missing)
- Order ID
- Buyer email/phone
- Item(s) and quantity
- Purchase date
- Reason for return
- Condition + photos (if damaged/defective)
- Preferred resolution (refund/exchange/store credit)
> 问法建议：用友好问题替代字段名，如“请提供订单号”而不是“orderId”。

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

## References
- `references/return-policy.md`：退货政策模板/示例（按你们实际政策修改）
