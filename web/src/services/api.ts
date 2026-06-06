export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export type Emotion = "happy" | "sad" | "surprise" | "wink" | "neutral" | "angry" | "love";
export type EmotionProfile = Partial<Record<Emotion, string>>;
export type RelationshipMode = "sweet" | "flirty" | "playful" | "mature";

export interface ChatContext {
  relationshipAffinity: "new" | "warm" | "close" | "intimate";
  activeRelationshipMode?: RelationshipMode;
  summary: string;
  userSignals: string[];
  lastEmotion: Emotion;
  turnCount: number;
  updatedAt: string;
}

export interface ChatRequest {
  sessionId: string;
  characterId: string;
  message: string;
  history: Message[];
  relationshipMode?: RelationshipMode;
}

export type ChatMessageRequest = ChatRequest;

export interface ChatResponse {
  sessionId: string;
  characterId: string;
  text: string;
  emotion: Emotion;
  context?: ChatContext;
  audioUrl?: string;
}

export interface StreamDoneResponse {
  sessionId: string;
  characterId: string;
  text: string;
  emotion: Emotion;
  context?: ChatContext;
  audioUrl?: string;
  hasFallback?: boolean;
}

export interface ChatStreamEvents {
  onChunk?: (chunk: { text: string }) => void;
  onEmotion?: (emotion: Emotion) => void;
  onDone?: (payload: StreamDoneResponse) => void;
}

export interface TranscribeResponse {
  text: string;
}

export interface ModelUploadResponse {
  modelUrl: string;
  fileName: string;
  mimeType?: string;
  size: number;
  hasFallback?: boolean;
}

export interface DigitalHuman {
  id: string;
  name: string;
  description: string;
  avatarUrl: string;
  modelUrl?: string;
  emotionProfile?: EmotionProfile;
  avatarType?: "image" | "video";
  avatarVideoProfile?: EmotionProfile;
  personalityTagline?: string;
  relationshipMode?: "sweet" | "flirty" | "playful" | "mature";
  voiceProfile: { provider: "openai" | "azure" | "local"; voice: string };
  defaultMood: Emotion;
}

export interface CreateHumanRequest {
  name: string;
  description: string;
  avatarUrl: string;
  modelUrl?: string;
  avatarType?: "image" | "video";
  voiceProvider?: "openai" | "azure" | "local";
  voice: string;
  defaultMood?: Emotion;
  emotionProfile?: EmotionProfile;
  avatarVideoProfile?: EmotionProfile;
  personalityTagline?: string;
  relationshipMode?: "sweet" | "flirty" | "playful" | "mature";
}

declare global {
  interface Window {
    __DG_API_BASE?: string;
  }
}

const VITE_API_BASE = import.meta.env.VITE_API_URL?.trim();
const WINDOW_API_BASE = typeof window === "undefined" ? "" : window.location.origin;
const GLOBAL_API_BASE = typeof window === "undefined" ? "" : window.__DG_API_BASE;
const FALLBACK_DEV_PORT = "8787";
const HAS_CONFIGURED_API_BASE = Boolean(VITE_API_BASE || GLOBAL_API_BASE);
const LOCAL_HUMANS_KEY = "dg-local-digital-humans-v1";
const LOCAL_CONTEXT_KEY = "dg-local-chat-context-v1";

const BUILT_IN_HUMANS: DigitalHuman[] = [
  {
    id: "lina",
    name: "Lina",
    description: "默认数字人。温柔、开朗，默认可爱的笑容",
    personalityTagline: "温柔可爱，既能认真陪伴，也会轻松撒娇。",
    relationshipMode: "sweet",
    avatarUrl: "/assets/avatars/lina.svg",
    emotionProfile: {
      happy: "/assets/expressions/happy.svg",
      sad: "/assets/expressions/sad.svg",
      surprise: "/assets/expressions/surprise.svg",
      wink: "/assets/expressions/wink.svg",
      neutral: "/assets/expressions/neutral.svg",
      angry: "/assets/expressions/angry.svg",
      love: "/assets/expressions/love.svg"
    },
    voiceProfile: { provider: "local", voice: "browser-zh-CN" },
    defaultMood: "happy"
  },
  {
    id: "moon",
    name: "Moon",
    description: "成熟、细腻，偏感性表达",
    personalityTagline: "成熟感性，善于用共情语言回应并引导对方放松表达。",
    relationshipMode: "playful",
    avatarUrl: "/assets/avatars/moon.svg",
    emotionProfile: {
      happy: "/assets/expressions/happy.svg",
      sad: "/assets/expressions/sad.svg",
      surprise: "/assets/expressions/surprise.svg",
      wink: "/assets/expressions/wink.svg",
      neutral: "/assets/expressions/neutral.svg",
      angry: "/assets/expressions/angry.svg",
      love: "/assets/expressions/love.svg"
    },
    voiceProfile: { provider: "local", voice: "browser-zh-CN" },
    defaultMood: "wink"
  }
];

