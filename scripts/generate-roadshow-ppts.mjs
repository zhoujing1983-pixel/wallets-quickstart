import pptxgen from 'pptxgenjs';

const COLORS = {
  dark: '0B1220',
  ink: '0F172A',
  body: '334155',
  muted: '64748B',
  bg: 'F8FAFC',
  panel: 'FFFFFF',
  primary: '0EA5E9',
  success: '16A34A',
  warning: 'F59E0B',
};

function createDeck(meta) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Codex';
  pptx.company = 'Finyx Wallet Studio';
  pptx.subject = meta.subject;
  pptx.title = meta.title;
  pptx.lang = meta.lang;
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: meta.lang,
  };
  return pptx;
}

function base(slide, title, subtitle = '') {
  slide.background = { color: COLORS.bg };
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.58,
    fill: { color: COLORS.dark },
    line: { color: COLORS.dark },
  });
  slide.addText('Finyx Wallet Studio', {
    x: 0.45,
    y: 0.16,
    w: 4,
    h: 0.26,
    fontSize: 12,
    color: 'E2E8F0',
    bold: true,
  });
  slide.addText(title, {
    x: 0.72,
    y: 0.88,
    w: 11.8,
    h: 0.55,
    fontSize: 30,
    color: COLORS.ink,
    bold: true,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.72,
      y: 1.46,
      w: 11.8,
      h: 0.34,
      fontSize: 13,
      color: COLORS.muted,
    });
  }
}

function bullets(slide, items, opts = {}) {
  const { x = 0.95, y = 2.0, w = 11.5, h = 4.5, size = 18 } = opts;
  slide.addText(
    items.map((t) => ({ text: t, options: { bullet: { indent: 18 } } })),
    {
      x,
      y,
      w,
      h,
      fontSize: size,
      color: COLORS.body,
      paraSpaceAfterPt: 12,
      breakLine: true,
    }
  );
}

function coverCN(pptx) {
  const s = pptx.addSlide();
  s.background = { color: COLORS.dark };
  s.addShape('roundRect', {
    x: 0.78,
    y: 0.72,
    w: 11.7,
    h: 5.45,
    rectRadius: 0.08,
    fill: { color: '111827', transparency: 2 },
    line: { color: '1E293B', pt: 1 },
  });
  s.addText('Finyx Wallet Studio', {
    x: 1.15,
    y: 1.33,
    w: 8.2,
    h: 0.7,
    fontSize: 43,
    color: 'F8FAFC',
    bold: true,
  });
  s.addText('融资路演版（Investor Deck）', {
    x: 1.15,
    y: 2.2,
    w: 7.3,
    h: 0.45,
    fontSize: 22,
    color: 'BAE6FD',
    bold: true,
  });
  s.addText('2026-03-31', {
    x: 1.15,
    y: 5.45,
    w: 2,
    h: 0.25,
    fontSize: 11,
    color: '94A3B8',
  });
}

function coverEN(pptx) {
  const s = pptx.addSlide();
  s.background = { color: COLORS.dark };
  s.addShape('roundRect', {
    x: 0.78,
    y: 0.72,
    w: 11.7,
    h: 5.45,
    rectRadius: 0.08,
    fill: { color: '111827', transparency: 2 },
    line: { color: '1E293B', pt: 1 },
  });
  s.addText('Finyx Wallet Studio', {
    x: 1.15,
    y: 1.33,
    w: 8.2,
    h: 0.7,
    fontSize: 43,
    color: 'F8FAFC',
    bold: true,
  });
  s.addText('Investor Pitch Deck', {
    x: 1.15,
    y: 2.2,
    w: 7.3,
    h: 0.45,
    fontSize: 22,
    color: 'BAE6FD',
    bold: true,
  });
  s.addText('March 31, 2026', {
    x: 1.15,
    y: 5.45,
    w: 2.5,
    h: 0.25,
    fontSize: 11,
    color: '94A3B8',
  });
}

