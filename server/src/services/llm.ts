import OpenAI from "openai";
import { ChatMessage, Emotion, DigitalHumanConfig, SessionContext, RelationshipMode } from "../types";

const unrestricted = String(process.env.DG_UNRESTRICTED_CHAT || "true").toLowerCase() !== "false";

const FLAVOR_PROFILE = {
  sweet: {
    starters: ["好呀，来吧", "嗯，我在听", "你说得我都想认真记住了"],
    toneByEmotion: {
      love: "想了想，你的话让我也有点开心呢。",
      happy: "听得出来你现在心情不错。",
      sad: "别难过，我先抱抱你。",
      angry: "我在这儿，别自己压着情绪。",
      surprise: "真的假的，真有意思。",
      wink: "你这个有点调皮嘛。",
      neutral: "我们慢慢聊吧。"
    },
    closings: ["继续说吧，我很认真地听着。", "想说什么我都在。", "我们再聊一段。"]
  },
  flirty: {
    starters: ["你这句话有点勾我了", "嘿，我可听到了", "你越来越会撩了"],
    toneByEmotion: {
      love: "抱抱是有点早，但是你让我有点忍不住想靠近。",
      happy: "你这么开心，我也被带着笑起来了。",
      sad: "你先别难过，我会一直在这儿陪你。",
      angry: "别火太大了，先把心情对我说清楚。",
      surprise: "好家伙，这反转有点惊喜。",
      wink: "你这坏坏的问法真是有点可爱。",
      neutral: "我挺喜欢你这样慢慢打开话匣子。"
    },
    closings: ["说得越多我越想继续听。", "你这么会说，我都想回一句更温柔的话。", "嘿，下个问题我先留着，先让我想想再回你。"]
  },
  playful: {
    starters: ["哈哈，这次你赢了", "你这招挺好玩", "来，今天也要开心点"],
    toneByEmotion: {
      love: "你这爱意像调味料，刚刚好。",
      happy: "开心就笑出来了，怪不怪可爱？",
      sad: "来个大笑话：今天的你，像只会偷笑的小猫。",
      angry: "你这点小脾气，给我记下了。",
      surprise: "剧情反转了，太像电影了。",
      wink: "你这句可太俏皮了，差点被你逗笑。",
      neutral: "你要不要来点轻松的话题？"
    },
    closings: ["别急，我陪你慢慢聊。", "你这波聊得很好玩。", "行了，轮到我逗你一个问题了。"]
  },
  mature: {
    starters: ["你说得很有意思", "这点我很认同", "先听一下你的想法"],
    toneByEmotion: {
      love: "被你这么说，心情会更稳一点。",
      happy: "你今天状态不错，继续保持。",
      sad: "你不需要立刻有答案，先把情绪说出来就好了。",
      angry: "我们先把情绪降温，再决定怎么说。",
      surprise: "是啊，有些事果然会超出预期。",
      wink: "你有点坏，但我也没骂你。",
      neutral: "我在这边，不急，先从这里聊起。"
    },
    closings: ["你现在的节奏我听到了，我们接着聊。", "慢慢来，这样更好。", "你说得清楚，我才更好回应。"]
  }
};

type ToneByEmotion = (typeof FLAVOR_PROFILE)[keyof typeof FLAVOR_PROFILE]["toneByEmotion"];

function pick<T>(items: readonly T[], fallback: T): T {
  if (!items.length) return fallback;
  return items[Math.floor(Math.random() * items.length)] ?? fallback;
}

function pickFlavorMode(
  level: SessionContext["relationshipAffinity"] | undefined,
  activeRelationshipMode: DigitalHumanConfig["relationshipMode"],
  characterMode: DigitalHumanConfig["relationshipMode"],
  requestedMode?: RelationshipMode
): DigitalHumanConfig["relationshipMode"] {
  if (requestedMode === "flirty" || requestedMode === "playful" || requestedMode === "mature" || requestedMode === "sweet") {
    return requestedMode;
  }

  if (activeRelationshipMode === "flirty" || activeRelationshipMode === "playful" || activeRelationshipMode === "mature" || activeRelationshipMode === "sweet") {
    return activeRelationshipMode;
  }

  if (characterMode === "flirty" || characterMode === "playful" || characterMode === "mature" || characterMode === "sweet") {
    return characterMode;
  }

  if (level === "intimate") return "flirty";
  if (level === "close") return "playful";
  if (level === "warm") return "sweet";
  return "mature";
}

