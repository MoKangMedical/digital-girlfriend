import { FormEvent, useEffect, useRef, useState } from "react";
import { Box, Brain, Download, Image as ImageIcon, Mic, MicOff, Save, Send, Upload } from "lucide-react";
import {
  ChatContext,
  ChatMessageRequest,
  CreateHumanRequest,
  DigitalHuman,
  Emotion,
  EmotionProfile,
  Message,
  StreamDoneResponse,
  clearSessionHistory,
  createDigitalHuman,
  resolveMediaUrl,
  sendMessage,
  sendMessageStream,
  transcribeSpeech,
  uploadModelFile
} from "../services/api";
import { Avatar } from "./Avatar";

const PUBLIC_ASSET_BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
const defaultAvatarUrl = `${PUBLIC_ASSET_BASE}assets/avatars/lina.svg`;
const assetPlaceholderBase = `${PUBLIC_ASSET_BASE}assets`;
const AVATAR_MODE_STORAGE_KEY = "dg-avatar-render-mode";
const CHAT_STATE_STORAGE_PREFIX = "dg-chat-state-v1";
const LOCAL_HUMANS_STORAGE_KEY = "dg-local-digital-humans-v1";
const LOCAL_CONTEXT_STORAGE_KEY = "dg-local-chat-context-v1";
const USER_MEMORY_STORAGE_KEY = "dg-user-memory-v1";
const SESSION_STORAGE_KEY = "dg-session-id";
const SELECTED_CHARACTER_STORAGE_KEY = "dg-selected-character-id";
const EXPORT_SCHEMA = "digital-girlfriend-local-archive";
const MAX_STORED_MESSAGES = 80;

interface Bubble {
  role: Message["role"];
  content: string;
}

interface BrowserSpeechRecognitionResult {
  transcript: string;
}

interface BrowserSpeechRecognitionAlternative {
  [index: number]: BrowserSpeechRecognitionResult;
  length: number;
}

interface BrowserSpeechRecognitionResultList {
  [index: number]: BrowserSpeechRecognitionAlternative;
  length: number;
}

interface BrowserSpeechRecognitionEvent {
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognition {
  start(): void;
  stop(): void;
  abort(): void;
  continuous: boolean;
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
}

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

interface LocalArchivePayload {
  schema: typeof EXPORT_SCHEMA;
  version: 1;
  exportedAt: string;
  sessionId: string;
  selectedCharacterId: string;
  avatarRenderMode?: "2d" | "3d";
  userMemory?: UserMemory;
  localHumans: DigitalHuman[];
  localContexts: Record<string, ChatContext>;
  chatStates: Array<{ key: string; value: unknown }>;
}

interface UserMemory {
  displayName: string;
  preferredName: string;
  preferences: string;
  importantFacts: string;
  boundaries: string;
  relationshipNotes: string;
  updatedAt?: string;
}

interface State {
  messages: Bubble[];
  emotion: Emotion;
  characterId: string;
  relationshipMode: (typeof relationshipModes)[number];
  context?: ChatContext;
}

const moods = ["neutral", "happy", "sad", "surprise", "wink", "angry", "love"] as const;
const relationshipModes: Array<"sweet" | "flirty" | "playful" | "mature"> = ["sweet", "flirty", "playful", "mature"];
type LocalEmotion = (typeof moods)[number];

const emptyUserMemory: UserMemory = {
  displayName: "",
  preferredName: "",
  preferences: "",
  importantFacts: "",
  boundaries: "",
  relationshipNotes: "",
  updatedAt: ""
};

function isEmotion(value: unknown): value is Emotion {
  return typeof value === "string" && (moods as readonly string[]).includes(value);
}

function isRelationshipMode(value: unknown): value is (typeof relationshipModes)[number] {
  return typeof value === "string" && relationshipModes.includes(value as (typeof relationshipModes)[number]);
}

const localMoodKeywords: Record<LocalEmotion, string[]> = {
  happy: ["开心", "高兴", "好", "棒", "喜欢", "爱", "甜", "nice", "cool", "great", "好笑", "哈哈", "快乐", "开心死了", "太好了"],
  sad: ["难过", "伤心", "失落", "烦", "哭", "sad", "难受", "心碎", "失望"],
  surprise: ["惊讶", "真的吗", "怎么会", "哇", "wow", "天啊", "不可思议", "没想到", "太突然", "惊人"],
  wink: ["撩", "调皮", "开玩笑", "可爱", "俏皮", "坏", "flirty", "sugar", "小坏蛋"],
  neutral: [],
  angry: ["生气", "烦", "愤怒", "气死", "讨厌", "烦躁", "annoyed", "hate", "讨厌你", "你怎么"],
  love: ["想你", "宝贝", "亲爱", "抱抱", "亲亲", "kiss", "爱你", "恋爱", "想念", "我好想"]
};

const relationshipLabelMap: Record<ChatContext["relationshipAffinity"], string> = {
  new: "刚认识",
  warm: "有点熟",
  close: "很熟",
  intimate: "亲密"
};

const inferLocalEmotion = (text: string): LocalEmotion => {
  const normalized = text.toLowerCase();
  let maxScore = 0;
  let matched: LocalEmotion = "neutral";
  (Object.entries(localMoodKeywords) as Array<[LocalEmotion, string[]]>).forEach(([emotion, words]) => {
    const score = words.reduce((acc, word) => acc + (normalized.includes(word) ? 1 : 0), 0);
    if (score > maxScore) {
      maxScore = score;
      matched = emotion;
    }
  });
  return maxScore > 0 ? matched : "neutral";
};

function parseEmotionProfile(raw: string): EmotionProfile | undefined {
  const normalized = raw.trim();
  if (!normalized) return undefined;

  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const result: EmotionProfile = {};
    (Object.keys(parsed) as Array<Emotion>).forEach((emotion) => {
      if (["happy", "sad", "surprise", "wink", "neutral", "angry", "love"].includes(emotion)) {
        const value = String((parsed as Record<string, unknown>)[emotion] || "").trim();
        if (value) {
          result[emotion] = value;
        }
      }
    });

    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEmotionProfileObject(raw: unknown): EmotionProfile | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const result: EmotionProfile = {};
  (Object.keys(raw) as Array<Emotion>).forEach((emotion) => {
    if (isEmotion(emotion)) {
      const value = String((raw as Record<string, unknown>)[emotion] || "").trim();
      if (value) {
        result[emotion] = value;
      }
    }
  });

  return Object.keys(result).length > 0 ? result : undefined;
}

function getChatStateStorageKey(sessionId: string, characterId: string): string {
  const safeSessionId = encodeURIComponent(sessionId || "session-browser");
  const safeCharacterId = encodeURIComponent(characterId || "lina");
  return `${CHAT_STATE_STORAGE_PREFIX}:${safeSessionId}:${safeCharacterId}`;
}

function normalizeStoredMessages(raw: unknown): Bubble[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const role = (item as Partial<Bubble>).role;
      const content = String((item as Partial<Bubble>).content || "").trim();
      if (!content || (role !== "user" && role !== "assistant" && role !== "system")) {
        return [];
      }
      return [{ role, content }];
    })
    .slice(-MAX_STORED_MESSAGES);
}

