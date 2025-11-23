// ================================================
// APTIQ – SERVER (FINAL VERSION, PRODUCTION READY)
// Mit Hybrid-KI, RAG pro User, Upload-Fix, JWT-Auth
// ================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import fs from "fs";
import path from "path";
import * as pdf from "pdf-parse";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";

import { authMiddleware } from "./authMiddleware.js";

// ======================
// INIT
// ======================
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "client")));

// ======================
// OPENAI
// ======================
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ======================
// RAG / Storage
// ======================
const uploadDir = path.join(__dirname, "uploads");
const knowledgeDir = path.join(__dirname, "knowledge");

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(knowledgeDir, { recursive: true });

const upload = multer({ dest: uploadDir });

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_123";

const usersFile = path.join(__dirname, "users.json");
let chatOwner = {}; // map: chatId => userId

// ======================
// USER FUNCTIONS
// ======================
function loadUsers() {
  if (!fs.existsSync(usersFile)) return [];
  return JSON.parse(fs.readFileSync(usersFile, "utf8"));
}

function saveUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

// ======================
// MINI EMBEDDING ENGINE
// ======================

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function vectorize(text) {
  const dim = 64;
  const vec = new Array(dim).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").split(/\s+/);

  for (const w of words) {
    if (!w) continue;
    const idx = hashString(w) % dim;
    vec[idx] += 1;
  }

  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map(v => v / norm);
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++)
    s += a[i] * b[i];
  return s;
}

function chunkText(text, size = 600, overlap = 100) {
  const chunks = [];
  let i = 0;

  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    const part = text.slice(i, end).trim();
    if (part) chunks.push(part);
    i += size - overlap;
  }
  return chunks;
}

function getRelevantChunks(query, chatId, userId, topK = 4) {
  const fileName = `${userId}-${chatId}.json`;
  const filePath = path.join(knowledgeDir, fileName);

  if (!fs.existsSync(filePath)) return [];

  const knowledge = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let allChunks = [];

  for (const file of knowledge) {
    for (const c of file.chunks) {
      allChunks.push(c);
    }
  }

  if (allChunks.length === 0) return [];

  const qVec = vectorize(query);
  const scored = allChunks.map(c => ({
    chunk: c,
    score: cosine(qVec, c.vector)
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map(s => s.chunk);
}

// ======================
// REGISTER
// ======================
app.post("/api/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const users = loadUsers();

    if (users.find(u => u.email === email))
      return res.status(400).json({ error: "E-Mail bereits registriert" });


    const newUser = {
      id: "user-" + Date.now().toString(36),
      email,
      name: name || "Nutzer",
      passwordHash: hash
    };

    users.push(newUser);
    saveUsers(users);

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token });

  } catch (err) {
    res.status(500).json({ error: "Registrierung fehlgeschlagen" });
  }
});

// ======================
// LOGIN
// ======================
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = loadUsers();

    const user = users.find(u => u.email === email);
    if (!user) return res.status(400).json({ error: "Login falsch" });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token });

  } catch (err) {
    res.status(500).json({ error: "Login fehlgeschlagen" });
  }
});

// ======================
// ME
// ======================
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ======================
// UPLOAD (RAG pro User)
// ======================
app.post("/api/upload", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const { chatId } = req.body;
    const userId = req.user.id;

    if (!chatId) return res.status(400).json({ error: "chatId fehlt" });
    if (!req.file) return res.status(400).json({ error: "Keine Datei erhalten" });

    const filePath = req.file.path;
    const fileName = req.file.originalname.toLowerCase();

    let text = "";

    if (fileName.endsWith(".pdf")) {
      text = (await pdf(fs.readFileSync(filePath))).text;
    } else if (fileName.endsWith(".txt")) {
      text = fs.readFileSync(filePath, "utf8");
    } else {
      return res.status(400).json({ error: "Dateiformat nicht unterstützt" });
    }

    const chunks = chunkText(text);
    const vectors = chunks.map(c => ({
      text: c,
      vector: vectorize(c),
      file: fileName
    }));

    const knowledgeFile = path.join(knowledgeDir, `${userId}-${chatId}.json`);
    let knowledge = [];

    if (fs.existsSync(knowledgeFile))
      knowledge = JSON.parse(fs.readFileSync(knowledgeFile, "utf8"));

    knowledge.push({ fileName, chunks: vectors });

    fs.writeFileSync(knowledgeFile, JSON.stringify(knowledge, null, 2));

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: "Upload fehlgeschlagen" });
  }
});

// ======================
// CHAT
// ======================
app.post("/api/chat", authMiddleware, async (req, res) => {
  try {
    const { message, mode, chatId, model } = req.body;
    const userId = req.user.id;

    if (!message || !chatId)
      return res.status(400).json({ error: "message oder chatId fehlt" });

    // Ownership
    if (chatOwner[chatId] && chatOwner[chatId] !== userId)
      return res.status(403).json({ error: "Kein Zugriff" });

    chatOwner[chatId] = userId;

    let context = "";
    let finalPrompt = message;

    if (mode === "web" || mode === "hybrid") {
      const web = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Fasse Web-Ergebnisse zusammen." },
          { role: "user", content: message }
        ]
      });
      context = web.choices[0].message.content;
    }

    const rag = getRelevantChunks(message, chatId, userId);
    const ragText = rag.map((c, i) => `[Datei-Wissen #${i + 1}]\n${c.text}`).join("\n\n");

    finalPrompt = 
      `Du bist AptiQ.\n\n` +
      `FRAGE:\n${message}\n\n` +
      `DATEI-WISSEN:\n${ragText}\n\n` +
      `WEB-KONTEXT:\n${context}\n\n` +
      `Bitte präzise antworten.`;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "llama3.1:8b",
        prompt: finalPrompt
      })
    });

    let fullReply = "";
    const reader = response.body.getReader();
    let partial = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += new TextDecoder().decode(value);
      const lines = partial.split("\n");
      partial = lines.pop();

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.response) fullReply += json.response;
        } catch {}
      }
    }

    res.json({ reply: fullReply.trim() });

  } catch (err) {
    res.status(500).json({ error: "Fehler beim Chatten" });
  }
});

// ======================
// START SERVER
// ======================
function startServer(port = 3000) {
  app.listen(port, () => {
    console.log(`AptiQ läuft unter http://localhost:${port}`);
    fs.writeFileSync(path.join(__dirname, "current_port.txt"), String(port));
  }).on("error", err => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${port} belegt – versuche ${port + 1}`);
      startServer(port + 1);
    } else {
      console.error("Serverfehler:", err);
    }
  });
}

startServer();