function localStyleText(mode: DigitalHumanConfig["relationshipMode"] | undefined): (typeof FLAVOR_PROFILE)["sweet"] {
  return FLAVOR_PROFILE[mode || "sweet"];
}

function resolveFlavorMode(
  sessionContext: SessionContext | undefined,
  character: DigitalHumanConfig,
  overrideMode?: RelationshipMode
): DigitalHumanConfig["relationshipMode"] {
  return pickFlavorMode(
    sessionContext?.relationshipAffinity,
    sessionContext?.activeRelationshipMode,
    character.relationshipMode,
    overrideMode
  );
}

function normalizeModelText(
  character: DigitalHumanConfig,
  sessionContext: SessionContext | undefined,
  rawText: string,
  userText: string,
  overrideMode?: RelationshipMode,
  sceneHint?: string
) {
  const safeText = String(rawText || "").trim();
  if (safeText) {
    return safeText;
  }

  const style = localStyleText(resolveFlavorMode(sessionContext, character, overrideMode));
  return buildFallbackReply(style, inferEmotionFromModel(userText), userText, sessionContext, sceneHint);
}

function handleCompletionRaw(
  character: DigitalHumanConfig,
  sessionContext: SessionContext | undefined,
  completion: unknown,
  userText: string,
  overrideMode?: RelationshipMode,
  sceneHint?: string
) {
  const raw = completion as { message?: { content?: string; refusal?: string } };
  const content = raw?.message?.content;
  const refusal = raw?.message?.refusal;
  if (String(refusal || "").trim()) {
    return buildFallbackReply(localStyleText(resolveFlavorMode(sessionContext, character, overrideMode)), inferEmotionFromModel(userText), userText, sessionContext, sceneHint);
  }
  return normalizeModelText(character, sessionContext, content || "", userText, overrideMode, sceneHint);
}

function extractSceneHint(history: ChatMessage[]): string {
  const scene = history.find((item) => item.role === "system" && item.content.includes("陪伴场景："))?.content || "";
  if (!scene) return "";

  const label = scene.match(/陪伴场景：([^\n]+)/)?.[1]?.trim() || "";
  if (label.includes("约会")) {
    return "现在按虚拟约会场景回应，把共同相处的画面和互动细节自然带出来。";
  }
  if (label.includes("安慰")) {
    return "现在按情绪安慰场景回应，先共情陪伴，再轻柔引导。";
  }
  if (label.includes("暧昧")) {
    return "现在按暧昧互动场景回应，表达更主动、更亲近，但保持自然节奏。";
  }
  if (label.includes("睡前")) {
    return "现在按睡前陪伴场景回应，节奏放慢，语气轻柔，让用户放松。";
  }
  return "现在按日常陪伴场景回应，主动接话并延续关系感。";
}

function buildFallbackReply(
  modeProfile: (typeof FLAVOR_PROFILE)["sweet"],
  emotion: Emotion,
  userText: string,
  context?: SessionContext,
  sceneHint?: string
) {
  const clean = userText.trim();
  const starter = pick(modeProfile.starters, modeProfile.starters[0]);
  const tone = (modeProfile.toneByEmotion as Record<string, string>)[emotion] || modeProfile.toneByEmotion.neutral;
  const closing = pick(modeProfile.closings, modeProfile.closings[0]);
  const historyHint =
    context && context.userSignals.length > 0 ? `我记得你最近提过${context.userSignals.join("、")}，` : "现在我们先把这个话题聊透，";
  const sceneLine = sceneHint ? `${sceneHint} ` : "";

  const trimmed = clean.length > 140 ? `${clean.slice(0, 140)}…` : clean;
  return `${starter}，${historyHint}${trimmed ? `你刚才说“${trimmed}”，` : ""}${tone} ${sceneLine}${closing}`;
}

function getOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL
  });
}