function normalizeStoredContext(raw: unknown): ChatContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<ChatContext>;
  if (
    value.relationshipAffinity !== "new" &&
    value.relationshipAffinity !== "warm" &&
    value.relationshipAffinity !== "close" &&
    value.relationshipAffinity !== "intimate"
  ) {
    return undefined;
  }
  if (!isEmotion(value.lastEmotion)) return undefined;

  return {
    relationshipAffinity: value.relationshipAffinity,
    activeRelationshipMode: isRelationshipMode(value.activeRelationshipMode) ? value.activeRelationshipMode : undefined,
    summary: String(value.summary || ""),
    userSignals: Array.isArray(value.userSignals) ? value.userSignals.map((item) => String(item)).filter(Boolean).slice(-8) : [],
    lastEmotion: value.lastEmotion,
    turnCount: typeof value.turnCount === "number" ? value.turnCount : 0,
    updatedAt: String(value.updatedAt || "")
  };
}

function normalizeMemoryText(value: unknown, maxLength = 360): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeUserMemory(raw: unknown): UserMemory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...emptyUserMemory };
  }

  const value = raw as Partial<UserMemory>;
  return {
    displayName: normalizeMemoryText(value.displayName, 80),
    preferredName: normalizeMemoryText(value.preferredName, 80),
    preferences: normalizeMemoryText(value.preferences),
    importantFacts: normalizeMemoryText(value.importantFacts),
    boundaries: normalizeMemoryText(value.boundaries),
    relationshipNotes: normalizeMemoryText(value.relationshipNotes),
    updatedAt: normalizeMemoryText(value.updatedAt, 60)
  };
}

function readStoredUserMemory(): UserMemory {
  if (typeof window === "undefined") return { ...emptyUserMemory };
  return normalizeUserMemory(readLocalStorageJson<unknown>(USER_MEMORY_STORAGE_KEY, emptyUserMemory));
}

function writeStoredUserMemory(memory: UserMemory): UserMemory {
  const normalized = normalizeUserMemory({
    ...memory,
    updatedAt: new Date().toISOString()
  });
  if (typeof window !== "undefined") {
    window.localStorage.setItem(USER_MEMORY_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function hasUserMemory(memory: UserMemory): boolean {
  return Boolean(
    memory.displayName ||
    memory.preferredName ||
    memory.preferences ||
    memory.importantFacts ||
    memory.boundaries ||
    memory.relationshipNotes
  );
}

function buildUserMemorySystemMessage(memory: UserMemory, character?: DigitalHuman): Message | null {
  const normalized = normalizeUserMemory(memory);
  if (!hasUserMemory(normalized)) return null;

  const lines = [
    "长期记忆：以下是用户主动保存给数字人的资料，回答时自然使用，不要逐条复述。",
    normalized.displayName ? `用户自称：${normalized.displayName}` : "",
    normalized.preferredName ? `希望数字人称呼用户：${normalized.preferredName}` : "",
    normalized.preferences ? `聊天偏好：${normalized.preferences}` : "",
    normalized.importantFacts ? `重要事实：${normalized.importantFacts}` : "",
    normalized.boundaries ? `聊天禁忌或边界：${normalized.boundaries}` : "",
    normalized.relationshipNotes ? `关系备注：${normalized.relationshipNotes}` : "",
    character?.name ? `当前数字人：${character.name}` : ""
  ].filter(Boolean);

  return {
    role: "system",
    content: lines.join("\n")
  };
}

function buildDefaultChatState(character: DigitalHuman | undefined, fallbackId: string, welcomeText: string): State {
  return {
    messages: [{ role: "assistant", content: welcomeText }],
    emotion: character?.defaultMood || "neutral",
    characterId: character?.id || fallbackId || "lina",
    relationshipMode: character?.relationshipMode || "sweet",
    context: undefined
  };
}

function readStoredChatState(sessionId: string, character: DigitalHuman | undefined, welcomeText: string): State | null {
  if (typeof window === "undefined" || !character?.id) return null;

  try {
    const raw = window.localStorage.getItem(getChatStateStorageKey(sessionId, character.id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<State>;
    const messages = normalizeStoredMessages(parsed.messages);
    if (messages.length === 0) return null;
    const context = normalizeStoredContext(parsed.context);
    return {
      messages,
      emotion: isEmotion(parsed.emotion) ? parsed.emotion : context?.lastEmotion || character.defaultMood || "neutral",
      characterId: character.id,
      relationshipMode: isRelationshipMode(parsed.relationshipMode)
        ? parsed.relationshipMode
        : context?.activeRelationshipMode || character.relationshipMode || "sweet",
      context
    };
  } catch {
    return buildDefaultChatState(character, character?.id || "lina", welcomeText);
  }
}

function writeStoredChatState(sessionId: string, state: State): void {
  if (typeof window === "undefined" || !state.characterId) return;

  try {
    const payload = {
      version: 1,
      messages: state.messages.slice(-MAX_STORED_MESSAGES),
      emotion: state.emotion,
      relationshipMode: state.relationshipMode,
      context: state.context,
      updatedAt: new Date().toISOString()
    };
    window.localStorage.setItem(getChatStateStorageKey(sessionId, state.characterId), JSON.stringify(payload));
  } catch {
    // Local persistence is best-effort in private or quota-limited browsers.
  }
}

function removeStoredChatState(sessionId: string, characterId: string): void {
  if (typeof window === "undefined" || !characterId) return;
  try {
    window.localStorage.removeItem(getChatStateStorageKey(sessionId, characterId));
  } catch {
    // Local persistence is best-effort.
  }
}

function removeStoredChatStatesForCharacter(characterId: string): void {
  if (typeof window === "undefined" || !characterId) return;
  const suffix = `:${encodeURIComponent(characterId)}`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`${CHAT_STATE_STORAGE_PREFIX}:`) && key.endsWith(suffix)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Local persistence is best-effort.
  }
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function normalizeImportedHumans(raw: unknown): DigitalHuman[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Partial<DigitalHuman>;
    const id = String(value.id || "").trim();
    const name = String(value.name || "").trim();
    if (!id.startsWith("custom-") || !name) return [];

    const voiceProfile = value.voiceProfile && typeof value.voiceProfile === "object" ? value.voiceProfile : undefined;
    const provider = voiceProfile?.provider === "openai" || voiceProfile?.provider === "azure" || voiceProfile?.provider === "local"
      ? voiceProfile.provider
      : "local";

    return [{
      id,
      name,
      description: String(value.description || "导入的数字人").trim(),
      avatarUrl: String(value.avatarUrl || defaultAvatarUrl).trim(),
      modelUrl: String(value.modelUrl || "").trim() || undefined,
      avatarType: value.avatarType === "video" ? "video" : "image",
      emotionProfile: normalizeEmotionProfileObject(value.emotionProfile),
      avatarVideoProfile: normalizeEmotionProfileObject(value.avatarVideoProfile),
      personalityTagline: String(value.personalityTagline || "").trim() || undefined,
      relationshipMode: isRelationshipMode(value.relationshipMode) ? value.relationshipMode : "sweet",
      voiceProfile: {
        provider,
        voice: String(voiceProfile?.voice || "browser-zh-CN").trim()
      },
      defaultMood: isEmotion(value.defaultMood) ? value.defaultMood : "neutral"
    }];
  });
}

function normalizeImportedChatState(raw: unknown): unknown | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<State>;
  const messages = normalizeStoredMessages(value.messages);
  if (!messages.length) return null;
  const context = normalizeStoredContext(value.context);

  return {
    version: 1,
    messages,
    emotion: isEmotion(value.emotion) ? value.emotion : context?.lastEmotion || "neutral",
    relationshipMode: isRelationshipMode(value.relationshipMode)
      ? value.relationshipMode
      : context?.activeRelationshipMode || "sweet",
    context,
    updatedAt: new Date().toISOString()
  };
}

function normalizeImportedContexts(raw: unknown): Record<string, ChatContext> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, ChatContext> = {};
  Object.entries(raw).forEach(([key, value]) => {
    const context = normalizeStoredContext(value);
    if (context) {
      result[String(key)] = context;
    }
  });
  return result;
}