function addAgentDetailedCN(pptx) {
  const s = pptx.addSlide();
  base(s, 'Agent 能力详解', '可配置路由、执行、记忆与工具系统（详细页）');
  const data = [
    ['路由决策层', '关键词规则 + simple-chat 规则 + workflow 判定，决定 direct/flight/return/rag 等链路。'],
    ['运行时抽象层', '`runtime/factory.ts` 统一接口，按 `AGENT_FRAMEWORK` 在 VoltAgent 与 LangChain 之间切换。'],
    ['执行编排层', '`route-service.ts` 负责 payload 构建、SSE 流式转发、结果格式化和失败兜底。'],
    ['检索增强层', '本地 SQLite + sqlite-vec；支持 `local-rag` / `hybrid` / `voltagent` 模式切换。'],
    ['工具扩展层', '内置 weather-mcp、local-rag-tool、duffel-flight-tool；通过 MCP 标准可继续扩展。'],
    ['会话与记忆', '支持 userId/conversationId 透传，便于上下文连续、多轮会话与审计。'],
  ];
  let y = 2.0;
  for (const [t, d] of data) {
    s.addShape('roundRect', {
      x: 0.92,
      y,
      w: 11.5,
      h: 0.72,
      rectRadius: 0.03,
      fill: { color: 'FFFFFF' },
      line: { color: 'CBD5E1', pt: 1 },
    });
    s.addText(t, {
      x: 1.15,
      y: y + 0.12,
      w: 2.15,
      h: 0.22,
      fontSize: 13,
      bold: true,
      color: COLORS.ink,
    });
    s.addText(d, {
      x: 3.25,
      y: y + 0.1,
      w: 8.9,
      h: 0.45,
      fontSize: 12,
      color: COLORS.body,
    });
    y += 0.8;
  }
}

function addAgentDetailedEN(pptx) {
  const s = pptx.addSlide();
  base(s, 'Detailed Agent Capabilities', 'Routing, orchestration, retrieval, tools, and session context');
  const data = [
    ['Routing Layer', 'Keyword routing + simple-chat rules + workflow decision to dispatch direct/flight/return/rag flows.'],
    ['Runtime Abstraction', '`runtime/factory.ts` exposes a single contract and switches between VoltAgent and LangChain.'],
    ['Execution Orchestration', '`route-service.ts` builds payloads, handles SSE streaming, formats outputs, and fallback behavior.'],
    ['Retrieval Layer', 'Local SQLite + sqlite-vec RAG index with switchable `local-rag` / `hybrid` / `voltagent` proxy modes.'],
    ['Tool Integration', 'Built-in weather-mcp, local-rag-tool, and duffel-flight-tool; extensible via MCP-compatible tools.'],
    ['Session & Memory', 'Supports userId/conversationId propagation for multi-turn continuity and better observability.'],
  ];
  let y = 2.0;
  for (const [t, d] of data) {
    s.addShape('roundRect', {
      x: 0.92,
      y,
      w: 11.5,
      h: 0.72,
      rectRadius: 0.03,
      fill: { color: 'FFFFFF' },
      line: { color: 'CBD5E1', pt: 1 },
    });
    s.addText(t, {
      x: 1.15,
      y: y + 0.12,
      w: 2.35,
      h: 0.22,
      fontSize: 13,
      bold: true,
      color: COLORS.ink,
    });
    s.addText(d, {
      x: 3.45,
      y: y + 0.1,
      w: 8.7,
      h: 0.45,
      fontSize: 12,
      color: COLORS.body,
    });
    y += 0.8;
  }
}

