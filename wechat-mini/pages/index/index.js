const STORAGE_KEY_SESSION = "dg-mini-session-id";
const STORAGE_KEY_CHARACTER = "dg-mini-character-id";

const expressionMap = {
  happy: "(^_^)",
  sad: "(T_T)",
  surprise: "(o_o)",
  wink: "(^_~)",
  neutral: "(•ᴗ•)",
  angry: "(>_<)",
  love: "(❤ω❤)"
};

const emotionTextMap = {
  happy: "开朗",
  sad: "难过",
  surprise: "惊讶",
  wink: "俏皮",
  neutral: "平静",
  angry: "生气",
  love: "甜蜜"
};

const relationshipLevelLabel = {
  new: "刚认识",
  warm: "有点熟",
  close: "很熟",
  intimate: "亲密"
};

const relationshipModes = ["sweet", "flirty", "playful", "mature"];

function getActiveCharacter(ctx) {
  return ctx.data.characters?.find((item) => item.id === ctx.data.characterId) || null;
}

function resolveEmotionImage(character, emotion) {
  if (!character || !character.emotionProfile) return "";
  const image = character.emotionProfile[emotion];
  return typeof image === "string" && image.trim() ? image : "";
}

function resolveEmotionVideo(character, emotion) {
  if (!character || !character.avatarVideoProfile) return "";
  const video = character.avatarVideoProfile[emotion];
  return typeof video === "string" && video.trim() ? video : "";
}

function normalizeEmotionProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return undefined;
  }

  const next = {};
  Object.keys(profile).forEach((key) => {
    if (typeof profile[key] === "string") {
      const fixed = resolveApiAsset(profile[key]);
      if (fixed) {
        next[key] = fixed;
      }
    }
  });

  return next;
}

function resolveApiAsset(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\//.test(trimmed) || /^data:|^blob:/i.test(trimmed)) {
    return trimmed;
  }

  const apiBase = getApiBase();
  if (!apiBase) return trimmed;
  return trimmed.startsWith("/") ? `${apiBase}${trimmed}` : `${apiBase}/${trimmed}`;
}

const localMoodKeywords = {
  happy: ["开心", "高兴", "开森", "棒", "喜欢", "爱", "甜", "nice", "great", "好笑", "哈哈", "开心死了", "太好了"],
  sad: ["难过", "伤心", "失落", "烦", "哭", "sad", "难受", "心碎", "失望"],
  surprise: ["惊讶", "真的吗", "怎么", "哇", "wow", "不可思议", "没想到", "太突然", "惊人"],
  wink: ["撩", "调皮", "开玩笑", "可爱", "俏皮", "坏", "flirty", "小坏蛋", "撒娇"],
  neutral: [],
  angry: ["生气", "烦", "愤怒", "气死", "讨厌", "烦躁", "annoyed", "hate", "你怎么"],
  love: ["想你", "宝贝", "亲爱", "抱抱", "亲亲", "kiss", "爱你", "恋爱", "想念", "我好想"]
};

function inferLocalEmotion(text) {
  const normalized = String(text || "").toLowerCase();
  let bestEmotion = "neutral";
  let bestScore = 0;

  Object.keys(localMoodKeywords).forEach((emotion) => {
    const score = localMoodKeywords[emotion].reduce((acc, keyword) => acc + (normalized.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestEmotion = emotion;
    }
  });

  return bestEmotion;
}

function getApiBase() {
  const apiBase = getApp().globalData.apiBase || "";
  return String(apiBase).replace(/\/$/, "");
}

function parseStreamText(raw) {
  const source = String(raw || "");

  if (!source.trim()) {
    return [];
  }

  if (source.trim().startsWith("{")) {
    try {
      const json = JSON.parse(source);
      return [{ event: "done", data: json }];
    } catch {
      return [];
    }
  }

  const lines = source.split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === "") {
      if (current) {
        events.push(current);
        current = null;
      }
      continue;
    }

    if (!current) {
      current = { event: "message", data: "" };
    }

    if (line.startsWith("event:")) {
      current.event = line.replace("event:", "").trim();
      continue;
    }
    if (line.startsWith("data:")) {
      current.data += line.replace("data:", "").trim();
    }
  }

  if (current) {
    events.push(current);
  }

  return events.filter((item) => item.data);
}