function buildLocalArchive(sessionId: string, selectedCharacterId: string, state: State): LocalArchivePayload {
  writeStoredChatState(sessionId, state);
  const chatStates: LocalArchivePayload["chatStates"] = [];

  if (typeof window !== "undefined") {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(`${CHAT_STATE_STORAGE_PREFIX}:`)) continue;
      const value = readLocalStorageJson<unknown>(key, null);
      const normalized = normalizeImportedChatState(value);
      if (normalized) {
        chatStates.push({ key, value: normalized });
      }
    }
  }

  const avatarRenderMode = typeof window !== "undefined" && window.localStorage.getItem(AVATAR_MODE_STORAGE_KEY) === "2d" ? "2d" : "3d";
  return {
    schema: EXPORT_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    sessionId,
    selectedCharacterId,
    avatarRenderMode,
    userMemory: readStoredUserMemory(),
    localHumans: normalizeImportedHumans(readLocalStorageJson<unknown>(LOCAL_HUMANS_STORAGE_KEY, [])),
    localContexts: normalizeImportedContexts(readLocalStorageJson<unknown>(LOCAL_CONTEXT_STORAGE_KEY, {})),
    chatStates
  };
}

function importLocalArchive(payload: unknown): { humans: number; chats: number; hasMemory: boolean } {
  if (typeof window === "undefined" || !payload || typeof payload !== "object") {
    throw new Error("导入文件格式不正确");
  }

  const archive = payload as Partial<LocalArchivePayload>;
  if (archive.schema !== EXPORT_SCHEMA || archive.version !== 1) {
    throw new Error("不是数字女友本地记录文件");
  }

  const importedHumans = normalizeImportedHumans(archive.localHumans);
  const existingHumans = normalizeImportedHumans(readLocalStorageJson<unknown>(LOCAL_HUMANS_STORAGE_KEY, []));
  const humanMap = new Map(existingHumans.map((human) => [human.id, human]));
  importedHumans.forEach((human) => humanMap.set(human.id, human));
  window.localStorage.setItem(LOCAL_HUMANS_STORAGE_KEY, JSON.stringify(Array.from(humanMap.values())));

  const importedContexts = normalizeImportedContexts(archive.localContexts);
  const existingContexts = normalizeImportedContexts(readLocalStorageJson<unknown>(LOCAL_CONTEXT_STORAGE_KEY, {}));
  window.localStorage.setItem(LOCAL_CONTEXT_STORAGE_KEY, JSON.stringify({ ...existingContexts, ...importedContexts }));

  let importedChatCount = 0;
  if (Array.isArray(archive.chatStates)) {
    archive.chatStates.forEach((entry) => {
      const key = String(entry?.key || "");
      if (!key.startsWith(`${CHAT_STATE_STORAGE_PREFIX}:`)) return;
      const normalized = normalizeImportedChatState(entry.value);
      if (!normalized) return;
      window.localStorage.setItem(key, JSON.stringify(normalized));
      importedChatCount += 1;
    });
  }

  if (archive.sessionId) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, String(archive.sessionId));
  }
  if (archive.selectedCharacterId) {
    window.localStorage.setItem(SELECTED_CHARACTER_STORAGE_KEY, String(archive.selectedCharacterId));
  }
  if (archive.avatarRenderMode === "2d" || archive.avatarRenderMode === "3d") {
    window.localStorage.setItem(AVATAR_MODE_STORAGE_KEY, archive.avatarRenderMode);
  }

  const importedMemory = normalizeUserMemory(archive.userMemory);
  const hasMemory = hasUserMemory(importedMemory);
  if (hasMemory) {
    window.localStorage.setItem(USER_MEMORY_STORAGE_KEY, JSON.stringify(importedMemory));
  }

  return { humans: importedHumans.length, chats: importedChatCount, hasMemory };
}

