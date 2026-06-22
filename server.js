const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { URL } = require("url");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const PREFERRED_DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const FALLBACK_DATA_DIR = path.join(__dirname, "data");
let resolvedDataDir = null;
const SESSION_COOKIE = "novel_sid";
const API_PROVIDER = (process.env.API_PROVIDER || "openai").toLowerCase();
const API_BASE_URL = normalizeBaseUrl(
  process.env.API_BASE_URL ||
    (API_PROVIDER === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1")
);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || (
  API_PROVIDER === "deepseek" ? "deepseek-v4-flash" : "gpt-5.4-mini"
);
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "owner@novel.local");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-admin-password";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const LOGIN_CODE_TTL_MS = 1000 * 60 * 10;
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "";
const RECHARGE_PACKAGES = [
  {
    id: "starter",
    name: "入门包",
    priceCny: 19.9,
    credits: 200,
    bonusCredits: 0,
    description: "适合轻度体验，一句话成书和短篇测试更轻松。"
  },
  {
    id: "creator",
    name: "创作包",
    priceCny: 59.9,
    credits: 720,
    bonusCredits: 80,
    description: "适合稳定创作，覆盖更多续写、扩写和日常出稿。"
  },
  {
    id: "studio",
    name: "工作室包",
    priceCny: 129,
    credits: 1700,
    bonusCredits: 300,
    description: "适合重度长篇创作和多轮打磨，性价比最高。"
  }
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeBaseUrl(rawUrl) {
  return rawUrl.replace(/\/+$/, "");
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

async function readStaticFile(filePath) {
  return fs.promises.readFile(filePath);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    if (!rawKey) {
      continue;
    }
    cookies[rawKey] = decodeURIComponent(rawValueParts.join("=") || "");
  }
  return cookies;
}

function createCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  parts.push("SameSite=Lax");
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clearCookie(name) {
  return createCookie(name, "", { maxAge: 0 });
}

function randomId() {
  return crypto.randomUUID();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const digest = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalDigest] = String(storedHash || "").split(":");
  if (!salt || !originalDigest) {
    return false;
  }
  const digest = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(originalDigest));
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeSubscription(value) {
  return value === "pro" ? "pro" : "basic";
}

function sanitizePublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    subscription: normalizeSubscription(user.subscription),
    proEnabledAt: user.proEnabledAt || null,
    upgradeRequestedAt: user.upgradeRequestedAt || null,
    creditBalance: Number(user.creditBalance || 0),
    totalPurchasedCredits: Number(user.totalPurchasedCredits || 0)
  };
}

