// ===============================
// AptiQ Backend – Multi-Provider
// + Datei-Upload (PDF/TXT) mit KI-Analyse
// ===============================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import * as pdfParse from "pdf-parse";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const app = express();

// Body Parser & CORS
app.use(express.json());
app.use(cors({
  origin: ["https://nocxai.com", "http://localhost:5500"]
}));

// File Upload (temporary dir)
const upload = multer({ dest: "/tmp/aptiq_uploads" });

// OPTIONAL: OpenAI client
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// =============================================
// Utils
// =============================================
function extractMessage(req) {
  return req.body?.message || null;
}

function resolveMode(req) {
  return req.body?.mode || "web";
}

// =============================================
// Provider-Calls
// =============================================

// LLaMA 3.1 via Groq
async function callGroq(message, systemPrompt = "Du bist AptiQ, ein technischer Assistent.") {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY fehlt.");
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ]
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Groq-Fehler: ${JSON.stringify(data)}`);
  }

  return data.choices?.[0]?.message?.content?.trim() ?? "Keine Antwort.";
}

// OpenAI
async function callOpenAI(message, systemPrompt = "Du bist AptiQ, ein technischer Assistent.") {
  if (!openaiClient) {
    throw new Error("OPENAI_API_KEY fehlt.");
  }

  const completion = await openaiClient.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ]
  });

  return completion.choices[0].message.content.trim();
}

// HuggingFace
async function callHF(message, systemPrompt = "Du bist AptiQ, ein technischer Assistent.") {
  if (!process.env.HF_API_KEY) {
    throw new Error("HF_API_KEY fehlt.");
  }

  const model = process.env.HF_MODEL_ID || "HuggingFaceH4/zephyr-7b-beta";

  const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.HF_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputs: `${systemPrompt}\n\nNutzer: ${message}`
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`HF-Fehler: ${JSON.stringify(data)}`);
  }

  return data[0]?.generated_text || JSON.stringify(data);
}

// Provider dispatch
async function callProvider(model, message, systemPrompt) {
  if (model === "openai") return callOpenAI(message, systemPrompt);
  if (model === "hf") return callHF(message, systemPrompt);
  // Default: LLaMA / Groq
  return callGroq(message, systemPrompt);
}

// =============================================
// Healthcheck
// =============================================
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

// =============================================
// Chat Endpoint
// =============================================
app.post("/api/chat", async (req, res) => {
  try {
    const message = extractMessage(req);
    const model = req.body?.model || "llama";
    const mode = resolveMode(req);

    if (!message) {
      return res.status(400).json({ error: "message fehlt" });
    }

    const reply = await callProvider(
      model,
      message,
      `Du bist AptiQ, ein klarer, technischer Assistent von NoCxAI. Modus: ${mode}.`
    );

    res.json({ reply, model, mode });
  } catch (err) {
    console.error("AptiQ Fehler /api/chat:", err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// Datei-Upload & Analyse Endpoint
// =============================================

async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName || "").toLowerCase();

  if (ext === ".pdf") {
    const data = await fs.readFile(filePath);
    const pdfData = await pdfParse.default(data);
    return pdfData.text || "";
  }

  if (ext === ".txt") {
    const data = await fs.readFile(filePath, "utf-8");
    return data;
  }

  // Weitere Formate (docx, etc.) könnten später folgen
  throw new Error("Nur PDF und TXT werden aktuell unterstützt.");
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  const model = req.body?.model || "llama";

  if (!file) {
    return res.status(400).json({ error: "Keine Datei hochgeladen." });
  }

  try {
    const text = await extractTextFromFile(file.path, file.originalname);

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Die Datei enthält keinen lesbaren Text." });
    }

    const truncated = text.slice(0, 8000); // Limit für Prompt

    const summaryPrompt = `
Lies den folgenden Dokumentinhalt und gib eine strukturierte Zusammenfassung.
Markiere wichtige Punkte mit Bullet Points und hebe Fachbegriffe hervor.

Dokument:
${truncated}
    `.trim();

    const summary = await callProvider(
      model,
      summaryPrompt,
      "Du bist AptiQ, ein KI-Assistent, der Dokumente klar und verständlich zusammenfasst."
    );

    res.json({
      fileName: file.originalname,
      model,
      summary
    });
  } catch (err) {
    console.error("Upload/Analyse Fehler:", err);
    res.status(500).json({ error: err.message });
  } finally {
    // Temporäre Datei entfernen
    try {
      await fs.unlink(file.path);
    } catch {
      // ignorieren
    }
  }
});

// =============================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log("AptiQ Backend läuft auf Port", PORT)
);