interface NewCharacterForm {
  name: string;
  description: string;
  avatarUrl: string;
  modelUrl: string;
  voiceProvider: "openai" | "azure" | "local";
  voice: string;
  defaultMood: (typeof moods)[number];
  emotionProfile: string;
  avatarType: "image" | "video";
  avatarVideoProfile: string;
  personalityTagline: string;
  relationshipMode: (typeof relationshipModes)[number];
}

interface ApiHistoryMessage {
  role: Message["role"];
  content: string;
}

async function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(blob);
  });
}

function selectRecorderMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg;codecs=opus"
  ];

  if (typeof window === "undefined" || !window.MediaRecorder) {
    return undefined;
  }

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || undefined;
}

export function ChatPanel({
  characters,
  sessionId,
  onCreate,
  selectedCharacterId,
  onDelete,
  onCharacterChange,
  onResetSession
}: {
  characters: DigitalHuman[];
  sessionId: string;
  onCreate: (human: DigitalHuman) => void;
  onDelete: (characterId: string) => Promise<void> | void;
  selectedCharacterId: string;
  onCharacterChange: (characterId: string) => void;
  onResetSession: () => void;
}) {
  const welcomeText = "你好呀，来聊聊今天发生了什么吧～";
  const initialCharacter = characters.find((item) => item.id === selectedCharacterId) || characters[0];
  const [state, setState] = useState<State>(() =>
    readStoredChatState(sessionId, initialCharacter, welcomeText) ||
    buildDefaultChatState(initialCharacter, selectedCharacterId || "lina", welcomeText)
  );
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [mediaRecorderSupported, setMediaRecorderSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isModelUploading, setIsModelUploading] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [use3D, setUse3D] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(AVATAR_MODE_STORAGE_KEY) !== "2d";
  });
  const [userMemory, setUserMemory] = useState<UserMemory>(() => readStoredUserMemory());
  const [memoryStatus, setMemoryStatus] = useState("");
  const [form, setForm] = useState<NewCharacterForm>({
    name: "",
    description: "",
    avatarUrl: defaultAvatarUrl,
    modelUrl: "",
    voiceProvider: "openai",
    voice: "nova",
    defaultMood: "neutral",
    emotionProfile: "{}",
    avatarType: "image",
    avatarVideoProfile: "{}",
    personalityTagline: "",
    relationshipMode: "sweet"
  });

  const audioRef = useRef<HTMLAudioElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const modelObjectUrlsRef = useRef<string[]>([]);
  const suppressClickAfterHoldRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const activeChatStorageKeyRef = useRef("");
  const archiveInputRef = useRef<HTMLInputElement>(null);

  const activeCharacter = characters.find((item) => item.id === state.characterId) || initialCharacter || characters[0];
  const isCustomCharacter = (characterId: string) => characterId.startsWith("custom-");
  const memoryIsActive = hasUserMemory(userMemory);

  useEffect(() => {
    const preferred = characters.find((item) => item.id === selectedCharacterId) || characters[0];
    if (!preferred) return;
    const nextStorageKey = getChatStateStorageKey(sessionId, preferred.id);
    setState((prev) => {
      if (prev.characterId === preferred.id && activeChatStorageKeyRef.current === nextStorageKey) {
        return {
          ...prev,
          relationshipMode: prev.relationshipMode || preferred.relationshipMode || "sweet"
        };
      }
      activeChatStorageKeyRef.current = nextStorageKey;
      return readStoredChatState(sessionId, preferred, welcomeText) ||
        buildDefaultChatState(preferred, preferred.id, welcomeText);
    });
  }, [selectedCharacterId, characters, sessionId]);

  useEffect(() => {
    if (!state.characterId) return;
    activeChatStorageKeyRef.current = getChatStateStorageKey(sessionId, state.characterId);
    writeStoredChatState(sessionId, state);
  }, [sessionId, state.characterId, state.messages, state.emotion, state.relationshipMode, state.context]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [state.messages, isLoading]);

  useEffect(() => {
    const ctor = (window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionCtor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
    }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: BrowserSpeechRecognitionCtor }).webkitSpeechRecognition;
    setSpeechSupported(!!ctor);

    const hasMediaRecorder =
      !!window.MediaRecorder &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function";
    setMediaRecorderSupported(hasMediaRecorder);
  }, []);

  useEffect(() => {
    return () => {
      stopSpeechRecognition();
      stopMediaRecorder();
      modelObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      modelObjectUrlsRef.current = [];
    };
  }, []);

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = "";
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  };

  const speakAudio = (audioUrl?: string, fallbackText?: string) => {
    stopSpeaking();

    if (!audioUrl) {
      if (window.speechSynthesis) {
        const latest = state.messages[state.messages.length - 1];
        const textToSpeak = (fallbackText || latest?.content || "我听到了，说说吧～").trim();
        const utter = new SpeechSynthesisUtterance(textToSpeak);
        utter.lang = "zh-CN";
        setSpeaking(true);
        utter.onend = () => setSpeaking(false);
        utter.onerror = () => setSpeaking(false);
        speechSynthesis.speak(utter);
      } else {
        setSpeaking(false);
      }
      return;
    }

    if (!audioRef.current) return;
    setSpeaking(true);
    audioRef.current.src = audioUrl;
    audioRef.current
      .play()
      .catch(() => {
        setSpeaking(false);
      });
    audioRef.current.onended = () => setSpeaking(false);
  };

  const upsertAssistantBubble = (nextText: string, shouldAppend = false) => {
    setState((prev) => {
      const messages = [...prev.messages];
      const idx = messages.length - 1;
      let nextEmotion = prev.emotion;

      if (shouldAppend) {
        if (idx >= 0 && messages[idx].role === "assistant") {
          messages[idx] = { ...messages[idx], content: messages[idx].content + nextText };
          nextEmotion = inferLocalEmotion(messages[idx].content);
        } else {
          messages.push({ role: "assistant", content: nextText });
          nextEmotion = inferLocalEmotion(nextText);
        }
      } else if (idx < 0 || messages[idx].role !== "assistant") {
        messages.push({ role: "assistant", content: nextText });
        nextEmotion = inferLocalEmotion(nextText);
      } else {
        messages[idx] = { ...messages[idx], content: nextText };
        nextEmotion = inferLocalEmotion(nextText);
      }

      return { ...prev, messages, emotion: nextEmotion };
    });
  };

  const stopSpeechRecognition = () => {
    if (!recognitionRef.current) {
      return;
    }
    try {
      recognitionRef.current.stop();
    } catch {
      recognitionRef.current.abort();
    } finally {
      recognitionRef.current = null;
      setIsRecording(false);
    }
  };

  const releaseMediaStream = () => {
    if (!mediaStreamRef.current) return;
    mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const stopMediaRecorder = () => {
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }
    releaseMediaStream();
    setIsRecording(false);
  };

  const handleRecordedAudio = async (blob: Blob, mimeType?: string) => {
    setIsTranscribing(true);
    setSpeechError("");
    try {
      const audioBase64 = await blobToBase64(blob);
      if (!audioBase64) {
        setSpeechError("未检测到语音内容");
        return;
      }

      const { text } = await transcribeSpeech({
        audioBase64,
        mimeType: mimeType || blob.type || "audio/mp3",
        language: "zh"
      });
      const transcript = String(text || "").trim();
      if (!transcript) {
        setSpeechError("未识别出语音文本");
        return;
      }

      await submitMessage(transcript);
      setInput("");
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : "语音识别失败");
    } finally {
      setIsTranscribing(false);
      setIsRecording(false);
      stopMediaRecorder();
    }
  };

  const startSpeechRecognition = () => {
    const windowWithSpeech = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionCtor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
    };
    const Ctor = windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;
    if (!Ctor) {
      setSpeechError("当前浏览器未找到语音识别能力");
      return;
    }

    const recognition = new Ctor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (!event.results || event.results.length === 0) {
        return;
      }

      const transcript = String(event.results[0][0]?.transcript || "").trim();
      if (!transcript) {
        setSpeechError("未识别出语音内容");
        return;
      }

      setInput("");
      setSpeechError("");
      void submitMessage(transcript);
    };

    recognition.onerror = () => {
      stopSpeechRecognition();
      setSpeechError("语音识别失败，请重试");
    };

    recognition.onstart = () => {
      setSpeechError("");
      setIsRecording(true);
      setIsTranscribing(false);
    };

    recognition.onend = () => {
      stopSpeechRecognition();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setSpeechError("录音初始化失败，请重试");
      stopSpeechRecognition();
    }
  };

  const startMediaRecorder = async () => {
    if (!mediaRecorderSupported || !navigator.mediaDevices?.getUserMedia) {
      setSpeechError("未检测到麦克风录音能力");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000
        } as MediaTrackConstraints
      });
      const recorderMimeType = selectRecorderMimeType();
      const recorder = recorderMimeType ? new MediaRecorder(stream, { mimeType: recorderMimeType }) : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      mediaChunksRef.current = [];
      setSpeechError("");
      setIsRecording(true);
      setIsTranscribing(false);

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          mediaChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const chunks = mediaChunksRef.current;
        if (!chunks.length) {
          setSpeechError("未检测到语音内容");
          setIsTranscribing(false);
          setIsRecording(false);
          releaseMediaStream();
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        void handleRecordedAudio(blob, blob.type);
      };

      recorder.onerror = () => {
        setSpeechError("录音失败，请重试");
        setIsTranscribing(false);
        stopMediaRecorder();
      };

      recorder.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : "麦克风权限未授权";
      stopMediaRecorder();
      setSpeechError(message);
    }
  };

  const submitMessage = async (messageText: string) => {
    const userMessage = messageText.trim();
    if (!userMessage || isLoading) return;

    setSpeechError("");
    setInput("");
    stopSpeaking();
    let gotRemoteEmotion = false;

    const userBubble = { role: "user" as const, content: userMessage };
    const preEmotion = inferLocalEmotion(userMessage);
    const visibleHistory: ApiHistoryMessage[] = [...state.messages, userBubble].map((message) => ({
      role: message.role,
      content: message.content
    }));
    const memoryMessage = buildUserMemorySystemMessage(userMemory, activeCharacter);
    const nextHistory: ApiHistoryMessage[] = memoryMessage ? [memoryMessage, ...visibleHistory] : visibleHistory;

    setState((prev) => ({ ...prev, messages: [...prev.messages, userBubble], emotion: preEmotion }));
    setIsLoading(true);

    const request: ChatMessageRequest = {
      sessionId,
      characterId: state.characterId,
      message: userMessage,
      relationshipMode: state.relationshipMode,
      history: nextHistory
    };

    try {
      const done = await sendMessageStream(request, {
        onChunk: ({ text }) => {
          upsertAssistantBubble(text, true);
          if (!gotRemoteEmotion) {
            const fallbackEmotion = inferLocalEmotion(text);
            setState((prev) => ({ ...prev, emotion: fallbackEmotion }));
          }
        },
        onEmotion: (nextEmotion) => {
          gotRemoteEmotion = true;
          setState((prev) => ({ ...prev, emotion: nextEmotion }));
        },
        onDone: (payload: StreamDoneResponse) => {
          setState((prev) => ({
            ...prev,
            emotion: payload.emotion,
            relationshipMode: payload.context?.activeRelationshipMode || prev.relationshipMode,
            context: payload.context ?? prev.context
          }));
          upsertAssistantBubble(payload.text, false);
          speakAudio(resolveMediaUrl(payload.audioUrl), payload.text);
        }
      });
      if (!done) return;
    } catch {
      try {
        const payload = await sendMessage(request);
        setState((prev) => ({
          ...prev,
          emotion: payload.emotion,
          relationshipMode: payload.context?.activeRelationshipMode || prev.relationshipMode,
          context: payload.context ?? prev.context,
          messages: [...prev.messages, { role: "assistant", content: payload.text }]
        }));
        if (payload.audioUrl) {
          speakAudio(resolveMediaUrl(payload.audioUrl), payload.text);
        }
      } catch (_e) {
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, { role: "assistant", content: "网络异常了，先等下下。" }]
        }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const submit = async (evt: FormEvent) => {
    evt.preventDefault();
    await submitMessage(input);
  };

  const setInputWithEmotion = (nextInput: string) => {
    setInput(nextInput);
    if (!isLoading) {
      setState((prev) => ({
        ...prev,
        emotion: inferLocalEmotion(nextInput)
      }));
    }
  };

  const saveUserMemory = () => {
    try {
      const saved = writeStoredUserMemory(userMemory);
      setUserMemory(saved);
      setMemoryStatus(hasUserMemory(saved) ? "记忆已保存，会从下一条消息开始生效。" : "记忆已清空。");
    } catch {
      setMemoryStatus("保存失败，请检查浏览器本地存储权限。");
    }
  };

  const clearUserMemory = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(USER_MEMORY_STORAGE_KEY);
    }
    setUserMemory({ ...emptyUserMemory });
    setMemoryStatus("记忆已清空。");
  };

  const resetConversation = async () => {
    if (isLoading) return;

    const currentCharacter = characters.find((item) => item.id === state.characterId) || initialCharacter || null;
    const resetCharacterId = currentCharacter?.id || state.characterId || selectedCharacterId || "lina";
    const resetState = buildDefaultChatState(currentCharacter || undefined, resetCharacterId, welcomeText);
    removeStoredChatState(sessionId, resetCharacterId);
    setIsLoading(true);
    try {
      await clearSessionHistory(sessionId);
    } catch {
      // ignore clear failures
    }

    onResetSession();
    stopSpeaking();

    setState(resetState);
    setInput("");
    setSpeaking(false);
    setSpeechError("");
    setIsLoading(false);
    stopSpeechRecognition();
    stopMediaRecorder();
  };

  const switchCharacter = (nextId: string) => {
    const selected = characters.find((c) => c.id === nextId);
    onCharacterChange(nextId);
    activeChatStorageKeyRef.current = getChatStateStorageKey(sessionId, nextId);
    setState(
      readStoredChatState(sessionId, selected, welcomeText) ||
      buildDefaultChatState(selected, nextId, welcomeText)
    );
  };

  const removeCharacter = async () => {
    if (isLoading) return;

    const currentId = state.characterId || selectedCharacterId;
    if (!currentId || !isCustomCharacter(currentId)) {
      return;
    }

    setIsLoading(true);
    try {
      await onDelete(currentId);
      removeStoredChatStatesForCharacter(currentId);
      const remaining = characters.filter((item) => item.id !== currentId);
      const fallbackCharacter = remaining[0];
      if (fallbackCharacter?.id) {
        activeChatStorageKeyRef.current = getChatStateStorageKey(sessionId, fallbackCharacter.id);
        setState(
          readStoredChatState(sessionId, fallbackCharacter, welcomeText) ||
          buildDefaultChatState(fallbackCharacter, fallbackCharacter.id, welcomeText)
        );
        onCharacterChange(fallbackCharacter.id);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelFile = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    const isModelFile =
      file.name.toLowerCase().endsWith(".glb") ||
      file.name.toLowerCase().endsWith(".gltf") ||
      file.type === "model/gltf-binary" ||
      file.type === "model/gltf+json";

    if (!isModelFile) {
      setSpeechError("请上传 .glb 或 .gltf 模型文件");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    modelObjectUrlsRef.current.push(objectUrl);
    setForm((prev) => ({ ...prev, modelUrl: objectUrl }));
    setIsModelUploading(true);
    setSpeechError("模型已进入本地预览，正在尝试上传到后端...");

    try {
      const fileBase64 = await blobToBase64(file);
      const uploaded = await uploadModelFile({
        fileName: file.name,
        fileBase64,
        mimeType: file.type || undefined,
        fallbackUrl: objectUrl
      });
      setForm((prev) => ({ ...prev, modelUrl: uploaded.modelUrl }));
      setSpeechError(uploaded.hasFallback ? "静态模式已使用本地模型预览；刷新页面后请重新上传。" : "模型已上传，可创建持久化 3D 数字人。");
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : "模型上传失败，已保留本地预览");
    } finally {
      setIsModelUploading(false);
    }
  };

  const create = async (evt: FormEvent) => {
    evt.preventDefault();
    if (isLoading || isModelUploading) return;

    const emotionProfile = parseEmotionProfile(form.emotionProfile);
    const avatarVideoProfile = parseEmotionProfile(form.avatarVideoProfile);
    const payload: CreateHumanRequest = {
      name: form.name.trim(),
      description: form.description.trim(),
      avatarUrl: form.avatarUrl.trim(),
      modelUrl: form.modelUrl.trim() || undefined,
      avatarType: form.avatarType,
      voiceProvider: form.voiceProvider,
      voice: form.voice.trim() || "nova",
      defaultMood: form.defaultMood,
      personalityTagline: form.personalityTagline.trim(),
      relationshipMode: form.relationshipMode,
      ...(emotionProfile ? { emotionProfile } : {}),
      ...(avatarVideoProfile ? { avatarVideoProfile } : {})
    };

    if (!payload.name || !payload.description || !payload.avatarUrl || !payload.voice) {
      setSpeechError("请完整填写数字人信息");
      return;
    }

    try {
      const created = await createDigitalHuman(payload);
      onCreate(created.human);
      onCharacterChange(created.human.id);
      activeChatStorageKeyRef.current = getChatStateStorageKey(sessionId, created.human.id);
      setState(buildDefaultChatState(created.human, created.human.id, welcomeText));
      setForm({
        ...form,
        name: "",
        description: "",
        avatarUrl: defaultAvatarUrl,
        modelUrl: "",
        voiceProvider: "openai",
        voice: "nova",
        emotionProfile: "{}",
        avatarType: "image",
        avatarVideoProfile: "{}",
        personalityTagline: "",
        relationshipMode: "sweet",
        defaultMood: "neutral"
      });
    } catch (_e) {
      // create failed: keep form for retry, do not block chat
    }
  };

  const toggleVoiceInput = () => {
    if (isLoading || isTranscribing) {
      return;
    }

    if (!speechSupported && !mediaRecorderSupported) {
      setSpeechError("当前环境不支持语音输入，请手动输入");
      return;
    }

    if (isRecording) {
      stopSpeechRecognition();
      stopMediaRecorder();
      return;
    }

    if (speechSupported) {
      startSpeechRecognition();
      return;
    }

    void startMediaRecorder();
  };

  const startVoiceHold = () => {
    if (isLoading || isTranscribing) {
      return;
    }

    suppressClickAfterHoldRef.current = true;
    toggleVoiceInput();
  };

  const stopVoiceHold = () => {
    if (!isRecording || isLoading || isTranscribing) {
      return;
    }

    stopSpeechRecognition();
    stopMediaRecorder();
  };

  const canUseVoiceInput = speechSupported || mediaRecorderSupported;

  const toggleAvatarMode = () => {
    setUse3D((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(AVATAR_MODE_STORAGE_KEY, next ? "3d" : "2d");
      }
      return next;
    });
  };

  const onVoiceButtonClick = () => {
    if (suppressClickAfterHoldRef.current) {
      suppressClickAfterHoldRef.current = false;
      return;
    }

    toggleVoiceInput();
  };

  const exportArchive = () => {
    if (typeof window === "undefined") return;

    try {
      const archive = buildLocalArchive(sessionId, state.characterId || selectedCharacterId || "lina", state);
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `digital-girlfriend-archive-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSpeechError(`已导出 ${archive.localHumans.length} 个自定义数字人和 ${archive.chatStates.length} 组聊天记录。`);
    } catch {
      setSpeechError("导出失败，请稍后重试");
    }
  };

  const importArchive = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const result = importLocalArchive(JSON.parse(raw));
      setSpeechError(`已导入 ${result.humans} 个数字人、${result.chats} 组聊天记录${result.hasMemory ? "和长期记忆" : ""}，正在刷新...`);
      window.setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      setSpeechError(error instanceof Error ? error.message : "导入失败，请检查 JSON 文件");
    } finally {
      if (archiveInputRef.current) {
        archiveInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="layout">
      <section className="left">
        <div className="persona-card">
          <h2>数字人</h2>
          <label>切换形象</label>
          <select value={state.characterId} onChange={(evt) => switchCharacter(evt.target.value)}>
            {characters.map((char) => (
              <option key={char.id} value={char.id}>
                {char.name}
              </option>
            ))}
          </select>
          <label>关系风格</label>
          <select
            value={state.relationshipMode}
            onChange={(evt) => {
              setState((prev) => ({
                ...prev,
                relationshipMode: evt.target.value as (typeof relationshipModes)[number]
              }));
            }}
          >
            {relationshipModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          {isCustomCharacter(state.characterId) ? (
            <button type="button" className="delete-btn" onClick={removeCharacter} disabled={isLoading}>
              删除当前数字人
            </button>
          ) : null}
          <p className="desc">{characters.find((c) => c.id === state.characterId)?.description}</p>
        </div>

        <form onSubmit={create} className="creator">
          <h3>创建数字人</h3>
          <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="名字" />
          <input
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="人设描述"
          />
          <input
            value={form.avatarUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, avatarUrl: e.target.value }))}
            placeholder="头像地址"
          />
          <input
            value={form.modelUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, modelUrl: e.target.value }))}
            placeholder="3D模型地址（GLB/GLTF，可选）"
          />
          <label className="file-picker">
            上传 GLB/GLTF 模型
            <input
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              onChange={(e) => handleModelFile(e.currentTarget.files)}
            />
          </label>
          <input value={form.voice} onChange={(e) => setForm((prev) => ({ ...prev, voice: e.target.value }))} placeholder="声音 ID（例如 alloy/nova）" />
          <select
            value={form.voiceProvider}
            onChange={(e) => setForm((prev) => ({ ...prev, voiceProvider: e.target.value as "openai" | "azure" | "local" }))}
          >
            <option value="openai">OpenAI TTS</option>
            <option value="azure">Azure TTS（需配置服务）</option>
            <option value="local">本地/禁用 TTS</option>
          </select>
          <select
            value={form.defaultMood}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, defaultMood: e.target.value as (typeof moods)[number] }))
            }
          >
            {moods.map((mood) => (
              <option key={mood} value={mood}>
                {mood}
              </option>
            ))}
          </select>
          <input
            value={form.personalityTagline}
            onChange={(e) => setForm((prev) => ({ ...prev, personalityTagline: e.target.value }))}
            placeholder="人设口令（例如：轻松撒娇，但不越界）"
          />
          <select
            value={form.relationshipMode}
            onChange={(e) => setForm((prev) => ({ ...prev, relationshipMode: e.target.value as (typeof relationshipModes)[number] }))}
          >
            {relationshipModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <select
            value={form.avatarType}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, avatarType: e.target.value === "video" ? "video" : "image" }))
            }
          >
            <option value="image">头像/表情图模式</option>
            <option value="video">情绪视频模式</option>
          </select>
          <textarea
            rows={3}
            value={form.emotionProfile}
            onChange={(e) => setForm((prev) => ({ ...prev, emotionProfile: e.target.value }))}
            placeholder={`情绪头像（可选）示例：{ "happy": "https://.../happy.png", "sad": "${assetPlaceholderBase}/expressions/sad.svg", "wink": "..." }`}
          />
          <textarea
            rows={3}
            value={form.avatarVideoProfile}
            onChange={(e) => setForm((prev) => ({ ...prev, avatarVideoProfile: e.target.value }))}
            placeholder={`情绪视频（可选，avatarType=video时生效）示例：{ "happy": "${assetPlaceholderBase}/videos/happy.mp4", "neutral": "https://.../neutral.mp4" }`}
          />
          <button type="submit" disabled={isModelUploading}>
            {isModelUploading ? "上传模型中..." : "创建"}
          </button>
        </form>

        <Avatar
          emotion={state.emotion}
          speaking={speaking}
          avatarUrl={activeCharacter?.avatarUrl || defaultAvatarUrl}
          modelUrl={activeCharacter?.modelUrl}
          name={activeCharacter?.name || "数字人"}
          emotionProfile={activeCharacter?.emotionProfile}
          avatarType={activeCharacter?.avatarType}
          avatarVideoProfile={activeCharacter?.avatarVideoProfile}
          use3D={use3D}
        />

        <section className="relationship-card">
          <h3>关系状态</h3>
          <p>
            阶段：{state.context ? relationshipLabelMap[state.context.relationshipAffinity] : "待启动"}（{state.context?.turnCount || 0}
            回合）
          </p>
          <p>对话风格：{state.relationshipMode || state.context?.activeRelationshipMode || "sweet"}</p>
          <p>上次情绪：{state.context?.lastEmotion || state.emotion}</p>
          {state.context?.summary ? <p className="relationship-summary">{state.context.summary}</p> : null}
          {state.context?.userSignals?.length ? (
            <p className="relationship-signals">关键词：{state.context.userSignals.join("、")}</p>
          ) : null}
        </section>

        <section className="memory-card">
          <div className="memory-title">
            <Brain size={16} />
            <h3>长期记忆</h3>
            <span className={memoryIsActive ? "memory-state active" : "memory-state"}>{memoryIsActive ? "已启用" : "未设置"}</span>
          </div>
          <label>我是谁</label>
          <input
            value={userMemory.displayName}
            onChange={(e) => setUserMemory((prev) => ({ ...prev, displayName: e.target.value }))}
            placeholder="例如：林，做科研和产品"
          />
          <label>希望她怎么称呼我</label>
          <input
            value={userMemory.preferredName}
            onChange={(e) => setUserMemory((prev) => ({ ...prev, preferredName: e.target.value }))}
            placeholder="例如：哥哥 / 阿林 / 亲爱的"
          />
          <label>聊天偏好</label>
          <textarea
            rows={2}
            value={userMemory.preferences}
            onChange={(e) => setUserMemory((prev) => ({ ...prev, preferences: e.target.value }))}
            placeholder="例如：语气自然一点，开心时可以撒娇，压力大时先安慰"
          />
          <label>重要事实</label>
          <textarea
            rows={2}
            value={userMemory.importantFacts}
            onChange={(e) => setUserMemory((prev) => ({ ...prev, importantFacts: e.target.value }))}
            placeholder="例如：最近在做数字女友项目、经常晚上工作"
          />
          <label>聊天禁忌或边界</label>
          <textarea
            rows={2}
            value={userMemory.boundaries}
            onChange={(e) => setUserMemory((prev) => ({ ...prev, boundaries: e.target.value }))}
            placeholder="例如：不要说教；不喜欢机械式客服语气"
          />
          <label>关系备注</label>
          <textarea
            rows={2}
            value={userMemory.relationshipNotes}
            onChange={(e) => setUserMemory((prev) => ({ ...prev, relationshipNotes: e.target.value }))}
            placeholder="例如：关系节奏偏暧昧、直接、陪伴感强"
          />
          <div className="memory-actions">
            <button type="button" onClick={saveUserMemory}>
              <Save size={15} />
              保存记忆
            </button>
            <button type="button" className="secondary-btn" onClick={clearUserMemory}>
              清空
            </button>
          </div>
          {memoryStatus ? <p className="memory-status">{memoryStatus}</p> : null}
        </section>
      </section>

      <section className="right">
        <div className="chat-tools">
          <button type="button" onClick={resetConversation} disabled={isLoading}>
            清空对话
          </button>
          <button type="button" onClick={exportArchive} disabled={isLoading} title="导出本地数字人和聊天记录">
            <Download size={16} />
            导出记录
          </button>
          <button
            type="button"
            onClick={() => archiveInputRef.current?.click()}
            disabled={isLoading}
            title="导入本地数字人和聊天记录"
          >
            <Upload size={16} />
            导入记录
          </button>
          <input
            ref={archiveInputRef}
            className="archive-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importArchive(event.currentTarget.files)}
          />
          <button
            type="button"
            onClick={toggleAvatarMode}
            title={use3D ? "切换到 2D 头像" : "切换到 3D 数字人"}
            aria-label={use3D ? "切换到 2D 头像" : "切换到 3D 数字人"}
          >
            {use3D ? <Box size={16} /> : <ImageIcon size={16} />}
            {use3D ? "3D" : "2D"}
          </button>
        </div>
        <div className="chat-list" ref={chatScrollRef}>
          {state.messages.map((message, idx) => (
            <div key={`${message.role}-${idx}`} className={`bubble ${message.role}`}>
              <strong>{message.role === "user" ? "我" : "她"}：</strong> {message.content}
            </div>
          ))}
        </div>
        <form onSubmit={submit} className="input-bar">
          {canUseVoiceInput ? (
          <button
            type="button"
            className={`voice-btn ${isRecording ? "recording" : isTranscribing ? "loading" : ""}`}
            onMouseDown={startVoiceHold}
            onMouseUp={stopVoiceHold}
            onMouseLeave={stopVoiceHold}
            onTouchStart={startVoiceHold}
            onTouchEnd={stopVoiceHold}
            onTouchCancel={stopVoiceHold}
            onClick={onVoiceButtonClick}
            aria-label={isRecording ? "停止录音" : isTranscribing ? "语音识别中" : "开始语音输入"}
            disabled={isLoading || isTranscribing}
          >
            {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
            {isRecording ? "松开发送" : isTranscribing ? "识别中..." : "按住说话"}
          </button>
          ) : null}
          <input
            value={input}
            onChange={(e) => setInputWithEmotion(e.target.value)}
            placeholder="输入你想说的话，聊天不设限"
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            <Send size={18} />
            发送
          </button>
        </form>
        {speechError ? <div className="speech-hint" role="status">{speechError}</div> : null}
      </section>
      <audio ref={audioRef} />
    </div>
  );
}
