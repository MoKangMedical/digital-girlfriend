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

export interface DigitalHuman {
  id: string;
  name: string;
  description: string;
  avatarUrl: string;
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

export async function createDigitalHuman(payload: CreateHumanRequest) {
  const res = await fetch(`${API_BASE}/api/digital-humans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("创建数字人失败");
  return res.json();
}

export async function deleteDigitalHuman(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/digital-humans/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (!res.ok) {
    throw new Error("删除数字人失败");
  }
}

export async function fetchHumans() {
  const res = await fetch(`${API_BASE}/api/digital-humans`);
  if (!res.ok) throw new Error("加载数字人失败");
  return res.json();
}

export async function sendMessage(payload: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("发送消息失败");
  return res.json();
}

export async function transcribeSpeech(params: {
  audioBase64: string;
  mimeType?: string;
  language?: string;
}): Promise<TranscribeResponse> {
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
}

export async function clearSessionHistory(sessionId: string): Promise<void> {
  if (!sessionId) {
    return;
  }

  await fetch(`${API_BASE}/api/session/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });
}

function parseSseText(raw: string): string {
  return raw.replace(/^data:/gm, "").trim();
}

export async function sendMessageStream(payload: ChatRequest, handlers: ChatStreamEvents): Promise<StreamDoneResponse> {
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
}

export function resolveMediaUrl(url?: string): string | undefined {
  const trimmed = String(url || "").trim();
  if (!trimmed) return undefined;
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.test(trimmed) || /^data:|^blob:/i.test(trimmed)) {
    return trimmed;
  }
  if (!API_BASE) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `${API_BASE}${trimmed}`;
  }
  return `${API_BASE}/${trimmed}`;
}