function buildCN() {
  const pptx = createDeck({
    lang: 'zh-CN',
    subject: 'Investor Pitch',
    title: 'Finyx Wallet Studio 融资路演版',
  });

  coverCN(pptx);

  let s = pptx.addSlide();
  base(s, '我们在做什么', '一句话定位与价值主张');
  bullets(s, [
    'Finyx 是一个可品牌化的钱包与支付基础设施样板，可快速落地 Web3 金融体验。',
    '核心价值：把“登录-持币-支付-客服 Agent”整合为一条可运营、可扩展的业务链路。',
    '底层复用 Crossmint 能力，显著降低钱包、安全与支付集成成本。',
    '当前工程已具备 MVP 级完整闭环，可用于 PoC、试点和早期商业化验证。',
  ]);

  s = pptx.addSlide();
  base(s, '市场痛点与机会', 'Why now');
  bullets(s, [
    '钱包体验割裂：认证、资金入口、支付、客服通常分散在多个系统。',
    '企业落地门槛高：合规与支付链路复杂，工程团队需要高投入。',
    'AI 交互趋势明显：用户希望“对话即操作”，不是手动跳多页面。',
    '机会点：将钱包基建与 Agent 能力融合，形成更高转化与更低运维成本。',
  ]);

  s = pptx.addSlide();
  base(s, '产品与功能现状', '已实现能力（代码可验证）');
  bullets(s, [
    '钱包与认证：Crossmint Auth + 钱包状态管理，支持标准与 email session 路径。',
    '支付能力：Intent/Delegation/Receipt + 402 支付网关，支持“先付费后访问”。',
    'Agent 能力：聊天、路由、工具调用、本地 RAG、SSE 流式输出。',
    '增长与运营：邮件 OTP、异步队列、活动流水、用户信息与资产看板。',
  ]);

  addAgentDetailedCN(pptx);

  s = pptx.addSlide();
  base(s, '技术护城河', 'Why us');
  bullets(s, [
    '可插拔 runtime：VoltAgent / LangChain 双引擎，降低对单一框架依赖。',
    '可插拔检索：本地向量库 + PageIndex MCP，可按成本和规模切换。',
    '标准化接口：App Router + API 路由 + MCP 工具协议，便于生态扩展。',
    '部署友好：dev/init/all/shutdown 脚本齐全，支持快速演示与环境复制。',
  ]);

  s = pptx.addSlide();
  base(s, '商业化路径（建议）', '从技术样板到营收产品');
  bullets(s, [
    '阶段 1：面向开发团队输出“钱包+支付+Agent”集成方案与实施服务。',
    '阶段 2：产品化为托管平台，按 MAU、交易量、Agent 调用量分级计费。',
    '阶段 3：沉淀行业模板（电商、游戏、跨境支付），提升复制效率。',
    '阶段 4：引入合作渠道（支付、SaaS、交易平台）做联合获客。',
  ]);

  s = pptx.addSlide();
  base(s, '当前阶段与里程碑', 'Execution readiness');
  bullets(s, [
    '已完成：MVP 技术闭环（Web、API、Agent、RAG、支付链路、邮件链路）。',
    '下一里程碑：补齐测试、监控、审计与安全基线，进入小规模灰度。',
    '商业里程碑：首批试点客户验证转化、留存、交易成功率三项关键指标。',
    '融资用途：产品化、合规能力、销售拓展、核心团队扩充。',
  ]);

  s = pptx.addSlide();
  base(s, '风险与应对', 'Execution risk control');
  const risks = [
    ['安全与合规', '收据/委托链路增强审计日志，生产禁用默认 secret。', COLORS.warning],
    ['稳定性', '为 agent 和 worker 增加健康检查、重试与告警闭环。', COLORS.warning],
    ['成本效率', '根据请求规模动态选择 local-rag / hosted 模式降低推理成本。', COLORS.success],
    ['交付速度', '模板化行业解决方案，减少重复开发。', COLORS.primary],
  ];
  let y = 2.0;
  for (const [t, d, c] of risks) {
    s.addShape('roundRect', {
      x: 0.95,
      y,
      w: 11.45,
      h: 0.9,
      rectRadius: 0.04,
      fill: { color: 'FFFFFF' },
      line: { color: 'CBD5E1', pt: 1 },
    });
    s.addShape('rect', {
      x: 0.95,
      y,
      w: 0.13,
      h: 0.9,
      fill: { color: c },
      line: { color: c },
    });
    s.addText(t, { x: 1.2, y: y + 0.12, w: 2.2, h: 0.25, fontSize: 13, bold: true, color: COLORS.ink });
    s.addText(d, { x: 3.2, y: y + 0.12, w: 8.9, h: 0.48, fontSize: 12, color: COLORS.body });
    y += 1.05;
  }

  s = pptx.addSlide();
  base(s, '融资需求（示例页，可按你目标改数）', 'Fundraising ask');
  bullets(s, [
    '计划融资：可在该页替换为目标金额、估值区间与融资轮次。',
    '资金分配建议：40% 产品研发，25% GTM，20% 合规与安全，15% 运营与客户成功。',
    '18 个月目标：完成产品化、拿下标杆客户、验证可复制销售模型。',
    '可在下一版替换为你真实财务模型（收入预测、现金流、CAC/LTV）。',
  ]);

  s = pptx.addSlide();
  base(s, 'Thank You', 'Finyx Wallet Studio · Investor Deck');
  s.addText('Q&A', {
    x: 0.95,
    y: 2.4,
    w: 3,
    h: 0.7,
    fontSize: 54,
    color: COLORS.ink,
    bold: true,
  });
  s.addText('项目文件：docs/Finyx-Investor-Deck-CN.pptx', {
    x: 0.95,
    y: 5.6,
    w: 6,
    h: 0.3,
    fontSize: 12,
    color: COLORS.muted,
  });

  return pptx;
}