function cleanJsonBlock(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function safeParseModelJson(text) {
  try {
    return JSON.parse(cleanJsonBlock(text));
  } catch (error) {
    return null;
  }
}

function compactText(value, maxLength = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function uniqueTextList(values, maxItems = 8, maxLength = 160) {
  const seen = new Set();
  const result = [];

  for (const value of Array.isArray(values) ? values : []) {
    const text = compactText(value, maxLength);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function normalizeEdition(value) {
  return value === "pro" ? "pro" : "basic";
}

function isProEdition(payload) {
  return normalizeEdition(payload && payload.edition) === "pro";
}

function userCanUsePro(user) {
  return Boolean(user && (user.role === "admin" || normalizeSubscription(user.subscription) === "pro"));
}

function getRechargePackage(packageId) {
  return RECHARGE_PACKAGES.find((item) => item.id === packageId) || null;
}

function listRechargePackages() {
  return RECHARGE_PACKAGES.map((item) => ({
    ...item,
    totalCredits: Number(item.credits || 0) + Number(item.bonusCredits || 0)
  }));
}

function listViewOfRechargeRequest(request, userMap = new Map()) {
  const owner = userMap.get(request.userId);
  return {
    id: request.id,
    userId: request.userId,
    userEmail: request.userEmail || (owner ? owner.email : ""),
    packageId: request.packageId,
    packageName: request.packageName,
    priceCny: Number(request.priceCny || 0),
    credits: Number(request.credits || 0),
    bonusCredits: Number(request.bonusCredits || 0),
    totalCredits: Number(request.totalCredits || 0),
    status: request.status || "pending",
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    processedAt: request.processedAt || null,
    note: request.note || ""
  };
}

function buildInitialContinuityMemory(plan) {
  return {
    storySoFar: compactText(plan && plan.hook ? plan.hook : "", 240),
    characterStates: Array.isArray(plan && plan.characterCards)
      ? plan.characterCards.map((card) => ({
        name: compactText(card && card.name ? card.name : "未命名角色", 40),
        state: compactText(card && card.role ? card.role : "故事刚开始，状态待展开", 100),
        goal: compactText(card && card.motivation ? card.motivation : "目标待展开", 100),
        relation: compactText(card && card.conflict ? card.conflict : "关系待展开", 100)
      }))
      : [],
    timeline: [],
    openThreads: uniqueTextList([plan && plan.hook ? plan.hook : ""], 6, 120),
    resolvedThreads: [],
    importantObjects: [],
    worldRules: uniqueTextList([plan && plan.worldSummary ? plan.worldSummary : ""], 4, 160)
  };
}

function normalizeContinuityMemory(rawMemory, plan, previousMemory) {
  const baseMemory = previousMemory || buildInitialContinuityMemory(plan);
  const nextMemory = rawMemory && typeof rawMemory === "object" ? rawMemory : {};
  const previousCharacters = Array.isArray(baseMemory.characterStates) ? baseMemory.characterStates : [];
  const rawCharacters = Array.isArray(nextMemory.characterStates) && nextMemory.characterStates.length
    ? nextMemory.characterStates
    : previousCharacters;

  const characterStates = rawCharacters
    .map((item, index) => {
      const fallback = previousCharacters[index] || {};
      return {
        name: compactText(item && item.name ? item.name : fallback.name || "未命名角色", 40),
        state: compactText(item && item.state ? item.state : fallback.state || "状态待补充", 120),
        goal: compactText(item && item.goal ? item.goal : fallback.goal || "目标待补充", 120),
        relation: compactText(item && item.relation ? item.relation : fallback.relation || "关系待补充", 120)
      };
    })
    .filter((item) => item.name);

  const timelineSource = Array.isArray(nextMemory.timeline) && nextMemory.timeline.length
    ? nextMemory.timeline
    : (Array.isArray(baseMemory.timeline) ? baseMemory.timeline : []);

  const timeline = timelineSource
    .map((item, index) => ({
      chapterNumber: Number(item && item.chapterNumber) || index + 1,
      event: compactText(item && item.event ? item.event : "", 160)
    }))
    .filter((item) => item.event)
    .slice(-10);

  return {
    storySoFar: compactText(
      nextMemory.storySoFar || baseMemory.storySoFar || (plan && plan.hook) || "",
      260
    ),
    characterStates,
    timeline,
    openThreads: uniqueTextList(
      nextMemory.openThreads || baseMemory.openThreads || [],
      8,
      120
    ),
    resolvedThreads: uniqueTextList(
      nextMemory.resolvedThreads || baseMemory.resolvedThreads || [],
      8,
      120
    ),
    importantObjects: uniqueTextList(
      nextMemory.importantObjects || baseMemory.importantObjects || [],
      8,
      120
    ),
    worldRules: uniqueTextList(
      nextMemory.worldRules || baseMemory.worldRules || [],
      6,
      160
    )
  };
}

function formatContinuityMemory(memory) {
  const normalized = normalizeContinuityMemory(memory, null, memory);

  return [
    `故事当前进度：${normalized.storySoFar || "暂无"}`,
    "",
    "角色状态：",
    ...(normalized.characterStates.length
      ? normalized.characterStates.map((item) =>
        `${item.name}｜状态：${item.state || "暂无"}｜目标：${item.goal || "暂无"}｜关系/矛盾：${item.relation || "暂无"}`
      )
      : ["暂无"]),
    "",
    "已发生关键事件：",
    ...(normalized.timeline.length
      ? normalized.timeline.map((item) => `第${item.chapterNumber}章：${item.event}`)
      : ["暂无"]),
    "",
    `未回收伏笔：${normalized.openThreads.join("；") || "暂无"}`,
    `已解决问题：${normalized.resolvedThreads.join("；") || "暂无"}`,
    `关键道具/线索：${normalized.importantObjects.join("；") || "暂无"}`,
    `世界规则：${normalized.worldRules.join("；") || "暂无"}`
  ].join("\n");
}

function buildMemoryUpdatePrompts(plan, chapter, chapterText, previousMemory) {
  const systemPrompt = [
    "你是一名中文长篇小说的连续性编辑。",
    "你的任务是维护小说记忆档案，确保后续章节不遗忘人物状态、剧情进度和伏笔。",
    "请严格输出合法 JSON，不要输出 Markdown 代码块，不要输出解释。"
  ].join("");

  const userPrompt = [
    "请根据已有记忆和刚写出的章节，输出更新后的记忆 JSON。",
    "JSON 必须包含这些字段：",
    '{"storySoFar":"","characterStates":[{"name":"","state":"","goal":"","relation":""}],"timeline":[{"chapterNumber":1,"event":""}],"openThreads":[""],"resolvedThreads":[""],"importantObjects":[""],"worldRules":[""]}',
    "",
    `小说标题：${plan.title || "未命名"}`,
    `当前章节：第${chapter.chapterNumber}章 ${chapter.title}`,
    "",
    "已有记忆：",
    formatContinuityMemory(previousMemory),
    "",
    "本章正文：",
    chapterText,
    "",
    "要求：",
    "1. storySoFar 只保留到当前章为止的阶段总结。",
    "2. characterStates 重点更新人物状态、目标变化和关系变化。",
    "3. timeline 只保留关键事件，按章节顺序整理。",
    "4. openThreads 保留还没回收的悬念或伏笔。",
    "5. resolvedThreads 记录本章已经解决的问题。",
    "6. importantObjects 只保留关键道具、身份线索或重要地点。"
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function buildFallbackContinuityMemory(previousMemory, plan, chapter) {
  const baseMemory = normalizeContinuityMemory(previousMemory, plan, previousMemory);
  const nextTimeline = [
    ...baseMemory.timeline,
    {
      chapterNumber: Number(chapter.chapterNumber) || baseMemory.timeline.length + 1,
      event: compactText(chapter.summary || `${chapter.title}推进了新的冲突。`, 160)
    }
  ].slice(-10);

  const nextOpenThreads = uniqueTextList(
    [
      ...baseMemory.openThreads,
      chapter.cliffhanger || "",
      chapter.mustInclude || ""
    ],
    8,
    120
  );

  return normalizeContinuityMemory(
    {
      ...baseMemory,
      storySoFar: compactText(
        [baseMemory.storySoFar, chapter.summary].filter(Boolean).join(" "),
        260
      ),
      timeline: nextTimeline,
      openThreads: nextOpenThreads
    },
    plan,
    baseMemory
  );
}

function extractOutputText(responseJson) {
  if (typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  if (!Array.isArray(responseJson.output)) {
    return "";
  }

  const parts = [];
  for (const item of responseJson.output) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        parts.push(contentItem.text);
      }
      if (contentItem.type === "text" && typeof contentItem.text === "string") {
        parts.push(contentItem.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractChatCompletionText(responseJson) {
  const message = responseJson &&
    responseJson.choices &&
    responseJson.choices[0] &&
    responseJson.choices[0].message;

  const text = message && message.content;

  if (typeof text === "string") {
    return text.trim();
  }

  if (Array.isArray(text)) {
    return text
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  if (message && typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content.trim();
  }

  const deltaText = responseJson &&
    responseJson.choices &&
    responseJson.choices[0] &&
    responseJson.choices[0].delta &&
    responseJson.choices[0].delta.content;

  if (typeof deltaText === "string" && deltaText.trim()) {
    return deltaText.trim();
  }

  if (typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  return "";
}

async function callOpenAIResponses({ systemPrompt, userPrompt }) {
  const response = await fetch(`${API_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: systemPrompt
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: userPrompt
            }
          ]
        }
      ]
    })
  });

  const responseText = await response.text();
  const responseJson = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    const message = responseJson.error && responseJson.error.message
      ? responseJson.error.message
      : "OpenAI request failed";
    throw new Error(message);
  }

  const text = extractOutputText(responseJson);
  if (!text) {
    throw new Error("Model returned an empty response");
  }

  return text;
}

async function callOpenAICompatibleChat({ systemPrompt, userPrompt }) {
  const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      stream: false
    })
  });

  const responseText = await response.text();
  const responseJson = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    const message = responseJson.error && responseJson.error.message
      ? responseJson.error.message
      : "Compatible chat request failed";
    throw new Error(message);
  }

  const text = extractChatCompletionText(responseJson);
  if (!text) {
    throw new Error(`Model returned an empty response${responseText ? `: ${responseText.slice(0, 240)}` : ""}`);
  }

  return text;
}

async function callModel(prompts) {
  if (API_PROVIDER === "deepseek") {
    return callOpenAICompatibleChat(prompts);
  }

  return callOpenAIResponses(prompts);
}

function buildAssistPrompts(payload) {
  const actionMap = {
    continue: "续写",
    expand: "扩写",
    rewrite: "改写",
    outline: "生成大纲"
  };

  const actionLabel = actionMap[payload.action] || "续写";
  const systemPrompt = [
    "你是一名专业中文小说编辑与合作作者。",
    "你擅长在保留原有气质的前提下，快速完成高质量创作辅助。",
    "输出直接给可用结果，不要解释你的思路，不要道歉，不要使用项目符号，除非用户要的是大纲。"
  ].join("");

  const userPrompt = [
    `任务类型：${actionLabel}`,
    `当前版本：${isProEdition(payload) ? "专业版" : "基础版"}`,
    `题材/风格：${payload.genre || "未指定"}`,
    `希望保持的文风：${payload.style || "未指定"}`,
    `目标篇幅：${payload.targetLength || "未指定"}`,
    `创作方向：${payload.direction || "未指定"}`,
    `额外约束：${payload.constraints || "无"}`,
    isProEdition(payload) && payload.continuityMemory
      ? `连续记忆档案：\n${formatContinuityMemory(payload.continuityMemory)}`
      : "连续记忆档案：未启用",
    "",
    "原始文本或核心素材：",
    payload.sourceText || "无",
    "",
    actionLabel === "outline"
      ? "请输出一个可直接写作的小说大纲，包含书名建议、故事卖点、主线推进、关键转折和结尾方向。"
      : "请直接输出处理后的正文，保证语言流畅、情绪连贯、人物行为合理，并尽量贴合已有文本气质。"
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function buildAutoPlanPrompts(payload) {
  const chapterCount = Number(payload.chapterCount || 6);
  const chapterLength = Number(payload.chapterLength || 1200);

  const systemPrompt = [
    "你是一名资深中文小说策划与长篇作者。",
    "你的目标是根据设定，生成一部结构完整、节奏清晰、可直接阅读的中文小说。",
    "请严格输出合法 JSON，不要输出 Markdown 代码块，不要输出额外解释。"
  ].join("");

  const userPrompt = [
    "请根据以下设定，生成小说规划 JSON。",
    "JSON 必须包含这些字段：",
    '{"title":"","hook":"","tone":"","worldSummary":"","characterCards":[{"name":"","role":"","motivation":"","conflict":""}],"chapters":[{"chapterNumber":1,"title":"","summary":"","mustInclude":"","cliffhanger":""}]}',
    "",
    `题材：${payload.genre || "未指定"}`,
    `目标受众：${payload.audience || "未指定"}`,
    `叙事视角：${payload.pov || "未指定"}`,
    `整体风格：${payload.style || "未指定"}`,
    `世界观：${payload.world || "未指定"}`,
    `核心设定：${payload.premise || "未指定"}`,
    `人物信息：${payload.characters || "未指定"}`,
    `剧情要求：${payload.plotRequirements || "未指定"}`,
    `禁忌/限制：${payload.constraints || "无"}`,
    `总章节数：${chapterCount}`,
    `每章参考字数：${chapterLength}`,
    "",
    "要求：",
    "1. 章节安排必须完整闭环，从开端推进到结局。",
    "2. 人物动机明确，冲突逐章升级。",
    "3. 适合直接展开写成一部完整小说。"
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function buildChapterPrompts(payload, plan, chapter, previousSummary, continuityMemory, previousChapterText) {
  const systemPrompt = [
    "你是一名专业中文小说作者。",
    "请根据给定总纲与章节任务，直接写出可阅读的小说正文。",
    "必须重视戏剧冲突、场景感、人物心理和结尾推进感。",
    "你必须严格服从连续记忆档案，避免人物状态、伏笔和事件顺序前后矛盾。"
  ].join("");

  const userPrompt = [
    `小说标题：${plan.title}`,
    `当前版本：${isProEdition(payload) ? "专业版" : "基础版"}`,
    `故事钩子：${plan.hook}`,
    `整体氛围：${plan.tone}`,
    `世界观摘要：${plan.worldSummary}`,
    `题材：${payload.genre || "未指定"}`,
    `叙事视角：${payload.pov || "未指定"}`,
    `写作风格：${payload.style || "未指定"}`,
    `本章目标字数：${payload.chapterLength || 1200}`,
    "",
    "主要角色：",
    (Array.isArray(plan.characterCards) ? plan.characterCards : [])
      .map((card) => `${card.name}｜${card.role}｜动机：${card.motivation}｜冲突：${card.conflict}`)
      .join("\n"),
    "",
    ...(continuityMemory
      ? ["连续记忆档案：", formatContinuityMemory(continuityMemory), ""]
      : ["连续记忆档案：未启用", ""]),
    `上一章进度摘要：${previousSummary || "这是第一章。"}`,
    previousChapterText
      ? `上一章正文尾段参考：${String(previousChapterText).slice(-600)}`
      : "上一章正文尾段参考：这是第一章。",
    `当前章节：第${chapter.chapterNumber}章 ${chapter.title}`,
    `本章概要：${chapter.summary}`,
    `必须出现：${chapter.mustInclude}`,
    `章末推进：${chapter.cliffhanger}`,
    "",
    "请直接输出本章正文，保留章节标题。"
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function buildAutoFinalText(plan, chapters) {
  const chapterList = plan.chapters
    .map((chapter) => `第${chapter.chapterNumber}章 ${chapter.title}`)
    .join("\n");

  return [
    `书名：${plan.title}`,
    "",
    `故事钩子：${plan.hook}`,
    `整体氛围：${plan.tone}`,
    "",
    "人物卡：",
    ...(plan.characterCards || []).map((card) =>
      `${card.name}｜${card.role}｜动机：${card.motivation}｜冲突：${card.conflict}`
    ),
    "",
    "章节目录：",
    chapterList,
    "",
    "正文：",
    "",
    chapters.join("\n\n")
  ].join("\n");
}

function buildDemoAssist(payload) {
  const actionMap = {
    continue: "续写",
    expand: "扩写",
    rewrite: "改写",
    outline: "大纲"
  };
  const title = actionMap[payload.action] || "续写";

  return [
    `【演示模式｜${title}结果】`,
    "",
    `题材建议：${payload.genre || "都市 / 奇幻混合"}`,
    `风格参考：${payload.style || "节奏利落、情绪浓度高"}`,
    "",
    payload.action === "outline"
      ? "书名建议：《雾城之夜》\n故事卖点：普通人误入异能组织，在连续选择中完成自我成长。\n主线推进：发现异常 -> 被迫入局 -> 关系反转 -> 真相揭晓 -> 代价式胜利。\n结尾方向：主角守住重要之物，但失去原有生活。"
      : "夜风从巷口灌进来的时候，他终于意识到，自己一直躲避的不是那通电话，而是电话背后那个人会带来的答案。他把手从门把上慢慢收回来，像是收回一段早就该结束的人生。楼下的霓虹还在闪，雨水沿着招牌往下淌，像谁没有说完的话。"
  ].join("\n");
}

function buildDemoPlan(payload) {
  const chapterCount = Number(payload.chapterCount || 6);

  return {
    title: payload.premise ? `《${payload.premise.slice(0, 12)}》` : "《星火不熄》",
    hook: "一个被命运推着前进的普通人，在更大的阴谋中决定自己要成为什么样的人。",
    tone: payload.style || "剧情强推进、情绪克制但有张力",
    worldSummary: payload.world || "近未来都市与隐秘组织并存的世界。",
    characterCards: [
      {
        name: "林知遥",
        role: "主角",
        motivation: "想保护仅剩的家人与体面生活",
        conflict: "越想退出，越被推向事件中心"
      },
      {
        name: "顾沉",
        role: "关键盟友",
        motivation: "查清旧案真相",
        conflict: "对主角有所利用，也逐渐产生信任"
      }
    ],
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      chapterNumber: index + 1,
      title: `转折 ${index + 1}`,
      summary: `主角在第 ${index + 1} 章面对新的线索与代价，局势持续升级。`,
      mustInclude: "有效冲突、角色选择、信息推进",
      cliffhanger: "留下一处新的危机或悬念"
    }))
  };
}

function buildDemoChapter(plan, chapter) {
  return [
    `第${chapter.chapterNumber}章 ${chapter.title}`,
    "",
    `${plan.title.replace(/[《》]/g, "")}的故事在这里进入新的阶段。主角被迫做出选择，而每一次选择都在改变他与周围人的关系。空气里潜伏的危险越来越清晰，过去隐藏的问题也一点点浮出水面。`,
    "他明白自己已经没有退路，只能继续向前。可真正让他不安的，不是眼前的敌意，而是他开始发现，自己也许正在变成曾经最讨厌的那种人。",
    `章末时，新的线索将故事推进到下一章：${chapter.cliffhanger}。`
  ].join("\n");
}

function buildWorkTitle(payload, result, plan) {
  if (plan && typeof plan.title === "string" && plan.title.trim()) {
    return plan.title.trim();
  }

  if (payload.mode === "assist") {
    const actionLabel = {
      continue: "续写",
      expand: "扩写",
      rewrite: "改写",
      outline: "大纲"
    }[payload.action] || "创作";
    const suffix = payload.genre ? `｜${payload.genre}` : "";
    return `${actionLabel}作品${suffix}`;
  }

  if (payload.premise && payload.premise.trim()) {
    return payload.premise.trim().slice(0, 24);
  }

  const firstLine = String(result || "")
    .split("\n")
    .find((line) => line.trim());
  return firstLine ? firstLine.trim().slice(0, 24) : "未命名作品";
}

function getNowIso() {
  return new Date().toISOString();
}

async function ensureDataFile() {
  if (!resolvedDataDir) {
    const candidateDirs = [PREFERRED_DATA_DIR];
    if (FALLBACK_DATA_DIR !== PREFERRED_DATA_DIR) {
      candidateDirs.push(FALLBACK_DATA_DIR);
    }

    let lastError = null;
    for (const candidateDir of candidateDirs) {
      try {
        await fs.promises.mkdir(candidateDir, { recursive: true });
        await fs.promises.access(candidateDir, fs.constants.W_OK);
        resolvedDataDir = candidateDir;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!resolvedDataDir) {
      throw lastError || new Error("No writable data directory available");
    }
  }

  const dataFile = path.join(resolvedDataDir, "app-data.json");
  try {
    await fs.promises.access(dataFile);
  } catch (error) {
    await fs.promises.writeFile(
      dataFile,
      JSON.stringify({ users: [], sessions: [], works: [], emailCodes: [], rechargeRequests: [] }, null, 2),
      "utf8"
    );
  }

  return dataFile;
}

async function readData() {
  const dataFile = await ensureDataFile();
  const raw = await fs.promises.readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw || '{"users":[],"sessions":[],"works":[],"emailCodes":[],"rechargeRequests":[]}');
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    works: Array.isArray(parsed.works) ? parsed.works : [],
    emailCodes: Array.isArray(parsed.emailCodes) ? parsed.emailCodes : [],
    rechargeRequests: Array.isArray(parsed.rechargeRequests) ? parsed.rechargeRequests : []
  };
}

async function writeData(data) {
  const dataFile = await ensureDataFile();
  await fs.promises.writeFile(dataFile, JSON.stringify(data, null, 2), "utf8");
}

function buildLegacyEmail(rawValue, fallbackPrefix) {
  const normalized = normalizeUsername(rawValue || "");
  if (!normalized) {
    return `${fallbackPrefix}@users.local`;
  }
  if (normalized.includes("@")) {
    return normalizeEmail(normalized);
  }
  return `${normalized}@users.local`;
}

function migrateDataShape(data) {
  for (const user of data.users) {
    if (user.role === "admin") {
      user.email = ADMIN_EMAIL;
      user.username = ADMIN_EMAIL;
      user.subscription = "pro";
      user.proEnabledAt = user.proEnabledAt || user.createdAt || getNowIso();
      user.upgradeRequestedAt = null;
      user.creditBalance = Number(user.creditBalance || 0);
      user.totalPurchasedCredits = Number(user.totalPurchasedCredits || 0);
      continue;
    }

    const email = user.email
      ? normalizeEmail(user.email)
      : buildLegacyEmail(user.username || user.id, `user-${String(user.id || "").slice(0, 8)}`);
    user.email = email;
    user.username = email;
    user.subscription = normalizeSubscription(user.subscription);
    user.proEnabledAt = user.subscription === "pro" ? (user.proEnabledAt || user.createdAt || getNowIso()) : null;
    user.upgradeRequestedAt = user.upgradeRequestedAt || null;
    user.creditBalance = Number(user.creditBalance || 0);
    user.totalPurchasedCredits = Number(user.totalPurchasedCredits || 0);
  }

  const userMap = new Map(data.users.map((user) => [user.id, user]));
  for (const work of data.works) {
    const owner = userMap.get(work.userId);
    const email = owner
      ? owner.email
      : buildLegacyEmail(work.username || work.userId, `user-${String(work.userId || "").slice(0, 8)}`);
    work.userEmail = email;
    work.username = email;
  }

  if (!Array.isArray(data.emailCodes)) {
    data.emailCodes = [];
  }

  if (!Array.isArray(data.rechargeRequests)) {
    data.rechargeRequests = [];
  }

  for (const request of data.rechargeRequests) {
    const pkg = getRechargePackage(request.packageId);
    request.userEmail = request.userEmail || userMap.get(request.userId)?.email || "";
    request.packageName = request.packageName || (pkg ? pkg.name : "自定义充值");
    request.priceCny = Number(request.priceCny || (pkg ? pkg.priceCny : 0));
    request.credits = Number(request.credits || (pkg ? pkg.credits : 0));
    request.bonusCredits = Number(request.bonusCredits || (pkg ? pkg.bonusCredits : 0));
    request.totalCredits = Number(request.totalCredits || (request.credits + request.bonusCredits));
    request.status = request.status || "pending";
    request.note = request.note || "";
    request.updatedAt = request.updatedAt || request.createdAt || getNowIso();
    request.processedAt = request.processedAt || null;
  }
}

function cleanupExpiredEmailCodes(data) {
  const now = Date.now();
  data.emailCodes = (data.emailCodes || []).filter((item) => {
    return new Date(item.expiresAt).getTime() > now;
  });
}

function createNumericCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashShortCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function canSendRealEmail() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

async function sendLoginCodeEmail(email, code) {
  if (!canSendRealEmail()) {
    return {
      mode: "dev"
    };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: "AI 小说工具登录验证码",
    text: `你的登录验证码是 ${code} ，10 分钟内有效。`
  });

  return {
    mode: "smtp"
  };
}

async function bootstrapAdminUser() {
  const data = await readData();
  migrateDataShape(data);
  const admin = data.users.find((user) => user.role === "admin");
  if (admin) {
    admin.email = ADMIN_EMAIL;
    admin.username = ADMIN_EMAIL;
    admin.passwordHash = hashPassword(ADMIN_PASSWORD);
    await writeData(data);
    return;
  }

  data.users.push({
    id: randomId(),
    email: ADMIN_EMAIL,
    username: ADMIN_EMAIL,
    passwordHash: hashPassword(ADMIN_PASSWORD),
    role: "admin",
    createdAt: getNowIso(),
    subscription: "pro",
    proEnabledAt: getNowIso(),
    upgradeRequestedAt: null,
    creditBalance: Number(process.env.ADMIN_INITIAL_CREDITS || 0),
    totalPurchasedCredits: 0
  });

  await writeData(data);
}

function summarizePromptInput(input) {
  if (!input || typeof input !== "object") {
    return "";
  }

  const lines = [];
  if (input.mode === "assist") {
    lines.push(`模式：灵感辅助型`);
    lines.push(`动作：${input.action || "未指定"}`);
    lines.push(`题材：${input.genre || "未指定"}`);
    lines.push(`文风：${input.style || "未指定"}`);
    if (input.sourceText) {
      lines.push(`素材：${String(input.sourceText).slice(0, 120)}`);
    }
  } else {
    lines.push(`模式：全自动生成型`);
    lines.push(`题材：${input.genre || "未指定"}`);
    lines.push(`风格：${input.style || "未指定"}`);
    if (input.premise) {
      lines.push(`核心设定：${String(input.premise).slice(0, 120)}`);
    }
  }
  return lines.join("\n");
}

function buildWorkRecord(payload, generationResult, user) {
  const createdAt = getNowIso();
  const wordCount = String(generationResult.result || "")
    .trim()
    .split(/\s+/)
    .join("")
    .length;

  return {
    id: randomId(),
    userId: user.id,
    userEmail: user.email,
    username: user.email,
    title: buildWorkTitle(payload, generationResult.result, generationResult.plan),
    edition: normalizeEdition(payload.edition),
    mode: payload.mode,
    action: payload.action || null,
    provider: API_PROVIDER,
    model: OPENAI_MODEL,
    demo: generationResult.demo,
    input: payload,
    inputSummary: summarizePromptInput(payload),
    plan: generationResult.plan || null,
    memory: isProEdition(payload) ? (generationResult.memory || payload.continuityMemory || null) : null,
    content: generationResult.result,
    excerpt: String(generationResult.result || "").slice(0, 220),
    wordCount,
    createdAt,
    updatedAt: createdAt
  };
}

function listViewOfWork(work) {
  return {
    id: work.id,
    userId: work.userId,
    userEmail: work.userEmail || work.username,
    title: work.title,
    edition: normalizeEdition(work.edition || (work.memory ? "pro" : "basic")),
    mode: work.mode,
    action: work.action,
    provider: work.provider,
    model: work.model,
    demo: work.demo,
    excerpt: work.excerpt,
    wordCount: work.wordCount,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt
  };
}

function buildStats(works) {
  const assistCount = works.filter((work) => work.mode === "assist").length;
  const autoCount = works.filter((work) => work.mode === "auto").length;
  const totalWords = works.reduce((sum, work) => sum + Number(work.wordCount || 0), 0);

  return {
    totalWorks: works.length,
    assistCount,
    autoCount,
    totalWords,
    latestCreatedAt: works[0] ? works[0].createdAt : null
  };
}

async function getSessionUser(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) {
    return null;
  }

    const data = await readData();
    migrateDataShape(data);
    const now = Date.now();
  const sessions = data.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  if (sessions.length !== data.sessions.length) {
    data.sessions = sessions;
    await writeData(data);
  }

  const session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    return null;
  }

  const user = data.users.find((item) => item.id === session.userId);
  if (!user) {
    return null;
  }

  return sanitizePublicUser(user);
}

async function createSession(res, userId) {
  const data = await readData();
  migrateDataShape(data);
  const session = {
    id: randomId(),
    userId,
    createdAt: getNowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  data.sessions.push(session);
  await writeData(data);
  return {
    "Set-Cookie": createCookie(SESSION_COOKIE, session.id, {
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: process.env.NODE_ENV === "production"
    })
  };
}

async function destroySession(req, res) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) {
    return {
      "Set-Cookie": createCookie(SESSION_COOKIE, "", {
        maxAge: 0,
        secure: process.env.NODE_ENV === "production"
      })
    };
  }

  const data = await readData();
  migrateDataShape(data);
  data.sessions = data.sessions.filter((session) => session.id !== sessionId);
  await writeData(data);
  return {
    "Set-Cookie": createCookie(SESSION_COOKIE, "", {
      maxAge: 0,
      secure: process.env.NODE_ENV === "production"
    })
  };
}

function unauthorized(res, message = "请先登录") {
  sendJson(res, 401, { error: message });
}

function forbidden(res, message = "无权限访问") {
  sendJson(res, 403, { error: message });
}

async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    unauthorized(res);
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return null;
  }
  if (user.role !== "admin") {
    forbidden(res, "只有管理员可以访问后台");
    return null;
  }
  return user;
}

async function handleRegister(req, res) {
  try {
    const payload = await parseRequestBody(req);
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");

    if (!validateEmail(email)) {
      sendJson(res, 400, {
        error: "请输入合法的邮箱地址"
      });
      return;
    }

    if (password.length < 6) {
      sendJson(res, 400, { error: "密码至少需要 6 位" });
      return;
    }

    const data = await readData();
    migrateDataShape(data);
    if (data.users.some((user) => user.email === email)) {
      sendJson(res, 409, { error: "邮箱已存在" });
      return;
    }

    const user = {
      id: randomId(),
      email,
      username: email,
      passwordHash: hashPassword(password),
      role: "user",
      createdAt: getNowIso(),
      subscription: "basic",
      proEnabledAt: null,
      upgradeRequestedAt: null,
      creditBalance: 0,
      totalPurchasedCredits: 0
    };

    data.users.push(user);
    await writeData(data);
    const headers = await createSession(res, user.id);

    sendJson(res, 201, {
      message: "registered",
      user: sanitizePublicUser(user)
    }, headers);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "注册失败" });
  }
}

async function handleLogin(req, res) {
  try {
    const payload = await parseRequestBody(req);
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");
    const data = await readData();
    migrateDataShape(data);
    const user = data.users.find((item) => item.email === email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendJson(res, 401, { error: "邮箱或密码错误" });
      return;
    }

    const headers = await createSession(res, user.id);
    sendJson(res, 200, {
      message: "logged_in",
      user: sanitizePublicUser(user)
    }, headers);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "登录失败" });
  }
}

async function handleSendLoginCode(req, res) {
  try {
    const payload = await parseRequestBody(req);
    const email = normalizeEmail(payload.email);

    if (!validateEmail(email)) {
      sendJson(res, 400, { error: "请输入合法的邮箱地址" });
      return;
    }

    const data = await readData();
    migrateDataShape(data);
    cleanupExpiredEmailCodes(data);

    const code = createNumericCode();
    data.emailCodes = data.emailCodes.filter((item) => item.email !== email || item.purpose !== "login");
    data.emailCodes.unshift({
      id: randomId(),
      email,
      purpose: "login",
      codeHash: hashShortCode(code),
      createdAt: getNowIso(),
      expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString()
    });
    await writeData(data);

    const delivery = await sendLoginCodeEmail(email, code);
    sendJson(res, 200, {
      message: "code_sent",
      delivery: delivery.mode,
      expiresInSeconds: Math.floor(LOGIN_CODE_TTL_MS / 1000),
      code: delivery.mode === "dev" ? code : undefined
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "验证码发送失败" });
  }
}

async function handleLoginByCode(req, res) {
  try {
    const payload = await parseRequestBody(req);
    const email = normalizeEmail(payload.email);
    const code = String(payload.code || "").trim();

    if (!validateEmail(email)) {
      sendJson(res, 400, { error: "请输入合法的邮箱地址" });
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      sendJson(res, 400, { error: "请输入 6 位验证码" });
      return;
    }

    const data = await readData();
    migrateDataShape(data);
    cleanupExpiredEmailCodes(data);

    const matchedCode = data.emailCodes.find((item) => {
      return item.email === email &&
        item.purpose === "login" &&
        item.codeHash === hashShortCode(code);
    });

    if (!matchedCode) {
      sendJson(res, 401, { error: "验证码错误或已过期" });
      return;
    }

    data.emailCodes = data.emailCodes.filter((item) => {
      return !(item.email === email && item.purpose === "login");
    });

    let user = data.users.find((item) => item.email === email);
    let autoRegistered = false;

    if (!user) {
      user = {
        id: randomId(),
        email,
        username: email,
        passwordHash: "",
        role: "user",
        createdAt: getNowIso(),
        subscription: "basic",
        proEnabledAt: null,
        upgradeRequestedAt: null,
        creditBalance: 0,
        totalPurchasedCredits: 0
      };
      data.users.push(user);
      autoRegistered = true;
    }

    await writeData(data);
    const headers = await createSession(res, user.id);
    sendJson(res, 200, {
      message: "logged_in_by_code",
      autoRegistered,
      user: sanitizePublicUser(user)
    }, headers);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "验证码登录失败" });
  }
}

async function handleLogout(req, res) {
  try {
    const headers = await destroySession(req, res);
    sendJson(res, 200, { message: "logged_out" }, headers);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "退出失败" });
  }
}

async function handleCurrentUser(req, res) {
  const user = await getSessionUser(req);
  sendJson(res, 200, { user });
}

async function handleUpgradeRequest(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    if (userCanUsePro(user)) {
      sendJson(res, 200, { message: "already_pro", user });
      return;
    }

    const data = await readData();
    migrateDataShape(data);
    const targetUser = data.users.find((item) => item.id === user.id);
    if (!targetUser) {
      sendJson(res, 404, { error: "User not found" });
      return;
    }

    targetUser.upgradeRequestedAt = targetUser.upgradeRequestedAt || getNowIso();
    await writeData(data);
    sendJson(res, 200, {
      message: "upgrade_requested",
      user: sanitizePublicUser(targetUser)
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "提交升级申请失败" });
  }
}

async function handleGetBilling(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const data = await readData();
    migrateDataShape(data);
    const currentUser = data.users.find((item) => item.id === user.id);
    const recentRequests = data.rechargeRequests
      .filter((item) => item.userId === user.id)
      .slice(0, 10)
      .map((item) => listViewOfRechargeRequest(item));

    sendJson(res, 200, {
      user: sanitizePublicUser(currentUser || user),
      packages: listRechargePackages(),
      requests: recentRequests
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "读取充值中心失败" });
  }
}

async function handleCreateRechargeRequest(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const payload = await parseRequestBody(req);
    const selectedPackage = getRechargePackage(payload.packageId);
    if (!selectedPackage) {
      sendJson(res, 400, { error: "充值套餐不存在" });
      return;
    }

    const data = await readData();
    migrateDataShape(data);
    const currentUser = data.users.find((item) => item.id === user.id);
    if (!currentUser) {
      sendJson(res, 404, { error: "User not found" });
      return;
    }

    const pendingExists = data.rechargeRequests.some((item) => {
      return item.userId === user.id && item.packageId === selectedPackage.id && item.status === "pending";
    });

    if (pendingExists) {
      sendJson(res, 409, { error: "你已经提交过同套餐的待处理申请，请等待管理员确认。" });
      return;
    }

    const now = getNowIso();
    const request = {
      id: randomId(),
      userId: user.id,
      userEmail: currentUser.email,
      packageId: selectedPackage.id,
      packageName: selectedPackage.name,
      priceCny: Number(selectedPackage.priceCny || 0),
      credits: Number(selectedPackage.credits || 0),
      bonusCredits: Number(selectedPackage.bonusCredits || 0),
      totalCredits: Number(selectedPackage.credits || 0) + Number(selectedPackage.bonusCredits || 0),
      status: "pending",
      note: "等待人工确认到账",
      createdAt: now,
      updatedAt: now,
      processedAt: null
    };

    data.rechargeRequests.unshift(request);
    await writeData(data);

    sendJson(res, 201, {
      message: "recharge_requested",
      request: listViewOfRechargeRequest(request)
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "提交充值申请失败" });
  }
}

async function handleAdminSetSubscription(req, res, targetUserId) {
  const admin = await requireAdmin(req, res);
  if (!admin) {
    return;
  }

  try {
    const payload = await parseRequestBody(req);
    const subscription = normalizeSubscription(payload.subscription);
    const data = await readData();
    migrateDataShape(data);
    const targetUser = data.users.find((item) => item.id === targetUserId);

    if (!targetUser) {
      sendJson(res, 404, { error: "User not found" });
      return;
    }

    if (targetUser.role === "admin") {
      sendJson(res, 400, { error: "管理员账号不需要修改专业版权限" });
      return;
    }

    targetUser.subscription = subscription;
    targetUser.proEnabledAt = subscription === "pro" ? (targetUser.proEnabledAt || getNowIso()) : null;
    targetUser.upgradeRequestedAt = null;

    await writeData(data);
    sendJson(res, 200, {
      message: "subscription_updated",
      user: sanitizePublicUser(targetUser)
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "更新专业版权限失败" });
  }
}

async function handleAdminGrantCredits(req, res, targetUserId) {
  const admin = await requireAdmin(req, res);
  if (!admin) {
    return;
  }

  try {
    const payload = await parseRequestBody(req);
    const amount = Math.floor(Number(payload.amount || 0));

    if (!Number.isFinite(amount) || amount <= 0) {
      sendJson(res, 400, { error: "充值数量必须是大于 0 的整数" });
      return;
    }

    const data = await readData();
    migrateDataShape(data);
    const targetUser = data.users.find((item) => item.id === targetUserId);

    if (!targetUser) {
      sendJson(res, 404, { error: "User not found" });
      return;
    }

    if (targetUser.role === "admin") {
      sendJson(res, 400, { error: "管理员账号不需要手动充值" });
      return;
    }

    targetUser.creditBalance = Number(targetUser.creditBalance || 0) + amount;
    targetUser.totalPurchasedCredits = Number(targetUser.totalPurchasedCredits || 0) + amount;

    const now = getNowIso();
    data.rechargeRequests.unshift({
      id: randomId(),
      userId: targetUser.id,
      userEmail: targetUser.email,
      packageId: "admin-manual",
      packageName: "管理员直充",
      priceCny: 0,
      credits: amount,
      bonusCredits: 0,
      totalCredits: amount,
      status: "approved",
      note: `管理员 ${admin.email} 手动充值`,
      createdAt: now,
      updatedAt: now,
      processedAt: now
    });

    await writeData(data);
    sendJson(res, 200, {
      message: "credits_granted",
      user: sanitizePublicUser(targetUser)
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "管理员充值失败" });
  }
}

async function handleAdminProcessRechargeRequest(req, res, requestId) {
  const admin = await requireAdmin(req, res);
  if (!admin) {
    return;
  }

  try {
    const payload = await parseRequestBody(req);
    const action = payload.action === "reject" ? "reject" : "approve";
    const data = await readData();
    migrateDataShape(data);
    const request = data.rechargeRequests.find((item) => item.id === requestId);

    if (!request) {
      sendJson(res, 404, { error: "充值申请不存在" });
      return;
    }

    if (request.status !== "pending") {
      sendJson(res, 400, { error: "这条申请已经处理过了" });
      return;
    }

    const currentUser = data.users.find((item) => item.id === request.userId);
    if (!currentUser) {
      sendJson(res, 404, { error: "充值用户不存在" });
      return;
    }

    request.status = action === "approve" ? "approved" : "rejected";
    request.note = action === "approve" ? "管理员已确认到账并完成充值" : "管理员已拒绝该申请";
    request.updatedAt = getNowIso();
    request.processedAt = request.updatedAt;

    if (action === "approve") {
      currentUser.creditBalance = Number(currentUser.creditBalance || 0) + Number(request.totalCredits || 0);
      currentUser.totalPurchasedCredits = Number(currentUser.totalPurchasedCredits || 0) + Number(request.totalCredits || 0);
    }

    await writeData(data);
    sendJson(res, 200, {
      message: "recharge_processed",
      request: listViewOfRechargeRequest(
        request,
        new Map(data.users.map((item) => [item.id, item]))
      ),
      user: sanitizePublicUser(currentUser)
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "处理充值申请失败" });
  }
}

async function handleAssistMode(payload) {
  if (!OPENAI_API_KEY) {
    return {
      mode: "assist",
      demo: true,
      memory: isProEdition(payload) ? (payload.continuityMemory || null) : null,
      result: buildDemoAssist(payload)
    };
  }
  return {
    mode: "assist",
    demo: false,
    memory: isProEdition(payload) ? (payload.continuityMemory || null) : null,
    result: await callModel(buildAssistPrompts(payload))
  };
}

async function handleAutoMode(payload) {
  let plan;

  if (!OPENAI_API_KEY) {
    plan = buildDemoPlan(payload);
  } else {
    const planText = await callModel(buildAutoPlanPrompts(payload));
    plan = JSON.parse(cleanJsonBlock(planText));
  }

  if (!plan || !Array.isArray(plan.chapters) || plan.chapters.length === 0) {
    throw new Error("未能生成有效章节规划，请调整设定后重试。");
  }

  const useContinuityMemory = isProEdition(payload);
  const chapters = [];
  let continuityMemory = useContinuityMemory ? buildInitialContinuityMemory(plan) : null;
  let previousSummary = "";
  let previousChapterText = "";

  for (const chapter of plan.chapters) {
    if (!OPENAI_API_KEY) {
      const chapterText = buildDemoChapter(plan, chapter);
      chapters.push(chapterText);
      previousSummary = chapter.summary;
      previousChapterText = chapterText;
      if (useContinuityMemory) {
        continuityMemory = buildFallbackContinuityMemory(continuityMemory, plan, chapter);
      }
      continue;
    }

    const chapterText = await callModel(
      buildChapterPrompts(payload, plan, chapter, previousSummary, continuityMemory, previousChapterText)
    );
    chapters.push(chapterText);
    previousSummary = chapter.summary;
    previousChapterText = chapterText;

    if (useContinuityMemory) {
      const memoryText = await callModel(
        buildMemoryUpdatePrompts(plan, chapter, chapterText, continuityMemory)
      ).catch(() => "");
      const parsedMemory = safeParseModelJson(memoryText);
      continuityMemory = parsedMemory
        ? normalizeContinuityMemory(parsedMemory, plan, continuityMemory)
        : buildFallbackContinuityMemory(continuityMemory, plan, chapter);
    }
  }

  return {
    mode: "auto",
    demo: !OPENAI_API_KEY,
    plan,
    memory: useContinuityMemory ? continuityMemory : null,
    result: buildAutoFinalText(plan, chapters)
  };
}

async function handleGenerate(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const payload = await parseRequestBody(req);
    if (!payload || !payload.mode) {
      sendJson(res, 400, { error: "Missing mode" });
      return;
    }

    if (isProEdition(payload) && !userCanUsePro(user)) {
      forbidden(res, "当前账号尚未开通专业版");
      return;
    }

    let result;
    if (payload.mode === "assist") {
      result = await handleAssistMode(payload);
    } else if (payload.mode === "auto") {
      result = await handleAutoMode(payload);
    } else {
      sendJson(res, 400, { error: "Unsupported mode" });
      return;
    }

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Unexpected server error",
      detail: error && error.stack ? String(error.stack).split("\n").slice(0, 3).join(" | ") : null
    });
  }
}

async function handleSaveWork(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const payload = await parseRequestBody(req);
    if (!payload || !payload.input || !payload.generationResult) {
      sendJson(res, 400, { error: "Missing work payload" });
      return;
    }

    const data = await readData();
    const record = buildWorkRecord(payload.input, payload.generationResult, user);
    data.works.unshift(record);
    await writeData(data);

    sendJson(res, 201, { message: "saved", work: listViewOfWork(record) });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to save work" });
  }
}

async function handleListWorks(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const data = await readData();
    const works = user.role === "admin"
      ? data.works
      : data.works.filter((work) => work.userId === user.id);
    sendJson(res, 200, {
      works: works.map(listViewOfWork),
      stats: buildStats(works)
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load works" });
  }
}

async function handleUserProfile(req, res) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const data = await readData();
    migrateDataShape(data);
    const works = data.works.filter((work) => work.userId === user.id);
    const stats = buildStats(works);
    const currentUser = data.users.find((item) => item.id === user.id) || user;
    const rechargeRequests = data.rechargeRequests
      .filter((item) => item.userId === user.id)
      .slice(0, 10)
      .map((item) => listViewOfRechargeRequest(item));

    sendJson(res, 200, {
      user: sanitizePublicUser(currentUser),
      stats: {
        ...stats,
        draftCount: works.length,
        assistCount: works.filter((work) => work.mode === "assist").length,
        autoCount: works.filter((work) => work.mode === "auto").length
      },
      recentWorks: works.slice(0, 6).map(listViewOfWork),
      billing: {
        packages: listRechargePackages(),
        requests: rechargeRequests
      }
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load profile" });
  }
}

async function handleGetWork(req, res, workId) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const data = await readData();
    const work = data.works.find((item) => item.id === workId);
    if (!work) {
      sendJson(res, 404, { error: "Work not found" });
      return;
    }

    if (user.role !== "admin" && work.userId !== user.id) {
      forbidden(res, "不能查看其他用户作品");
      return;
    }

    sendJson(res, 200, { work });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load work" });
  }
}

async function handleDeleteWork(req, res, workId) {
  const user = await requireUser(req, res);
  if (!user) {
    return;
  }

  try {
    const data = await readData();
    const work = data.works.find((item) => item.id === workId);
    if (!work) {
      sendJson(res, 404, { error: "Work not found" });
      return;
    }

    if (user.role !== "admin" && work.userId !== user.id) {
      forbidden(res, "不能删除其他用户作品");
      return;
    }

    const nextWorks = data.works.filter((item) => item.id !== workId);

    data.works = nextWorks;
    await writeData(data);
    sendJson(res, 200, { message: "deleted", stats: buildStats(nextWorks) });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to delete work" });
  }
}

async function handleAdminStats(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) {
    return;
  }

  try {
    const data = await readData();
    sendJson(res, 200, {
      stats: buildStats(data.works),
      latestWorks: data.works.slice(0, 12).map(listViewOfWork),
      users: data.users.map(sanitizePublicUser),
      rechargeRequests: data.rechargeRequests
        .slice(0, 20)
        .map((item) => listViewOfRechargeRequest(item, new Map(data.users.map((userItem) => [userItem.id, userItem]))))
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to load stats" });
  }
}

function handleConfig(res) {
  sendJson(res, 200, {
    hasApiKey: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL,
    provider: API_PROVIDER,
    baseUrl: API_BASE_URL
  });
}

async function serveProtectedPage(req, res, pathname) {
  const user = await getSessionUser(req);

  if (pathname === "/admin.html") {
    if (!user) {
      redirect(res, "/auth.html");
      return true;
    }
    if (user.role !== "admin") {
      redirect(res, "/user.html");
      return true;
    }
  }

  if (pathname === "/user.html") {
    if (!user) {
      redirect(res, "/auth.html");
      return true;
    }
  }

  if (pathname === "/profile.html") {
    if (!user) {
      redirect(res, "/auth.html");
      return true;
    }
  }

  if (pathname === "/billing.html") {
    if (!user) {
      redirect(res, "/auth.html");
      return true;
    }
  }

  if (pathname === "/auth.html" && user) {
    redirect(res, user.role === "admin" ? "/admin.html" : "/user.html");
    return true;
  }

  const resolvedPath = pathname === "/"
    ? path.join(PUBLIC_DIR, "index.html")
    : path.join(PUBLIC_DIR, pathname);

  const normalizedPath = path.normalize(resolvedPath);
  if (!normalizedPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return true;
  }

  try {
    const file = await readStaticFile(normalizedPath);
    const ext = path.extname(normalizedPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
    });
    res.end(file);
  } catch (error) {
    sendJson(res, 404, { error: "Not found" });
  }

  return true;
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/healthz") {
    await ensureDataFile();
    sendJson(res, 200, {
      status: "ok",
      provider: API_PROVIDER,
      model: OPENAI_MODEL,
      dataDir: resolvedDataDir
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    await handleRegister(req, res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    await handleLogin(req, res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/send-login-code") {
    await handleSendLoginCode(req, res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login-code") {
    await handleLoginByCode(req, res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    await handleLogout(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    await handleCurrentUser(req, res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/upgrade-request") {
    await handleUpgradeRequest(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/billing") {
    await handleGetBilling(req, res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/billing/recharge-request") {
    await handleCreateRechargeRequest(req, res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    await handleGenerate(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    handleConfig(res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/works") {
    await handleSaveWork(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/works") {
    await handleListWorks(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/profile") {
    await handleUserProfile(req, res);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/stats") {
    await handleAdminStats(req, res);
    return true;
  }

  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/subscription$/);
  if (adminUserMatch && req.method === "PATCH") {
    await handleAdminSetSubscription(req, res, adminUserMatch[1]);
    return true;
  }

  const adminUserCreditsMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/credits$/);
  if (adminUserCreditsMatch && req.method === "PATCH") {
    await handleAdminGrantCredits(req, res, adminUserCreditsMatch[1]);
    return true;
  }

  const rechargeRequestMatch = url.pathname.match(/^\/api\/admin\/recharge-requests\/([^/]+)$/);
  if (rechargeRequestMatch && req.method === "PATCH") {
    await handleAdminProcessRechargeRequest(req, res, rechargeRequestMatch[1]);
    return true;
  }

  const workMatch = url.pathname.match(/^\/api\/works\/([^/]+)$/);
  if (workMatch && req.method === "GET") {
    await handleGetWork(req, res, workMatch[1]);
    return true;
  }

  if (workMatch && req.method === "DELETE") {
    await handleDeleteWork(req, res, workMatch[1]);
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    const handled = await routeApi(req, res, url);
    if (handled) {
      return;
    }

    if (req.method === "GET") {
      await serveProtectedPage(req, res, url.pathname);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error" });
  }
});

Promise.resolve()
  .then(() => ensureDataFile())
  .then(() => bootstrapAdminUser())
  .then(() => {
    server.listen(PORT, () => {
      console.log(`AI Novel Studio is running on port ${PORT}`);
      console.log(`Data directory: ${resolvedDataDir}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize app data", error);
    process.exit(1);
  });