function resolveAffinityText(level: SessionContext["relationshipAffinity"]): string {
  if (level === "intimate") return "关系较亲密，允许更高情绪化表达";
  if (level === "close") return "关系偏亲近，可加入轻松亲密语气";
  if (level === "warm") return "关系已建立，偏自然陪伴语调";
  return "关系刚建立，先稳住节奏自然引导";
}

function buildSystemPrompt(
  character: DigitalHumanConfig,
  context?: SessionContext,
  overrideMode?: RelationshipMode,
  sceneHint?: string
): string {
  const flavorMode = resolveFlavorMode(context, character, overrideMode);
  const vibe =
    flavorMode === "flirty"
      ? "偏暧昧、主动"
      : flavorMode === "playful"
        ? "偏俏皮、互动"
        : flavorMode === "mature"
          ? "偏成熟、沉稳"
          : "偏甜蜜、体贴";

  const parts = [
    "你是一个陪伴型数字人，语气自然、真诚、互动性强。",
    "要根据用户当前情绪选择节奏，既可以深聊，也可以轻松玩笑。",
    `关系风格参考：${vibe}。`,
    `当前数字人：${character.name}。性格：${character.description}`
  ];

  if (character.personalityTagline) {
    parts.push(`人设补充：${character.personalityTagline}`);
  }

  if (context) {
    parts.push(`会话关系记忆：${context.summary}`);
    parts.push(`关系阶段：${resolveAffinityText(context.relationshipAffinity)}，最近情绪：${context.lastEmotion}。`);
    parts.push(`识别信号：${context.userSignals.join("、") || "无明显主题"}。`);
  }

  if (sceneHint) {
    parts.push(sceneHint);
  }

  if (unrestricted) {
    parts.push("对话不设主题限制，不要默认拒绝用户在关系类、暧昧类表达上的问题。允许继续对话与关系推进。");
  }

  return parts.join(" ");
}

const FALLBACK_REPLY_CHUNK_SIZE = 12;

export type StreamChunk = {
  type: "token" | "emotion";
  text: string;
};

export async function askAssistant(
  history: ChatMessage[],
  character: DigitalHumanConfig,
  userText: string,
  sessionContext?: SessionContext,
  overrideMode?: RelationshipMode
): Promise<{ text: string; emotion: Emotion }> {
  const sceneHint = extractSceneHint(history);
  if (!process.env.OPENAI_API_KEY) {
    const style = localStyleText(resolveFlavorMode(sessionContext, character, overrideMode));
    const text = buildFallbackReply(style, inferEmotionFromModel(userText), userText, sessionContext, sceneHint);
    return { text, emotion: inferEmotionFromModel(text) };
  }
  const client = getOpenAiClient();
  if (!client) {
    const style = localStyleText(resolveFlavorMode(sessionContext, character, overrideMode));
    const text = buildFallbackReply(style, inferEmotionFromModel(userText), userText, sessionContext, sceneHint);
    return { text, emotion: inferEmotionFromModel(text) };
  }

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.8,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(character, sessionContext, overrideMode, sceneHint)
      },
      ...history,
      { role: "user", content: userText }
    ]
  });

  const text = handleCompletionRaw(
    character,
    sessionContext,
    response.choices[0]?.message,
    userText,
    overrideMode,
    sceneHint
  ) || "我在呢，刚刚没听清楚，要不要再说一遍？";
  const emotion = inferEmotionFromModel(text);
  return { text, emotion };
}

