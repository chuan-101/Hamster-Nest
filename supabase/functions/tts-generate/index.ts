import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { consumeQuota, quotaExceededResponse } from "../_shared/quota.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const USER_ID = "94dd24be-e136-45bb-836b-6820c09c4292";
const DAILY_QUOTA = 200;

// Syzygy-1 voice defaults
const DEFAULTS = {
  model_id: "eleven_multilingual_v2",
  speed: 0.85,
  voice_settings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.20,
    use_speaker_boost: true,
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!(await verifyAuth(req))) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const quota = await consumeQuota("tts-generate", USER_ID, DAILY_QUOTA);
  if (!quota.allowed) {
    return quotaExceededResponse("tts-generate", corsHeaders);
  }

  try {
    const { text, speed, voice_settings } = await req.json();

    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid 'text' parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (text.length > 2000) {
      return new Response(
        JSON.stringify({ error: "Text exceeds 2000 character limit" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    const voiceId = Deno.env.get("ELEVENLABS_VOICE_ID");

    if (!apiKey || !voiceId) {
      return new Response(
        JSON.stringify({ error: "ElevenLabs credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: DEFAULTS.model_id,
          voice_settings: voice_settings
            ? { ...DEFAULTS.voice_settings, ...voice_settings }
            : DEFAULTS.voice_settings,
          speed: speed ?? DEFAULTS.speed,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({
          error: `ElevenLabs API error (${response.status})`,
          details: errorText,
        }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Content-Disposition": "inline; filename=\"syzygy-voice.mp3\"",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
