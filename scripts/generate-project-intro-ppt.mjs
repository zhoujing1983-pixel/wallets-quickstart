import pptxgen from 'pptxgenjs';

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Codex';
pptx.company = 'Finyx Wallet Studio';
pptx.subject = 'Project Introduction';
pptx.title = 'Finyx Wallet Studio 项目介绍';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Aptos Display',
  bodyFontFace: 'Aptos',
  lang: 'zh-CN',
};

const C = {
  bg: 'F7FAFC',
  panel: 'FFFFFF',
  title: '0F172A',
  body: '334155',
  muted: '64748B',
  primary: '0EA5E9',
  accent: '14B8A6',
  dark: '0B1120',
  ok: '16A34A',
  warn: 'F59E0B',
};

function baseSlide(slide, title, subtitle = '') {
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.65,
    fill: { color: C.dark },
    line: { color: C.dark },
  });
  slide.addText('Finyx Wallet Studio', {
    x: 0.5,
    y: 0.18,
    w: 4.2,
    h: 0.3,
    fontSize: 12,
    color: 'E2E8F0',
    bold: true,
  });
  slide.addText(title, {
    x: 0.7,
    y: 0.9,
    w: 9.8,
    h: 0.6,
    fontSize: 30,
    color: C.title,
    bold: true,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.7,
      y: 1.5,
      w: 11.8,
      h: 0.4,
      fontSize: 14,
      color: C.muted,
    });
  }
}

function addBulletList(slide, items, x = 0.95, y = 2.0, w = 11.7, h = 4.6, fontSize = 20) {
  const text = items.map((t) => ({ text: t, options: { bullet: { indent: 18 } } }));
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontSize,
    color: C.body,
    breakLine: true,
    paraSpaceAfterPt: 14,
  });
}

let s = pptx.addSlide();
s.background = { color: C.dark };
s.addShape(pptx.ShapeType.roundRect, {
  x: 0.75,
  y: 0.7,
  w: 11.8,
  h: 5.5,
  rectRadius: 0.08,
  fill: { color: '111827', transparency: 5 },
  line: { color: '1E293B', pt: 1 },
});
s.addText('Finyx Wallet Studio', {
  x: 1.2,
  y: 1.35,
  w: 8.5,
  h: 0.8,
  fontSize: 44,
  color: 'F8FAFC',
  bold: true,
});
s.addText('工程介绍与架构解析', {
  x: 1.2,
  y: 2.3,
  w: 8.5,
  h: 0.5,
  fontSize: 22,
  color: 'BAE6FD',
  bold: true,
});
s.addShape(pptx.ShapeType.line, {
  x: 1.2,
  y: 3.0,
  w: 5.2,
  h: 0,
  line: { color: C.primary, pt: 2.5 },
});
s.addText('基于 Next.js + Crossmint + Agent Runtime', {
  x: 1.2,
  y: 3.25,
  w: 8.0,
  h: 0.4,
  fontSize: 16,
  color: 'CBD5E1',
});
s.addText('生成时间：2026-03-31', {
  x: 1.2,
  y: 5.45,
  w: 4.0,
  h: 0.3,
  fontSize: 12,
  color: '94A3B8',
});
s.addShape(pptx.ShapeType.roundRect, {
  x: 9.4,
  y: 1.5,
  w: 2.6,
  h: 3.5,
  rectRadius: 0.08,
  fill: { color: '0EA5E9', transparency: 82 },
  line: { color: '38BDF8', transparency: 40 },
});
s.addText('Intro Deck', {
  x: 9.8,
  y: 3.1,
  w: 1.8,
  h: 0.4,
  fontSize: 18,
  color: 'E0F2FE',
  align: 'center',
  bold: true,
});

s = pptx.addSlide();
baseSlide(s, '1. 项目定位与范围', '当前代码仓库快照（wallets-quickstart）');
addBulletList(s, [
  '定位：Finyx 品牌化钱包体验，底层由 Crossmint Auth + Wallet 基础设施支撑。',
  '前端：Next.js App Router（React 19），支持默认页面与 /finyx 独立体验。',
  '后端：26 个 API 路由，覆盖钱包、支付、邮件 OTP、Agent Chat、用户信息。',
  '智能体：可切换 VoltAgent / LangChain 运行时，支持 local-rag / hybrid / voltagent 三种代理模式。',
  '数据与中间件：SQLite（本地向量库）、Redis（队列）、Postgres+pgvector（可选）、RabbitMQ（容器预置）。',
]);

