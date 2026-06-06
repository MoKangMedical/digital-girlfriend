import { FormEvent, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send } from "lucide-react";
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
  transcribeSpeech
} from "../services/api";
import { Avatar } from "./Avatar";

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

const localMoodKeywords: Record<LocalEmotion, string[]> = {
  happy: ["开心", "高兴", "好", "棒", "喜欢", "爱", "甜", "nice", "cool", "great", "好笑", "哈哈", "快乐", "开心死了", "太好了"],
  sad: ["难过", "伤心", "失落", "烦", "哭", "sad", "难受", "心碎", "失望"],
  surprise: ["惊讶", "真的吗", "怎么", "哇", "wow", "天啊", "不可思议", "没想到", "太突然", "惊人"],
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

interface NewCharacterForm {
  name: string;
  description: string;
  avatarUrl: string;
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
  const arrayBuffer = await blob.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
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
  const [state, setState] = useState<State>({
    messages: [{ role: "assistant", content: welcomeText }],
    emotion: initialCharacter?.defaultMood || "neutral",
    characterId: initialCharacter?.id || selectedCharacterId || "lina",
    relationshipMode: initialCharacter?.relationshipMode || "sweet"
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [mediaRecorderSupported, setMediaRecorderSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [form, setForm] = useState<NewCharacterForm>({
    name: "",
    description: "",
    avatarUrl: "/assets/avatars/lina.svg",
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
  const suppressClickAfterHoldRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const activeCharacter = characters.find((item) => item.id === state.characterId) || initialCharacter || characters[0];
  const isCustomCharacter = (characterId: string) => characterId.startsWith("custom-");

  useEffect(() => {
    const preferred = characters.find((item) => item.id === selectedCharacterId) || characters[0];
    if (!preferred) return;
    setState((prev) => {
      if (prev.characterId === preferred.id) {
        return {
          ...prev,
          relationshipMode: prev.relationshipMode || preferred.relationshipMode || "sweet"
        };
      }
      return {
        ...prev,
        characterId: preferred.id,
        emotion: preferred.defaultMood || prev.emotion,
        relationshipMode: preferred.relationshipMode || prev.relationshipMode || "sweet"
      };
    });
  }, [selectedCharacterId, characters]);

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
    const nextHistory: ApiHistoryMessage[] = [...state.messages, userBubble].map((message) => ({
      role: message.role,
      content: message.content
    }));

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

  const resetConversation = async () => {
    if (isLoading) return;

    const currentCharacter = characters.find((item) => item.id === state.characterId) || initialCharacter || null;
    setIsLoading(true);
    try {
      await clearSessionHistory(sessionId);
    } catch {
      // ignore clear failures
    }

    onResetSession();
    stopSpeaking();

    setState({
      messages: [{ role: "assistant", content: welcomeText }],
      emotion: currentCharacter?.defaultMood || "neutral",
      characterId: currentCharacter?.id || state.characterId || selectedCharacterId || "lina",
      relationshipMode: currentCharacter?.relationshipMode || state.relationshipMode || "sweet",
      context: undefined
    });
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
    setState((prev) => ({
      ...prev,
      characterId: nextId,
      emotion: selected?.defaultMood || prev.emotion,
      relationshipMode: selected?.relationshipMode || prev.relationshipMode || "sweet"
    }));
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
      const remaining = characters.filter((item) => item.id !== currentId);
      const fallback = remaining[0]?.id || "";
      if (fallback) {
        setState((prev) => ({ ...prev, characterId: fallback, emotion: remaining[0]?.defaultMood || prev.emotion }));
        onCharacterChange(fallback);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const create = async (evt: FormEvent) => {
    evt.preventDefault();
    if (isLoading) return;

    const emotionProfile = parseEmotionProfile(form.emotionProfile);
    const avatarVideoProfile = parseEmotionProfile(form.avatarVideoProfile);
    const payload: CreateHumanRequest = {
      name: form.name.trim(),
      description: form.description.trim(),
      avatarUrl: form.avatarUrl.trim(),
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
      setState((prev) => ({
        ...prev,
        characterId: created.human.id,
        emotion: created.human.defaultMood,
        relationshipMode: created.human.relationshipMode || state.relationshipMode || "sweet",
        context: undefined
      }));
      setForm({
        ...form,
        name: "",
        description: "",
        avatarUrl: "/assets/avatars/lina.svg",
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

  const onVoiceButtonClick = () => {
    if (suppressClickAfterHoldRef.current) {
      suppressClickAfterHoldRef.current = false;
      return;
    }

    toggleVoiceInput();
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
            placeholder='情绪头像（可选）示例：{ "happy": "https://.../happy.png", "sad": "/assets/expressions/sad.png", "wink": "..." }'
          />
          <textarea
            rows={3}
            value={form.avatarVideoProfile}
            onChange={(e) => setForm((prev) => ({ ...prev, avatarVideoProfile: e.target.value }))}
            placeholder='情绪视频（可选，avatarType=video时生效）示例：{ "happy": "/assets/videos/happy.mp4", "neutral": "https://.../neutral.mp4" }'
          />
          <button type="submit">创建</button>
        </form>

        <Avatar
          emotion={state.emotion}
          speaking={speaking}
          avatarUrl={activeCharacter?.avatarUrl || "/assets/avatars/lina.svg"}
          name={activeCharacter?.name || "数字人"}
          emotionProfile={activeCharacter?.emotionProfile}
          avatarType={activeCharacter?.avatarType}
          avatarVideoProfile={activeCharacter?.avatarVideoProfile}
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
      </section>

      <section className="right">
        <div className="chat-tools">
          <button type="button" onClick={resetConversation} disabled={isLoading}>
            清空对话
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