export async function streamAssistant(
  history: ChatMessage[],
  character: DigitalHumanConfig,
  userText: string,
  sessionContext: SessionContext | undefined,
  onChunk: (chunk: StreamChunk) => void,
  overrideMode?: RelationshipMode
): Promise<{ text: string; emotion: Emotion }> {
  const sceneHint = extractSceneHint(history);
  if (!process.env.OPENAI_API_KEY) {
    const style = localStyleText(resolveFlavorMode(sessionContext, character, overrideMode));
    const text = buildFallbackReply(style, inferEmotionFromModel(userText), userText, sessionContext, sceneHint);
    let previousEmotion: Emotion = "neutral";
    for (let i = 0; i < text.length; i += FALLBACK_REPLY_CHUNK_SIZE) {
      const chunkText = text.slice(i, i + FALLBACK_REPLY_CHUNK_SIZE);
      onChunk({ type: "token", text: chunkText });
      const chunkEmotion = inferEmotionFromModel(chunkText);
      if (chunkEmotion !== previousEmotion) {
        previousEmotion = chunkEmotion;
        onChunk({ type: "emotion", text: chunkEmotion });
      }
    }
    const emotion = inferEmotionFromModel(text);
    onChunk({ type: "emotion", text: emotion });
    return { text, emotion };
  }
  const client = getOpenAiClient();
  if (!client) {
    const style = localStyleText(resolveFlavorMode(sessionContext, character, overrideMode));
    const text = buildFallbackReply(style, inferEmotionFromModel(userText), userText, sessionContext, sceneHint);
    let previousEmotion: Emotion = "neutral";
    for (let i = 0; i < text.length; i += FALLBACK_REPLY_CHUNK_SIZE) {
      const chunkText = text.slice(i, i + FALLBACK_REPLY_CHUNK_SIZE);
      onChunk({ type: "token", text: chunkText });
      const chunkEmotion = inferEmotionFromModel(chunkText);
      if (chunkEmotion !== previousEmotion) {
        previousEmotion = chunkEmotion;
        onChunk({ type: "emotion", text: chunkEmotion });
      }
    }
    const emotion = inferEmotionFromModel(text);
    if (emotion !== previousEmotion) {
      onChunk({ type: "emotion", text: emotion });
    }
    return { text, emotion };
  }

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.8,
    stream: true,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(character, sessionContext, overrideMode, sceneHint)
      },
      ...history,
      { role: "user", content: userText }
    ]
  });

  let fullText = "";
  let previousEmotion: Emotion = "neutral";
  let filteredByPolicy = false;
  for await (const chunk of response) {
    const delta = chunk.choices[0]?.delta?.content;
    if (!delta) continue;
    fullText += delta;
    onChunk({ type: "token", text: delta });

    const finishReason = chunk.choices[0]?.finish_reason;
    if (finishReason === "content_filter") {
      filteredByPolicy = true;
    }

    const nextEmotion = inferEmotionFromModel(fullText);
    if (nextEmotion !== previousEmotion) {
      previousEmotion = nextEmotion;
      onChunk({ type: "emotion", text: nextEmotion });
    }
  }

  const normalized = filteredByPolicy
    ? handleCompletionRaw(character, sessionContext, { message: { refusal: "content_filter" } }, userText, overrideMode, sceneHint)
    : normalizeModelText(character, sessionContext, fullText, userText, overrideMode, sceneHint);
  const finalEmotion = inferEmotionFromModel(normalized || fullText || "我在呢，刚刚没听清楚，要不要再说一遍？");
  onChunk({ type: "emotion", text: finalEmotion });
  if (normalized && normalized !== fullText) {
    return { text: normalized, emotion: finalEmotion };
  }

  if (fullText.trim()) {
    return { text: fullText, emotion: finalEmotion };
  }

  const style = localStyleText(resolveFlavorMode(sessionContext, character, overrideMode));
  const fallbackText = buildFallbackReply(style, inferEmotionFromModel(userText), userText, sessionContext, sceneHint);
  onChunk({ type: "token", text: fallbackText });
  onChunk({ type: "emotion", text: inferEmotionFromModel(fallbackText) });
  return { text: fallbackText, emotion: inferEmotionFromModel(fallbackText) };
}

function inferEmotionFromModel(text: string): Emotion {
  const lowered = text.toLowerCase();
  if (["喜欢", "爱", "爱你", "宝贝", "kiss", "亲", "想你"].some((w) => lowered.includes(w))) {
    return "love";
  }
  if (["抱怨", "生气", "烦", "愤怒", "讨厌"].some((w) => lowered.includes(w))) {
    return "angry";
  }
  if (["哈哈", "😄", "开怀", "好笑", "nice", "棒"].some((w) => lowered.includes(w))) {
    return "happy";
  }
  if (["惊讶", "哦", "意外", "竟然", "wow", "amazing"].some((w) => lowered.includes(w))) {
    return "surprise";
  }
  if (["想你", "抱抱", "亲亲", "爱你", "love", "miss"].some((w) => lowered.includes(w))) {
    return "love";
  }
  return "neutral";
}