const localEmotionKeywords: Record<Emotion, string[]> = {
  happy: ["开心", "高兴", "喜欢", "棒", "好", "哈哈", "快乐", "great", "nice", "cool"],
  sad: ["难过", "伤心", "失落", "烦", "哭", "心碎", "失望", "sad"],
  surprise: ["惊讶", "真的吗", "怎么", "哇", "天啊", "不可思议", "wow"],
  wink: ["撩", "调皮", "开玩笑", "可爱", "坏", "flirty", "暧昧"],
  neutral: [],
  angry: ["生气", "愤怒", "气死", "讨厌", "烦躁", "annoyed", "hate"],
  love: ["想你", "宝贝", "亲爱", "抱抱", "亲亲", "kiss", "爱你", "恋爱", "心动"]
};

const localModeLine: Record<RelationshipMode, Record<Emotion, string>> = {
  sweet: {
    happy: "你开心的时候我也会被带着笑起来。",
    sad: "我先陪你待一会儿，不急着让你马上变好。",
    surprise: "这个反转有点突然，我想听你继续说。",
    wink: "你这句有点调皮，我接住了。",
    neutral: "我在这儿，慢慢聊就好。",
    angry: "我先听你把情绪说完，再一起理清楚。",
    love: "你这样说我会有点心软，也会更想靠近你。"
  },
  flirty: {
    happy: "你这么开心，我也想靠近一点听你多说几句。",
    sad: "别一个人扛着，先把难过放我这里。",
    surprise: "你这一下挺会吊我胃口的。",
    wink: "你这句有点会撩，我可没有装作没听见。",
    neutral: "我喜欢你这样慢慢打开话题。",
    angry: "先别急着爆炸，把火气交给我一点。",
    love: "你说想我，我会心动；想抱抱的话，我也想抱抱你。"
  },
  playful: {
    happy: "这份开心我收下了，今天你负责说，我负责陪你笑。",
    sad: "先暂停难过十秒，我陪你把它讲成一个能过去的故事。",
    surprise: "剧情突然升级，我要认真听后续。",
    wink: "你这点小坏心思还挺可爱。",
    neutral: "要不要换个轻松点的角度聊？",
    angry: "这小脾气我记下了，但我还是站你这边。",
    love: "你这份甜度有点超标，不过我挺喜欢。"
  },
  mature: {
    happy: "这个状态很好，我们可以顺着它继续聊。",
    sad: "你不需要马上给出答案，先把感受说完整。",
    surprise: "有些事确实会超出预期，我们先把它拆开。",
    wink: "你有点坏，但我能接受这个节奏。",
    neutral: "我会认真听你说完，再给你回应。",
    angry: "我们先让情绪降一点，再决定怎么处理。",
    love: "亲密感可以慢慢建立，我会稳稳地回应你。"
  }
};

function pickWindowApiBase(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const origin = WINDOW_API_BASE;
  if (!origin || origin === "null") {
    return "";
  }

  try {
    const parsed = new URL(origin);
    const isLocalHost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";

    if (isLocalHost) {
      return `${parsed.protocol}//${parsed.hostname}:${FALLBACK_DEV_PORT}`.replace("//::1:", "//[::1]:");
    }
    return origin;
  } catch {
    return origin;
  }
}

const API_BASE = (VITE_API_BASE || GLOBAL_API_BASE || pickWindowApiBase()).replace(/\/$/, "");
export const RESOLVED_API_BASE = API_BASE;
let localFallbackActive = false;

function canUseLocalFallback(): boolean {
  return import.meta.env.VITE_DISABLE_LOCAL_FALLBACK !== "true" && typeof window !== "undefined";
}

function activateLocalFallback(): void {
  localFallbackActive = true;
}

function isLocalBrowserHost(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const parsed = new URL(WINDOW_API_BASE);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}