function buildEN() {
  const pptx = createDeck({
    lang: 'en-US',
    subject: 'Investor Pitch',
    title: 'Finyx Wallet Studio Investor Deck',
  });

  coverEN(pptx);

  let s = pptx.addSlide();
  base(s, 'What We Are Building', 'Positioning and value proposition');
  bullets(s, [
    'Finyx is a brandable wallet + payment + AI-agent stack for Web3 product teams.',
    'Core value: unify login, balances, payments, and support workflows in one operating surface.',
    'Built on Crossmint infrastructure to reduce wallet/security/payment integration overhead.',
    'Current codebase already delivers an MVP-ready end-to-end flow for pilot deployments.',
  ]);

  s = pptx.addSlide();
  base(s, 'Problem and Timing', 'Why now');
  bullets(s, [
    'Wallet experiences are fragmented across auth, funding, payments, and support systems.',
    'Enterprise integration remains expensive due to security/compliance complexity.',
    'User expectation is shifting toward conversational, AI-assisted operations.',
    'Opportunity: combine wallet infrastructure with agent orchestration for higher conversion and lower ops cost.',
  ]);

  s = pptx.addSlide();
  base(s, 'Product Readiness', 'Capabilities already implemented');
  bullets(s, [
    'Wallet & auth: Crossmint-powered login and session restoration paths.',
    'Payments: Intent/Delegation/Receipt flow with HTTP 402 payment-gate behavior.',
    'Agent system: routing, streaming chat, tool calls, and local RAG support.',
    'Operational layer: email OTP, async queue worker, activity feeds, and user profile flows.',
  ]);

  addAgentDetailedEN(pptx);

  s = pptx.addSlide();
  base(s, 'Technical Moats', 'Why this architecture can scale');
  bullets(s, [
    'Runtime portability: VoltAgent and LangChain supported behind one runtime contract.',
    'Retrieval portability: local sqlite-vec and MCP-based backends can be switched by config.',
    'Integration standards: App Router APIs + MCP tool protocol for extensibility.',
    'Deployment readiness: full dev/init/all/shutdown scripts for reproducible environments.',
  ]);

  s = pptx.addSlide();
  base(s, 'Commercial Path', 'How this turns into revenue');
  bullets(s, [
    'Phase 1: implementation services for teams adopting wallet + payment + agent workflows.',
    'Phase 2: managed platform pricing by MAU, transaction volume, and agent usage.',
    'Phase 3: vertical templates (commerce, gaming, cross-border) to speed repeatable sales.',
    'Phase 4: channel partnerships with payment and SaaS ecosystems.',
  ]);

  s = pptx.addSlide();
  base(s, 'Milestones', 'Execution plan');
  bullets(s, [
    'Done: MVP-grade technical loop across web, APIs, agent runtime, RAG, and payment rail.',
    'Next: test coverage, observability, security hardening, and controlled pilot rollout.',
    'Business milestone: validate conversion, retention, and payment success with lighthouse customers.',
    'Funding focus: productization, compliance, go-to-market, and key hiring.',
  ]);

  s = pptx.addSlide();
  base(s, 'Risks and Mitigation', 'Execution risk control');
  bullets(s, [
    'Security/compliance: enforce production secret policy + structured audit trails.',
    'Reliability: health checks and restart strategy for agent and worker processes.',
    'Cost profile: dynamic mode switching between local-rag and hosted inference.',
    'Speed: ship vertical starter kits to avoid repeated custom builds.',
  ]);

  s = pptx.addSlide();
  base(s, 'Fundraising Ask (Template)', 'Replace with your target figures');
  bullets(s, [
    'Round target: replace this line with your amount, stage, and valuation range.',
    'Suggested budget split: 40% product, 25% GTM, 20% compliance/security, 15% operations.',
    '18-month goal: productized platform, lighthouse customers, repeatable sales motion.',
    'Next revision can include your actual financial model (revenue, burn, CAC/LTV).',
  ]);

  s = pptx.addSlide();
  base(s, 'Thank You', 'Finyx Wallet Studio · Investor Deck');
  s.addText('Q&A', {
    x: 0.95,
    y: 2.4,
    w: 3,
    h: 0.7,
    fontSize: 54,
    color: COLORS.ink,
    bold: true,
  });
  s.addText('File: docs/Finyx-Investor-Deck-EN.pptx', {
    x: 0.95,
    y: 5.6,
    w: 4.8,
    h: 0.3,
    fontSize: 12,
    color: COLORS.muted,
  });

  return pptx;
}

const cnDeck = buildCN();
await cnDeck.writeFile({ fileName: 'docs/Finyx-Investor-Deck-CN.pptx' });

const enDeck = buildEN();
await enDeck.writeFile({ fileName: 'docs/Finyx-Investor-Deck-EN.pptx' });

console.log('Generated: docs/Finyx-Investor-Deck-CN.pptx');
console.log('Generated: docs/Finyx-Investor-Deck-EN.pptx');
