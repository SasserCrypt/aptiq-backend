// ===============================
// AptiQ Backend – Multi-Provider
// LLaMA (Groq) / OpenAI / HuggingFace
// ===============================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

// Body Parser & CORS
app.use(express.json());
app.use(cors({
  origin: ["https://nocxai.com", "http://localhost:5500"]
}));

// OPTIONAL: OpenAI client
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ------- UTIL -------
function extractMessage(req) {
  return req.body?.message || null;
}

// ------- PROVIDERS -------

// ★ LLaMA 3.1 über Groq (kostenlos)
async function callGroq(message) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY fehlt.");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "Du bist AptiQ, ein technischer Assistent." },
        { role: "user", content: message }
      ]
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "Keine Antwort.";
}

// ★ OpenAI
async function callOpenAI(message) {
  if (!openaiClient) {
    throw new Error("OPENAI_API_KEY fehlt.");
  }

  const completion = await openaiClient.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Du bist AptiQ, ein technischer Assistent." },
      { role: "user", content: message }
    ]
  });

  return completion.choices[0].message.content.trim();
}

// ★ HuggingFace
async function callHF(message) {
  if (!process.env.HF_API_KEY) {
    throw new Error("HF_API_KEY fehlt.");
  }

  const model = process.env.HF_MODEL_ID || "HuggingFaceH4/zephyr-7b-beta";

  const response = await fetch(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HF_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: message })
    }
  );

  const data = await response.json();
  return data[0]?.generated_text || JSON.stringify(data);
}

// ----------------------
// HEALTHCHECK
// ----------------------
app.get("/", (req, res) => {
  res.json({
    status: "AptiQ Backend läuft 🔥",
    providers: {
      llama_groq: !!process.env.GROQ_API_KEY,
      huggingface: !!process.env.HF_API_KEY,
      openai: !!process.env.OPENAI_API_KEY
    }
  });
});

// ----------------------
// CHAT ENDPOINT
// ----------------------
app.post("/api/chat", async (req, res) => {
  try {
    const message = extractMessage(req);
    const model = req.body?.model || "llama"; // Default: Groq / LLaMA

    if (!message) {
      return res.status(400).json({ error: "message fehlt" });
    }

    let reply = "";

    if (model === "openai") {
      reply = await callOpenAI(message);
    } else if (model === "hf") {
      reply = await callHF(message);
    } else {
      reply = await callGroq(message);
    }

    res.json({ reply, model });

  } catch (err) {
    console.error("AptiQ Fehler:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log("AptiQ Backend läuft auf Port", PORT)
);