s = pptx.addSlide();
baseSlide(s, '2. 核心能力地图', '从业务视角看工程已具备的功能面');
const cards = [
  ['钱包与认证', 'Crossmint 嵌入式认证\nEmail 会话\n多入口登录态'],
  ['资产与转账', '余额查询\n转账\n提现\n活动流水'],
  ['支付链路', 'Intent/Delegation/Receipt\nProvider 验签\n402 付费访问'],
  ['Agent 能力', '聊天路由\n工具调用\n本地 RAG\n工作流编排'],
  ['邮件 OTP', '验证码发送\n限频\n校验\nCookie 会话'],
  ['运维与脚本', '一键 dev:all\ndocker compose\nagent runtime 脚本'],
];
let cx = 0.9;
let cy = 2.0;
for (let i = 0; i < cards.length; i += 1) {
  const [t, d] = cards[i];
  s.addShape(pptx.ShapeType.roundRect, {
    x: cx,
    y: cy,
    w: 3.95,
    h: 1.45,
    rectRadius: 0.06,
    fill: { color: C.panel },
    line: { color: 'CBD5E1', pt: 1 },
    shadow: { type: 'outer', color: '94A3B8', blur: 2, angle: 45, distance: 1, opacity: 0.08 },
  });
  s.addText(t, {
    x: cx + 0.25,
    y: cy + 0.18,
    w: 3.4,
    h: 0.3,
    fontSize: 16,
    color: C.title,
    bold: true,
  });
  s.addText(d, {
    x: cx + 0.25,
    y: cy + 0.52,
    w: 3.4,
    h: 0.75,
    fontSize: 12,
    color: C.body,
    valign: 'top',
  });
  cx += 4.2;
  if ((i + 1) % 3 === 0) {
    cx = 0.9;
    cy += 1.7;
  }
}

s = pptx.addSlide();
baseSlide(s, '3. 技术架构总览', 'Web + API + Agent + 基础设施');
const box = (x, y, w, h, title, sub, color = 'E2E8F0') => {
  s.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.04,
    fill: { color: color },
    line: { color: '94A3B8', pt: 1 },
  });
  s.addText(title, {
    x: x + 0.15,
    y: y + 0.1,
    w: w - 0.3,
    h: 0.25,
    fontSize: 13,
    bold: true,
    color: C.title,
    align: 'center',
  });
  s.addText(sub, {
    x: x + 0.15,
    y: y + 0.4,
    w: w - 0.3,
    h: h - 0.5,
    fontSize: 11,
    color: C.body,
    align: 'center',
    valign: 'mid',
  });
};
box(0.8, 2.1, 2.5, 1.2, '前端层', 'Next.js App Router\nDashboard / Onramp / 402\nAgent Chat Widget', 'DBEAFE');
box(3.8, 2.1, 2.5, 1.2, 'API 层', '/api/auth/email/*\n/api/billing/*\n/api/agent/*', 'DCFCE7');
box(6.8, 2.1, 2.5, 1.2, 'Agent 层', 'route-service\nruntime factory\nworkflow + tools', 'FCE7F3');
box(9.8, 2.1, 2.5, 1.2, '外部服务', 'Crossmint API\nQwen/OpenAI\nMCP 工具', 'FEF3C7');
box(2.4, 4.2, 3.6, 1.2, '数据与队列', 'SQLite local-rag-vec.db\nRedis(BullMQ)\nPostgres(pgvector)');
box(7.1, 4.2, 3.6, 1.2, '运行进程', 'web + email worker + agent runtime\n通过 concurrently 启动');

const arrow = (x, y, w, h) => s.addShape(pptx.ShapeType.chevron, {
  x, y, w, h,
  fill: { color: '94A3B8' },
  line: { color: '94A3B8' },
});
arrow(3.35, 2.55, 0.35, 0.28);
arrow(6.35, 2.55, 0.35, 0.28);
arrow(9.35, 2.55, 0.35, 0.28);

s = pptx.addSlide();
baseSlide(s, '4. 用户与钱包主流程', '从登录到资产管理的核心闭环');
addBulletList(s, [
  '1) 用户进入页面：`src/app/(default)/page.tsx` 根据钱包和认证状态切换 Landing / Dashboard。',
  '2) 登录方式：Crossmint EmbeddedAuthForm + FinyxAuthPanel，支持标准钱包态与 email session 态。',
  '3) Dashboard：展示地址、余额、交易活动，并支持转账、提现、用户信息维护。',
  '4) Email Dashboard：通过 `/api/auth/email/session` + `/api/auth/email/wallet` 恢复会话与钱包。',
  '5) API 对接：通过服务端路由调用 Crossmint，避免将敏感 server key 暴露到前端。',
], 0.95, 2.0, 11.4, 4.8, 18);

s = pptx.addSlide();
baseSlide(s, '5. 402 支付与账单流程', 'Payment Intent + Receipt 验签 + Provider 访问控制');
addBulletList(s, [
  '入口页面：`/finyx/(dashboard)/402`，演示 Agent 驱动的自动支付体验。',
  '`/api/billing/intent`：生成 intent_message + intent_token（HMAC 签名，10 分钟有效期）。',
  '`/api/billing/delegation*`：处理授权挑战与委托签名流程。',
  '`/api/billing/receipt`：签发收据；`/api/provider`：校验 receipt 合法性，决定是否授予访问。',
  '当缺少收据时返回 HTTP 402，引导客户端先完成支付，再重放原请求。',
], 0.95, 2.0, 11.4, 4.8, 18);