function resolveLastStateFromEvents(parsedEvents, fallbackText) {
  let text = "";
  let emotion = "";
  let audioUrl = "";
  let context = null;

  parsedEvents.forEach((evt) => {
    if (!evt || !evt.data) return;
    const data = evt.data;
    if (evt.event === "chunk" && typeof data.text === "string") {
      text += data.text;
    } else if (evt.event === "done" && typeof data.text === "string") {
      text = data.text;
      if (typeof data.emotion === "string") {
        emotion = data.emotion;
      }
      if (typeof data.audioUrl === "string") {
        audioUrl = data.audioUrl;
      }
      if (data.context && typeof data.context === "object") {
        context = data.context;
      }
    } else if (evt.event === "emotion" && typeof data.emotion === "string") {
      emotion = data.emotion;
    }
  });

  return {
    text: text || String(fallbackText || ""),
    emotion: emotion || "neutral",
    audioUrl,
    context
  };
}

function parseEventPayload(raw) {
  const rawEvents = parseStreamText(raw);
  if (rawEvents.length === 0) {
    return { events: [], chunks: [], final: null };
  }

  const events = rawEvents.map((evt) => {
    try {
      return {
        ...evt,
        data: JSON.parse(evt.data)
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  const chunks = [];
  let latestEmotion = "";
  let audioUrl = "";
  let context = null;
  let hasError = false;
  let done = null;
  events.forEach((evt) => {
    if (evt.event === "chunk" && typeof evt.data.text === "string") {
      chunks.push(evt.data.text);
    }
    if (evt.event === "emotion" && typeof evt.data.emotion === "string") {
      latestEmotion = evt.data.emotion;
    }
    if (evt.event === "done") {
      done = evt.data;
      if (typeof evt.data.audioUrl === "string") {
        audioUrl = evt.data.audioUrl;
      }
      if (evt.data && typeof evt.data.context === "object") {
        context = evt.data.context;
      }
    }
    if (evt.event === "error") {
      hasError = true;
    }
  });

  if (!done) {
    const maybeDone = resolveLastStateFromEvents(events, "");
    if (maybeDone.text || events.length === 1) {
      done = {
        text: maybeDone.text,
        emotion: maybeDone.emotion,
        context: maybeDone.context
      };
    }
  }

  context = context || (done && done.context) || null;

  return {
    chunks,
    final: done || { text: chunks.join(""), emotion: latestEmotion || "neutral" },
    audioUrl,
    context,
    events,
    hasError
  };
}

Page({
  data: {
    messages: [{ role: "assistant", content: "你好呀，欢迎回来～" }],
    emotion: "neutral",
    expression: expressionMap.neutral,
    expressionVideo: "",
    emotionLabel: emotionTextMap.neutral,
    expressionImage: "",
    relationshipAffinity: "",
    relationshipAffinityLabel: "",
    relationshipSummary: "",
    relationshipSignals: "",
    relationshipTurns: 0,
    loading: false,
    input: "",
    sessionId: "",
    characters: [],
    characterNames: [],
    pickerIndex: 0,
    characterId: "lina",
    characterName: "Lina",
    characterAvatar: "/assets/avatars/lina.svg",
    conversationRelationshipMode: "sweet",
    speaking: false,
    lipPhase: 0,
    newHuman: {
      name: "",
      description: "",
      avatarUrl: "/assets/avatars/lina.svg",
      voice: "nova",
      voiceProvider: "openai",
      defaultMood: "neutral",
      personalityTagline: "",
      relationshipMode: "sweet",
      emotionProfile: "{}",
      avatarType: "image",
      avatarVideoProfile: "{}"
    },
    createMood: "neutral",
    creating: false,
    createError: "",
    isRecording: false,
    isTranscribing: false,
    transcribeError: ""
  },

  _revealTimer: null,
  _lipTimer: null,
  _lipOpen: false,
  _audioContext: null,
  _recorderManager: null,
  _fileSystemManager: null,
  _suppressTapAfterTouch: false,

  onLoad() {
    const cached = wx.getStorageSync(STORAGE_KEY_SESSION);
    const sessionId = cached || `mini-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
    if (!cached) {
      wx.setStorageSync(STORAGE_KEY_SESSION, sessionId);
    }

    const cachedCharacter = wx.getStorageSync(STORAGE_KEY_CHARACTER);
    this.setData({
      sessionId,
      characterId: cachedCharacter || "lina"
    });
    this._recorderManager = wx.getRecorderManager();
    this._fileSystemManager = wx.getFileSystemManager();
    this._bindRecorderEvents();
    this.fetchCharacters(cachedCharacter || "lina");
  },

  onUnload() {
    if (this._revealTimer) {
      clearInterval(this._revealTimer);
      this._revealTimer = null;
    }
    if (this._lipTimer) {
      clearInterval(this._lipTimer);
      this._lipTimer = null;
    }
    if (this._recorderManager) {
      this._recorderManager.stop();
      this._recorderManager = null;
    }
  },

  onHide() {
    if (this._revealTimer) {
      clearInterval(this._revealTimer);
      this._revealTimer = null;
    }
    if (this._lipTimer) {
      clearInterval(this._lipTimer);
      this._lipTimer = null;
    }
    if (this._audioContext) {
      this._audioContext.stop();
      this._audioContext.destroy();
      this._audioContext = null;
    }
    if (this._recorderManager) {
      this._recorderManager.stop();
      this._recorderManager = null;
    }
    this.setData({
      isRecording: false,
      isTranscribing: false
    });
    this._setTranscribeError("");
  },

  _bindRecorderEvents() {
    if (!this._recorderManager) {
      return;
    }

    this._recorderManager.onStop((res) => {
      this.setData({ isRecording: false });

      const tempFilePath = res?.tempFilePath || "";
      if (!tempFilePath) {
        this.setData({ isTranscribing: false });
        return;
      }

      this._transcribeAndSend(tempFilePath);
    });

    this._recorderManager.onError(() => {
      this.setData({
        isRecording: false,
        isTranscribing: false
      });
    });
  },

  resetSession() {
    if (this.data.loading) {
      return;
    }

    if (this._revealTimer) {
      clearInterval(this._revealTimer);
      this._revealTimer = null;
    }
    this.stopLipAnimation();
    if (this._audioContext) {
      this._audioContext.stop();
      this._audioContext.destroy();
      this._audioContext = null;
    }

    const apiBase = getApiBase();
    const newSessionId = `mini-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
    const activeCharacter = getActiveCharacter(this);
    const nextEmotion = activeCharacter?.defaultMood || "neutral";

    wx.request({
      url: `${apiBase}/api/session/${encodeURIComponent(this.data.sessionId)}`,
      method: "DELETE",
      fail: () => {},
      complete: () => {
        wx.setStorageSync(STORAGE_KEY_SESSION, newSessionId);
        this.setData({
          sessionId: newSessionId,
          messages: [{ role: "assistant", content: "你好呀，欢迎回来～" }],
          emotion: nextEmotion,
          speaking: false,
          loading: false,
          input: "",
          relationshipAffinity: "",
          relationshipAffinityLabel: "",
          relationshipSummary: "",
          relationshipSignals: "",
          relationshipTurns: 0,
          conversationRelationshipMode: activeCharacter?.relationshipMode || "sweet"
        });
        this.applyEmotion(nextEmotion, activeCharacter);
      }
    });
  },

  applyEmotion(emotion, character) {
    const targetCharacter = character || getActiveCharacter(this);
    const expressionImage = resolveApiAsset(resolveEmotionImage(targetCharacter, emotion));
    const expressionVideo = resolveApiAsset(resolveEmotionVideo(targetCharacter, emotion));
    const shouldUseVideo = (targetCharacter?.avatarType || "image") === "video";
    this.setData({
      emotion,
      expression: expressionMap[emotion],
      emotionLabel: emotionTextMap[emotion],
      expressionImage: shouldUseVideo ? "" : expressionImage,
      expressionVideo: shouldUseVideo && expressionVideo ? expressionVideo : ""
    });
  },

  fetchCharacters(preferredCharacterId) {
    const apiBase = getApiBase();
    wx.request({
      url: `${apiBase}/api/digital-humans`,
      method: "GET",
      success: (res) => {
        const list = Array.isArray(res.data?.humans) ? res.data.humans : [];
        const pickId = preferredCharacterId || wx.getStorageSync(STORAGE_KEY_CHARACTER) || "lina";
        let pickerIndex = list.findIndex((item) => item.id === pickId);
        if (pickerIndex < 0) {
          pickerIndex = 0;
        }
        const selected = list[pickerIndex];

        this.setData({
          characters: list,
          characterNames: list.map((item) => item.name || item.id),
          pickerIndex,
          characterId: selected?.id || "lina",
          characterName: selected?.name || selected?.id || "Lina",
          characterAvatar: resolveApiAsset(selected?.avatarUrl || "/assets/avatars/lina.svg"),
          conversationRelationshipMode: selected?.relationshipMode || "sweet"
        });

        if (selected?.defaultMood) {
          this.applyEmotion(selected.defaultMood, selected);
        } else {
          this.applyEmotion("neutral", selected);
        }
      },
      fail: () => {
        const fallback = [
          {
            id: "lina",
            name: "Lina",
            description: "默认数字人",
            avatarUrl: "/assets/avatars/lina.svg",
            defaultMood: "happy"
          }
        ];
        this.setData({
          characters: fallback,
          characterNames: fallback.map((item) => item.name || item.id),
          pickerIndex: 0,
          characterId: "lina",
          characterName: "Lina",
          characterAvatar: resolveApiAsset("/assets/avatars/lina.svg"),
          conversationRelationshipMode: "sweet"
        });
        const fallbackChar = fallback[0];
        this.applyEmotion("happy", fallbackChar);
      }
    });
  },

  onCharacterChange(e) {
    const pickerIndex = Number(e.detail.value || 0);
    const selected = this.data.characters[pickerIndex];
    if (!selected) return;

    wx.setStorageSync(STORAGE_KEY_CHARACTER, selected.id);
    this.setData({
      pickerIndex,
      characterId: selected.id,
      characterName: selected.name || selected.id,
      characterAvatar: resolveApiAsset(selected.avatarUrl || "/assets/avatars/lina.svg"),
      conversationRelationshipMode: selected.relationshipMode || "sweet"
    });
    this.applyEmotion(selected.defaultMood || "neutral", selected);
  },

  onDeleteCurrentHuman() {
    const current = getActiveCharacter(this);
    if (!current || typeof current.id !== "string" || !current.id.startsWith("custom-")) {
      return;
    }

    wx.showModal({
      title: "删除数字人",
      content: "确定要删除当前数字人吗？",
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        this.setData({ loading: true });
        const apiBase = getApiBase();
        wx.request({
          url: `${apiBase}/api/digital-humans/${encodeURIComponent(current.id)}`,
          method: "DELETE",
          success: (delRes) => {
            if (delRes.statusCode < 200 || delRes.statusCode >= 300) {
              this._setTranscribeError("删除失败，请重试");
              return;
            }

            const nextCharacters = this.data.characters.filter((item) => item.id !== current.id);
            const nextNames = nextCharacters.map((item) => item.name || item.id);
            const nextCharacter = nextCharacters[0];
            const nextId = nextCharacter?.id || "lina";

            this.setData({
              characters: nextCharacters,
              characterNames: nextNames,
              pickerIndex: 0,
              characterId: nextId,
              characterName: nextCharacter?.name || nextCharacter?.id || "Lina",
              characterAvatar: resolveApiAsset(nextCharacter?.avatarUrl || "/assets/avatars/lina.svg"),
              conversationRelationshipMode: nextCharacter?.relationshipMode || "sweet"
            });
            wx.setStorageSync(STORAGE_KEY_CHARACTER, nextId);
            this.applyEmotion((nextCharacter?.defaultMood || "neutral"), nextCharacter || {
              id: "lina",
              avatarType: "image",
              defaultMood: "neutral",
              avatarUrl: "/assets/avatars/lina.svg"
            });
          },
          complete: () => {
            this.setData({ loading: false });
          }
        });
      }
    });
  },

  onInput(e) {
    const text = e.detail.value;
    const emotion = inferLocalEmotion(text);
    this.setData({
      input: text,
      emotion
    });
    this.applyEmotion(emotion);
  },

  sendTextMessage(text) {
    const userText = String(text || "").trim();
    if (!userText || this.data.loading) return;

    let hasRemoteEmotion = false;
    let remoteEmotion = this.data.emotion || "neutral";

    if (this._revealTimer) {
      clearInterval(this._revealTimer);
      this._revealTimer = null;
    }
    if (this.data.isTranscribing) {
      this.setData({ isTranscribing: false });
    }

    const nextMessages = [...this.data.messages, { role: "user", content: userText }];
    const assistantIndex = nextMessages.length;
    const emotionByInput = inferLocalEmotion(userText);
    const assistantBase = { role: "assistant", content: "" };

    this.setData({
      loading: true,
      input: "",
      emotion: emotionByInput,
      speaking: true,
      relationshipAffinity: "",
      relationshipAffinityLabel: "",
      relationshipSummary: "",
      relationshipSignals: "",
      relationshipTurns: 0,
      messages: [...nextMessages, assistantBase]
    });
    this._lipOpen = false;
    this.startLipAnimation();
    this.applyEmotion(emotionByInput);

    const apiBase = getApiBase();
    wx.request({
      url: `${apiBase}/api/chat/stream`,
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: {
        sessionId: this.data.sessionId,
        characterId: this.data.characterId,
        message: userText,
        relationshipMode: this.data.conversationRelationshipMode || "sweet",
        history: nextMessages
      },
      success: (res) => {
        const parsed = parseEventPayload(res.data);
        if (parsed.hasError) {
            this.setData({
              messages: [...nextMessages, { role: "assistant", content: "我现在有点忙，等我一会儿再聊吧。" }],
              speaking: false,
              loading: false
            });
            this.stopLipAnimation();
            return;
          }

        const fullText = String(parsed.final?.text || parsed.chunks.join("") || "我先听你说的呢，等我想想...");
        const finalEmotion = parsed.final?.emotion || inferLocalEmotion(fullText);
        const events = parsed.events || [];
        const finalAudio = parsed.audioUrl || parsed.final?.audioUrl || "";
        const finalContext = parsed.context || parsed.final?.context || null;
        let cursor = 0;
        let shownText = "";
        const baseMessages = [...nextMessages, assistantBase];
        const revealStep = 4;
        const activeCharacter = getActiveCharacter(this);
        const contextSignals = Array.isArray(finalContext?.userSignals) ? finalContext.userSignals.join("、") : "";
        const contextSummary = typeof finalContext?.summary === "string" ? finalContext.summary : "";
        const contextTurns = typeof finalContext?.turnCount === "number" ? finalContext.turnCount : 0;
        const contextAffinity = typeof finalContext?.relationshipAffinity === "string" ? finalContext.relationshipAffinity : "";
        const contextAffinityLabel =
          contextAffinity ? relationshipLevelLabel[contextAffinity] || contextAffinity : "";
        const renderState = (nextText, emotionText, shouldStop) => {
          if (cursor <= 0 && (!nextText && parsed.chunks.length === 0)) {
            nextText = "我先听你说的呢，等我想想...";
          }

          const rolling = [...baseMessages];
          rolling[assistantIndex] = { role: "assistant", content: nextText };
          let inferred;
          if (emotionText) {
            inferred = emotionText;
            hasRemoteEmotion = true;
          } else if (!hasRemoteEmotion) {
            inferred = inferLocalEmotion(nextText);
          } else {
            inferred = remoteEmotion;
          }
          remoteEmotion = inferred;
          this.applyEmotion(inferred, activeCharacter);
          this.setData({
            messages: rolling,
            emotion: inferred
          });

          if (shouldStop) {
            clearInterval(this._revealTimer);
            this._revealTimer = null;
          }
        };

        const finalize = () => {
          clearInterval(this._revealTimer);
          this._revealTimer = null;
          this.applyEmotion(finalEmotion, activeCharacter);
          this.setData({
            messages: [...baseMessages.slice(0, assistantIndex), { role: "assistant", content: fullText }],
            speaking: false,
            loading: false,
            relationshipAffinityLabel: contextAffinityLabel,
            relationshipAffinity: contextAffinity,
            relationshipSummary: contextSummary,
            relationshipSignals: contextSignals,
            relationshipTurns: contextTurns,
            conversationRelationshipMode: finalContext?.activeRelationshipMode || this.data.conversationRelationshipMode || "sweet"
          });
          this.stopLipAnimation();

          if (finalAudio) {
            if (this._audioContext) {
              this._audioContext.stop();
              this._audioContext.destroy();
              this._audioContext = null;
            }
            this._audioContext = wx.createInnerAudioContext();
            this._audioContext.src = resolveApiAsset(finalAudio);
            this._audioContext.play();
          }
        };

        if (events.length === 0) {
          hasRemoteEmotion = false;
          renderState(fullText, finalEmotion, true);
          finalize();
          return;
        }

        this._revealTimer = setInterval(() => {
          if (this.data.loading === false) {
            return;
          }
          if (!this._revealTimer) return;

          const evt = events[cursor];
          if (!evt) {
            if (shownText.length >= fullText.length) {
              finalize();
            } else {
              shownText = fullText.slice(0, shownText.length + revealStep);
              renderState(shownText);
            }
            return;
          }

          cursor += 1;

          if (evt.event === "chunk" && typeof evt.data?.text === "string") {
            shownText += evt.data.text;
          } else if (evt.event === "done" && typeof evt.data?.text === "string") {
            shownText = evt.data.text;
          }

          let nextEmotion = null;
          if (evt.event === "emotion" && typeof evt.data?.emotion === "string") {
            nextEmotion = evt.data.emotion;
            hasRemoteEmotion = true;
          } else if (evt.event === "done" && typeof evt.data?.emotion === "string") {
            nextEmotion = evt.data.emotion;
            hasRemoteEmotion = true;
          }

          renderState(shownText, nextEmotion);

          if (evt.event === "done" || shownText.length >= fullText.length) {
            finalize();
            this.stopLipAnimation();
          }
        }, 30);
      },
      fail: () => {
        if (this._revealTimer) {
          clearInterval(this._revealTimer);
          this._revealTimer = null;
        }
        this.setData({
          messages: [...nextMessages, { role: "assistant", content: "网络异常，先等等哦。" }],
          speaking: false,
          loading: false
        });
        this.stopLipAnimation();
      }
    });
  },

  onSend() {
    this.sendTextMessage(this.data.input);
  },

  _transcribeAndSend(tempFilePath) {
    if (!tempFilePath) {
      return;
    }

    if (!this._fileSystemManager) {
      this._fileSystemManager = wx.getFileSystemManager();
    }

    this.setData({ isTranscribing: true });
    this._setTranscribeError("");
    this._fileSystemManager.readFile({
      filePath: tempFilePath,
      encoding: "base64",
      success: (res) => {
        const payload = String(res.data || "").trim();
        if (!payload) {
          this.setData({ isTranscribing: false });
          return;
        }

        const apiBase = getApiBase();
        wx.request({
          url: `${apiBase}/api/transcribe`,
          method: "POST",
          header: { "Content-Type": "application/json" },
          data: {
            audioBase64: payload,
            mimeType: "audio/mp3"
          },
          success: (res) => {
            const transcript = String(res.data?.text || "").trim();
            if (transcript) {
              this.sendTextMessage(transcript);
              this._setTranscribeError("");
            } else {
              this.setData({
                input: "",
                isTranscribing: false
              });
              this._setTranscribeError("语音转写失败，请重试");
            }
          },
          fail: (_err) => {
            this.setData({
              isTranscribing: false
            });
            this._setTranscribeError("语音识别请求失败");
          }
        });
      },
      fail: () => {
        this.setData({
          isTranscribing: false
        });
        this._setTranscribeError("读取录音文件失败");
      }
    });
  },

  onToggleVoiceInput() {
    if (this._suppressTapAfterTouch) {
      this._suppressTapAfterTouch = false;
      return;
    }

    if (!this._recorderManager) {
      return;
    }
    if (this.data.loading || this.data.isTranscribing) {
      return;
    }

    if (this.data.isRecording) {
      this._recorderManager.stop();
      this.setData({ isRecording: false });
      return;
    }

    this.setData({ isRecording: true, isTranscribing: true });
    this._recorderManager.start({
      format: "mp3",
      duration: 120000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000
    });
  },

  onStartVoiceInput() {
    if (!this._recorderManager) {
      return;
    }
    this._suppressTapAfterTouch = true;
    if (this.data.loading || this.data.isTranscribing) {
      this._suppressTapAfterTouch = false;
      return;
    }
    if (this.data.isRecording) {
      return;
    }
    if (!this._recorderManager) {
      this._setTranscribeError("未检测到录音能力");
      return;
    }

    this._setTranscribeError("");
    this.setData({ isRecording: true, isTranscribing: true });
    this._recorderManager.start({
      format: "mp3",
      duration: 120000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000
    });
  },

  onEndVoiceInput() {
    if (!this.data.isRecording || !this._recorderManager) {
      this._suppressTapAfterTouch = false;
      this.setData({ isRecording: false, isTranscribing: false });
      return;
    }
    this._recorderManager.stop();
    this.setData({ isRecording: false });
  },

  _setTranscribeError(message) {
    const text = String(message || "").trim();
    this.setData({ transcribeError: text });
  },

  startLipAnimation() {
    if (this._lipTimer) {
      clearInterval(this._lipTimer);
    }
    this.setData({ lipPhase: 0 });
    this._lipOpen = false;
    this._lipTimer = setInterval(() => {
      this._lipOpen = !this._lipOpen;
      this.setData({
        lipPhase: this._lipOpen ? 1 : 0
      });
    }, 170);
  },

  stopLipAnimation() {
    if (this._lipTimer) {
      clearInterval(this._lipTimer);
      this._lipTimer = null;
    }
    this._lipOpen = false;
    this.setData({ lipPhase: 0 });
  },

      onCreateInput(e) {
        const key = e.currentTarget.dataset.field;
        const value = e.detail.value;
        if (!key) return;

    this.setData({
      newHuman: { ...this.data.newHuman, [key]: value }
    });
  },

  onCreateModeChange(e) {
    this.setData({
      createMood: e.detail.value,
      newHuman: { ...this.data.newHuman, defaultMood: e.detail.value }
    });
  },

  onCreateRelationshipModeChange(e) {
    this.setData({
      newHuman: { ...this.data.newHuman, relationshipMode: relationshipModes[e.detail.value] || "sweet" }
    });
  },

  onConversationRelationshipModeChange(e) {
    const selected = relationshipModes[e.detail.value] || "sweet";
    this.setData({ conversationRelationshipMode: selected });
  },

  onCreateVoiceProviderChange(e) {
    const voiceProvider = e.detail.value;
    this.setData({
      newHuman: { ...this.data.newHuman, voiceProvider }
    });
  },

  onAvatarTypeChange(e) {
    const avatarType = e.detail.value === "video" ? "video" : "image";
    this.setData({
      newHuman: { ...this.data.newHuman, avatarType }
    });
  },

  onCreateHuman() {
    const payload = this.data.newHuman;
    if (!payload.name || !payload.description || !payload.avatarUrl || !payload.voice) {
      this.setData({ createError: "请完整填写数字人信息" });
      return;
    }

    let emotionProfile;
    try {
      const parsed = JSON.parse(String(payload.emotionProfile || "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        emotionProfile = normalizeEmotionProfile(parsed);
      }
    } catch {
      emotionProfile = undefined;
    }
    let avatarVideoProfile;
    try {
      const parsed = JSON.parse(String(payload.avatarVideoProfile || "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        avatarVideoProfile = normalizeEmotionProfile(parsed);
      }
    } catch {
      avatarVideoProfile = undefined;
    }

    this.setData({ creating: true, createError: "" });
    const apiBase = getApiBase();
    wx.request({
      url: `${apiBase}/api/digital-humans`,
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: {
        ...payload,
        avatarType: payload.avatarType,
        personalityTagline: String(payload.personalityTagline || "").trim(),
        relationshipMode: payload.relationshipMode || "sweet",
        emotionProfile,
        avatarVideoProfile
      },
      success: (res) => {
        const created = res.data?.human;
        if (!created) {
          this.setData({ createError: "创建失败，请重试", creating: false });
          return;
        }

        const nextCharacters = [...this.data.characters, created];
        const nextNames = nextCharacters.map((item) => item.name || item.id);
        const pickerIndex = nextCharacters.length - 1;
        wx.setStorageSync(STORAGE_KEY_CHARACTER, created.id);

          this.setData({
            characters: nextCharacters,
            characterNames: nextNames,
            pickerIndex,
            characterId: created.id,
          characterName: created.name || created.id,
          characterAvatar: resolveApiAsset(created.avatarUrl || "/assets/avatars/lina.svg"),
          conversationRelationshipMode: created.relationshipMode || "sweet",
          creating: false,
            newHuman: {
              name: "",
              description: "",
              avatarUrl: "/assets/avatars/lina.svg",
              voiceProvider: "openai",
              voice: "nova",
              defaultMood: "neutral",
              personalityTagline: "",
            relationshipMode: "sweet",
            emotionProfile: "{}",
            avatarType: "image",
            avatarVideoProfile: "{}"
          },
          createMood: "neutral",
          createError: ""
        });
        this.applyEmotion(created.defaultMood || "neutral", created);
      },
      fail: () => {
        this.setData({ createError: "创建失败，请检查网络", creating: false });
      }
    });
  }
});