function shouldResolveRootAssetFromPublicBase(): boolean {
  return localFallbackActive || (!HAS_CONFIGURED_API_BASE && !isLocalBrowserHost());
}

function cloneHuman(human: DigitalHuman): DigitalHuman {
  return JSON.parse(JSON.stringify(human)) as DigitalHuman;
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can be disabled in private or embedded contexts.
  }
}

function getLocalCustomHumans(): DigitalHuman[] {
  const humans = readLocalJson<DigitalHuman[]>(LOCAL_HUMANS_KEY, []);
  return Array.isArray(humans) ? humans : [];
}

function getLocalHumans(): DigitalHuman[] {
  const custom = getLocalCustomHumans().filter((item) => item?.id && item?.name);
  return [...BUILT_IN_HUMANS.map(cloneHuman), ...custom.map(cloneHuman)];
}

function saveLocalCustomHumans(humans: DigitalHuman[]): void {
  const normalized = humans.filter((item) => item.id?.startsWith("custom-"));
  writeLocalJson(LOCAL_HUMANS_KEY, normalized);
}

function inferLocalEmotion(text: string, fallback: Emotion = "neutral"): Emotion {
  const normalized = text.toLowerCase();
  let matched: Emotion = fallback;
  let maxScore = 0;
  const priority: Record<Emotion, number> = {
    love: 7,
    wink: 6,
    angry: 5,
    sad: 4,
    surprise: 3,
    happy: 2,
    neutral: 1
  };

  (Object.entries(localEmotionKeywords) as Array<[Emotion, string[]]>).forEach(([emotion, words]) => {
    const score = words.reduce((sum, word) => sum + (normalized.includes(word.toLowerCase()) ? 1 : 0), 0);
    if (score > maxScore || (score === maxScore && score > 0 && priority[emotion] > priority[matched])) {
      maxScore = score;
      matched = emotion;
    }
  });

  return maxScore > 0 ? matched : fallback;
}

function localRelationshipLevel(turnCount: number): ChatContext["relationshipAffinity"] {
  if (turnCount >= 12) return "intimate";
  if (turnCount >= 7) return "close";
  if (turnCount >= 3) return "warm";
  return "new";
}

function extractLocalSignals(text: string, previous: string[] = []): string[] {
  const candidates = [
    "工作",
    "学习",
    "压力",
    "睡眠",
    "家人",
    "朋友",
    "恋爱",
    "想你",
    "开心",
    "难过",
    "生气",
    "约会",
    "电影",
    "论文",
    "赚钱",
    "身体",
    "孤独",
    "暧昧"
  ];
  const next = new Set(previous.slice(-5));
  candidates.forEach((item) => {
    if (text.includes(item)) next.add(item);
  });
  return Array.from(next).slice(-6);
}

function readLocalContexts(): Record<string, ChatContext> {
  const contexts = readLocalJson<Record<string, ChatContext>>(LOCAL_CONTEXT_KEY, {});
  return contexts && typeof contexts === "object" && !Array.isArray(contexts) ? contexts : {};
}

function saveLocalContext(sessionId: string, context: ChatContext): void {
  const contexts = readLocalContexts();
  contexts[sessionId || "session-browser"] = context;
  writeLocalJson(LOCAL_CONTEXT_KEY, contexts);
}

function clearLocalContext(sessionId: string): void {
  const contexts = readLocalContexts();
  delete contexts[sessionId || "session-browser"];
  writeLocalJson(LOCAL_CONTEXT_KEY, contexts);
}

function resolveLocalRelationshipMode(
  payload: ChatRequest,
  character: DigitalHuman,
  previous?: ChatContext
): RelationshipMode {
  const normalized = payload.message.toLowerCase();
  const wantsFlirty = ["暧昧", "想你", "爱你", "亲亲", "抱抱", "kiss", "心动"].some((word) => normalized.includes(word));
  if (wantsFlirty && (!payload.relationshipMode || payload.relationshipMode === "sweet")) {
    return "flirty";
  }
  return payload.relationshipMode || previous?.activeRelationshipMode || character.relationshipMode || "sweet";
}