s = pptx.addSlide();
baseSlide(s, '6. Agent 与本地 RAG 流程', '支持可配置路由、检索与回退策略');
addBulletList(s, [
  '请求入口：`/api/agent/chat`，支持 stream/non-stream，兼容旧版 Think Header。',
  '路由编排：`route-service.ts` 按关键字规则、简单闲聊规则、workflow 判定选择执行链路。',
  '运行时工厂：`runtime/factory.ts` 依据 `AGENT_FRAMEWORK` 切换 VoltAgent 或 LangChain。',
  '检索能力：SQLite + sqlite-vec 构建本地向量检索，支持 `local-rag` / `hybrid` 模式。',
  '工具扩展：内置 local-rag-tool、weather-mcp、duffel-flight-tool，可按 MCP 接入更多能力。',
], 0.95, 2.0, 11.4, 4.8, 18);

s = pptx.addSlide();
baseSlide(s, '7. 邮件 OTP 与异步任务', '兼顾安全校验与吞吐能力');
addBulletList(s, [
  '`/api/auth/email/send`：校验邮箱、生成 6 位 OTP、限制重发频率。',
  '发送策略：优先写入 BullMQ（Redis）队列；队列不可用时回退到直连 SMTP。',
  '`/api/auth/email/verify`：验证成功后写入 `finyx_email` HttpOnly Cookie（7 天）。',
  '`scripts/email-worker.ts`：独立 worker 消费队列，解耦主请求链路。',
  '价值：降低邮件发送抖动对用户请求的影响，并便于后续扩展审计和重试。',
], 0.95, 2.0, 11.4, 4.8, 18);

s = pptx.addSlide();
baseSlide(s, '8. 工程结构与运行方式', '面向开发协作的目录划分与脚本体系');
addBulletList(s, [
  '目录分层：`src/app`(页面+API) / `src/components`(UI) / `src/lib`(业务工具) / `src/agent`(智能体体系)。',
  '仓库规模（当前）：7 个页面入口、26 个 API 路由、19 个核心组件、54 个 Agent 相关文件。',
  '核心命令：`npm run dev` 同时启动 web + email worker + agent runtime。',
  '一键环境：`npm run dev:init`、`npm run dev:all`、`npm run dev-shutdown`。',
  '容器依赖：Redis / RabbitMQ / Postgres(pgvector) 由 `docker-compose.yml` 管理。',
], 0.95, 2.0, 11.4, 4.8, 18);

s = pptx.addSlide();
baseSlide(s, '9. 当前风险与优化建议', '可作为下一阶段迭代的输入');
const riskItems = [
  ['配置风险', '部分密钥存在默认兜底值（如 billing secret），建议生产强制注入并启动前校验。', C.warn],
  ['安全与审计', '建议补充支付/委托链路的审计日志结构化落盘，便于追责与回放。', C.warn],
  ['稳定性', 'Agent 与邮件能力已拆分进程，下一步建议加健康探针与自动重启策略。', C.ok],
  ['质量保障', '建议为关键 API（email、billing、agent）补集成测试与契约测试。', C.primary],
];
let ry = 2.0;
for (const [t, d, c] of riskItems) {
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.9,
    y: ry,
    w: 11.6,
    h: 0.95,
    rectRadius: 0.04,
    fill: { color: 'FFFFFF' },
    line: { color: 'CBD5E1', pt: 1 },
  });
  s.addShape(pptx.ShapeType.rect, {
    x: 0.9,
    y: ry,
    w: 0.14,
    h: 0.95,
    fill: { color: c },
    line: { color: c },
  });
  s.addText(t, {
    x: 1.2,
    y: ry + 0.12,
    w: 2.0,
    h: 0.24,
    fontSize: 14,
    bold: true,
    color: C.title,
  });
  s.addText(d, {
    x: 3.1,
    y: ry + 0.12,
    w: 9.1,
    h: 0.6,
    fontSize: 13,
    color: C.body,
    valign: 'top',
  });
  ry += 1.15;
}

s = pptx.addSlide();
baseSlide(s, '10. 总结', '这是一个可直接二次开发的完整 Web3 钱包样板工程');
addBulletList(s, [
  '业务完整：认证、钱包、转账、支付、Agent、RAG、邮件 OTP 链路均已打通。',
  '技术可扩展：Agent 运行时与检索后端可插拔，支持从本地能力逐步升级到线上服务。',
  '工程可运维：脚本与容器化依赖齐备，适合本地开发、演示环境与小规模试点。',
  '建议下一步：围绕支付与 Agent 路径补齐自动化测试、观测与安全基线。',
], 0.95, 2.0, 11.4, 3.9, 18);
s.addShape(pptx.ShapeType.roundRect, {
  x: 0.95,
  y: 5.45,
  w: 5.5,
  h: 0.65,
  rectRadius: 0.05,
  fill: { color: 'E0F2FE' },
  line: { color: '7DD3FC' },
});
s.addText('Deck 文件：docs/Finyx-Wallet-Studio-项目介绍.pptx', {
  x: 1.15,
  y: 5.65,
  w: 5.1,
  h: 0.25,
  fontSize: 12,
  color: '0C4A6E',
  bold: true,
});

await pptx.writeFile({ fileName: 'docs/Finyx-Wallet-Studio-项目介绍.pptx' });
console.log('PPT generated: docs/Finyx-Wallet-Studio-项目介绍.pptx');
