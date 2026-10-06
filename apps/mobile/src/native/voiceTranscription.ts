import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

export async function getLocalVoiceTranscriber(
  _language?: string,
): Promise<VoiceTranscriber | null> {
  return null;
}