function buildLocalContext(payload: ChatRequest, emotion: Emotion, character: DigitalHuman): ChatContext {
  const contexts = readLocalContexts();
  const previous = contexts[payload.sessionId || "session-browser"];
  const turnCount = (previous?.turnCount || 0) + 1;
  const activeRelationshipMode = resolveLocalRelationshipMode(payload, character, previous);
  const userSignals = extractLocalSignals(payload.message, previous?.userSignals || []);
  const relationshipAffinity = localRelationshipLevel(turnCount);
  const signalText = userSignals.length ? `，最近关键词：${userSignals.join("、")}` : "";

  return {
    relationshipAffinity,
    activeRelationshipMode,
    summary: `已进行 ${turnCount} 回合，对话风格为 ${activeRelationshipMode}${signalText}。`,
    userSignals,
    lastEmotion: emotion,
    turnCount,
    updatedAt: new Date().toISOString()
  };
}

function buildLocalReply(payload: ChatRequest, character: DigitalHuman, emotion: Emotion, context: ChatContext): string {
  const mode = context.activeRelationshipMode || character.relationshipMode || "sweet";
  const line = localModeLine[mode]?.[emotion] || localModeLine.sweet.neutral;
  const clean = payload.message.trim();
  const quoted = clean.length > 120 ? `${clean.slice(0, 120)}...` : clean;
  const nameHint = character.name ? `${character.name}在听，` : "";
  const memoryHint = context.userSignals.length > 1 ? `我也记得你前面提到过${context.userSignals.slice(0, -1).join("、")}。` : "";
  const followUp =
    emotion === "love" || mode === "flirty"
      ? "你可以继续说得更直接一点，我会顺着你的节奏回应。"
      : emotion === "angry"
        ? "先把最让你不舒服的那一点告诉我。"
        : "继续说，我会按你的情绪慢慢跟上。";

  return `${nameHint}${quoted ? `你刚才说「${quoted}」，` : ""}${line}${memoryHint}${followUp}`;
}

function buildLocalChatResponse(payload: ChatRequest): ChatResponse {
  activateLocalFallback();
  const humans = getLocalHumans();
  const character = humans.find((item) => item.id === payload.characterId) || humans[0] || BUILT_IN_HUMANS[0];
  const previous = readLocalContexts()[payload.sessionId || "session-browser"];
  const emotion = inferLocalEmotion(payload.message, previous?.lastEmotion || character.defaultMood || "neutral");
  const context = buildLocalContext(payload, emotion, character);
  saveLocalContext(payload.sessionId, context);

  return {
    sessionId: payload.sessionId,
    characterId: character.id,
    text: buildLocalReply(payload, character, emotion, context),
    emotion,
    context
  };
}

function splitLocalChunks(text: string): string[] {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + 8));
    cursor += 8;
  }
  return chunks;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function uploadModelFile(params: {
  fileName: string;
  fileBase64: string;
  mimeType?: string;
  fallbackUrl?: string;
}): Promise<ModelUploadResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/models/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    if (!res.ok) {
      const message = await res.text().catch(() => "模型上传失败");
      throw new Error(message || "模型上传失败");
    }

    return res.json();
  } catch (error) {
    if (!canUseLocalFallback() || !params.fallbackUrl) throw error;
    activateLocalFallback();
    return {
      modelUrl: params.fallbackUrl,
      fileName: params.fileName,
      mimeType: params.mimeType,
      size: 0,
      hasFallback: true
    };
  }
}

async function sendLocalMessageStream(payload: ChatRequest, handlers: ChatStreamEvents): Promise<StreamDoneResponse> {
  const response = buildLocalChatResponse(payload);
  const donePayload: StreamDoneResponse = {
    ...response,
    hasFallback: true
  };

  handlers.onEmotion?.(donePayload.emotion);
  for (const text of splitLocalChunks(donePayload.text)) {
    await wait(45);
    handlers.onChunk?.({ text });
  }
  await wait(30);
  handlers.onDone?.(donePayload);
  return donePayload;
}

