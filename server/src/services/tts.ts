import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DigitalHumanConfig } from "../types";

function getOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL
  });
}

async function writeAudioBuffer(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const workspaceRoot = path.basename(process.cwd()) === "server" ? path.resolve(process.cwd(), "..") : process.cwd();
  const audioDir = path.join(workspaceRoot, "server", "data", "audio");
  await fs.mkdir(audioDir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`;
  const outputPath = path.join(audioDir, filename);
  const data = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer);
  await fs.writeFile(outputPath, data);
  return `/audio/${filename}`;
}

async function synthesizeWithOpenAI(text: string, character: DigitalHumanConfig): Promise<string | undefined> {
  const client = getOpenAiClient();
  if (!client) {
    return undefined;
  }

  const mp3 = await client.audio.speech.create({
    model: "tts-1",
    voice: character.voiceProfile.voice,
    input: text
  });

  return await writeAudioBuffer(await mp3.arrayBuffer());
}

async function synthesizeWithAzure(text: string, character: DigitalHumanConfig): Promise<string | undefined> {
  const apiKey = process.env.AZURE_TTS_KEY;
  const endpoint = process.env.AZURE_TTS_ENDPOINT;

  if (!apiKey || !endpoint) {
    return undefined;
  }

  const response = await fetch(`${endpoint}/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
      "User-Agent": "digital-girlfriend-platform"
    },
    body: `<speak version='1.0' xml:lang='zh-CN'><voice xml:lang='zh-CN' xml:gender='Female' name='${character.voiceProfile.voice || "zh-CN-XiaoxiaoNeural"}'>${text}</voice></speak>`
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "azure tts failed");
    throw new Error(`Azure TTS failed: ${message}`);
  }

  const buffer = await response.arrayBuffer();
  return await writeAudioBuffer(buffer);
}

export async function synthesizeSpeech(
  text: string,
  character: DigitalHumanConfig
): Promise<string | undefined> {
  const provider = character.voiceProfile.provider || "openai";
  if (provider === "azure") {
    try {
      return await synthesizeWithAzure(text, character);
    } catch (error) {
      console.warn("Azure TTS 调用失败，回退到 OpenAI");
      return await synthesizeWithOpenAI(text, character);
    }
  }

  if (provider === "local") {
    return undefined;
  }

  return synthesizeWithOpenAI(text, character);
}