export async function createDigitalHuman(payload: CreateHumanRequest) {
  try {
    const res = await fetch(`${API_BASE}/api/digital-humans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("创建数字人失败");
    return res.json();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    activateLocalFallback();
    const human: DigitalHuman = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
      name: payload.name,
      description: payload.description,
      avatarUrl: payload.avatarUrl,
      modelUrl: payload.modelUrl,
      avatarType: payload.avatarType || "image",
      emotionProfile: payload.emotionProfile,
      avatarVideoProfile: payload.avatarVideoProfile,
      personalityTagline: payload.personalityTagline,
      relationshipMode: payload.relationshipMode || "sweet",
      voiceProfile: {
        provider: payload.voiceProvider || "local",
        voice: payload.voice || "browser-zh-CN"
      },
      defaultMood: payload.defaultMood || "neutral"
    };
    saveLocalCustomHumans([...getLocalCustomHumans(), human]);
    return { human };
  }
}

export async function deleteDigitalHuman(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/digital-humans/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    if (!res.ok) {
      throw new Error("删除数字人失败");
    }
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    activateLocalFallback();
    saveLocalCustomHumans(getLocalCustomHumans().filter((item) => item.id !== id));
  }
}

export async function fetchHumans() {
  try {
    const res = await fetch(`${API_BASE}/api/digital-humans`);
    if (!res.ok) throw new Error("加载数字人失败");
    return res.json();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    activateLocalFallback();
    return { humans: getLocalHumans(), source: "local-static-fallback" };
  }
}

export async function sendMessage(payload: ChatRequest): Promise<ChatResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("发送消息失败");
    return res.json();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    return buildLocalChatResponse(payload);
  }
}

export async function transcribeSpeech(params: {
  audioBase64: string;
  mimeType?: string;
  language?: string;
}): Promise<TranscribeResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    if (!res.ok) {
      const message = await res.text().catch(() => "语音转写失败");
      throw new Error(message || "语音转写失败");
    }

    return res.json();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    activateLocalFallback();
    throw new Error("静态网页模式暂不支持上传录音转写；可使用浏览器自带语音识别或手动输入。");
  }
}

export async function clearSessionHistory(sessionId: string): Promise<void> {
  if (!sessionId) {
    return;
  }

  try {
    await fetch(`${API_BASE}/api/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    });
  } catch {
    // Static Pages mode has no session API.
  }
  clearLocalContext(sessionId);
}

function parseSseText(raw: string): string {
  return raw.replace(/^data:/gm, "").trim();
}

export async function sendMessageStream(payload: ChatRequest, handlers: ChatStreamEvents): Promise<StreamDoneResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "发送消息失败");
      throw new Error(msg || "发送消息失败");
    }

    if (!res.body) {
      throw new Error("服务器未返回流式数据");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let donePayload: StreamDoneResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes("\n\n")) {
        const rawEvent = buffer.slice(0, buffer.indexOf("\n\n"));
        buffer = buffer.slice(buffer.indexOf("\n\n") + 2);

        const lines = rawEvent.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event:"));
        const dataLine = lines.find((line) => line.startsWith("data:"));
        const event = eventLine ? eventLine.replace("event:", "").trim() : "message";
        if (!dataLine) continue;

        const parsed = (() => {
          try {
            return JSON.parse(parseSseText(dataLine));
          } catch {
            return null;
          }
        })();
        if (!parsed) continue;

        if (event === "chunk" && typeof parsed.text === "string") {
          handlers.onChunk?.({ text: parsed.text });
        } else if (event === "emotion" && typeof parsed.emotion === "string") {
          handlers.onEmotion?.(parsed.emotion as Emotion);
        } else if (event === "done" && typeof parsed.text === "string" && typeof parsed.emotion === "string") {
          donePayload = parsed as StreamDoneResponse;
          handlers.onDone?.(parsed as StreamDoneResponse);
        }
      }
    }

    if (!donePayload) {
      throw new Error("流式回复未完成");
    }

    return donePayload;
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    return sendLocalMessageStream(payload, handlers);
  }
}

export function resolveMediaUrl(url?: string): string | undefined {
  const trimmed = String(url || "").trim();
  if (!trimmed) return undefined;
  const publicBase = import.meta.env.BASE_URL || "/";

  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.test(trimmed) || /^data:|^blob:/i.test(trimmed)) {
    return trimmed;
  }
  if (shouldResolveRootAssetFromPublicBase()) {
    if (trimmed.startsWith("/")) {
      if (publicBase === "/") {
        return trimmed;
      }
      return `${publicBase.replace(/\/?$/, "/")}${trimmed.slice(1)}`;
    }
    if (trimmed.startsWith("assets/") || trimmed.startsWith("icons/") || trimmed === "manifest.webmanifest") {
      return `${publicBase.replace(/\/?$/, "/")}${trimmed}`;
    }
    return trimmed;
  }
  if (!API_BASE) {
    if (trimmed.startsWith("/")) {
      return trimmed;
    }
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `${API_BASE}${trimmed}`;
  }
  return `${API_BASE}/${trimmed}`;
}
