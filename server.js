// =============================
// A P T I Q  –  BACKEND (FULL)
// Custom Auth + Chat + Files + Admin
// =============================

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";
import crypto from "crypto";
import path from "path";

dotenv.config();

console.log("🔧 DEBUG: Render ENV check");
console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY =", process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("SUPABASE_SERVICE_ROLE =", process.env.SUPABASE_SERVICE_ROLE);
console.log("All env keys:", Object.keys(process.env));

const app = express();
const PORT = process.env.PORT || 3000;

// ========= MIDDLEWARE =========
app.use(cors());
app.use(express.json());

// ========= SUPABASE CLIENT =========
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "user-files";

// ========= MULTER (UPLOAD TMP) =========
const upload = multer({ dest: "uploads/" });

// ========= HELFER =========

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role || "user",
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "Fehlender Authorization Header" });
  }

  const token = header.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Fehlender Token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Ungültiger Token" });
  }
}

async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Nicht eingeloggt" });

  // zur Sicherheit vom DB-Status abhängig machen
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.id)
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Profil konnte nicht geladen werden" });
  }

  if (profile?.role !== "admin") {
    return res.status(403).json({ error: "Admin-Rechte erforderlich" });
  }

  next();
}

// ========= HEALTH =========

app.get("/", (req, res) => {
  res.json({ ok: true, service: "AptiQ Backend", time: new Date().toISOString() });
});

// =============================
// AUTH
// =============================

// =======================================
// REGISTER
// =======================================
app.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email und Passwort sind erforderlich."
      });
    }

    // Prüfen, ob User bereits existiert
    const existing = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();

    if (existing.data) {
      return res.status(400).json({
        success: false,
        message: "Diese Email existiert bereits."
      });
    }

    // Passwort hashen
    const hashedPassword = await bcrypt.hash(password, 10);

    // Benutzer speichern
    const { data, error } = await supabase
      .from("profiles")
      .insert([
        {
          email: email,
          password: hashedPassword,
          name: name || "AptiQ User"
        }
      ])
      .select()
      .single();

    if (error) {
  console.error("REGISTER ERROR FROM SUPABASE:", error);
  return res.status(500).json({
    success: false,
    message: error.message || "Fehler beim Erstellen des Benutzers.",
    details: error.details || null
  });
}

    return res.json({
      success: true,
      user: {
        id: data.id,
        email: data.email,
        name: data.name,
      }
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Interner Fehler."
    });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Bitte E-Mail und Passwort angeben." });
  }

  try {
    const { data: user, error } = await supabase
      .from("profiles")
      .select("id, email, username, role, password_hash")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "Ungültige Login-Daten." });
    }

    const match = await bcrypt.compare(password, user.password_hash || "");
    if (!match) {
      return res.status(401).json({ error: "Ungültige Login-Daten." });
    }

    const token = createToken(user);

    res.json({
      message: "Login erfolgreich.",
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Serverfehler beim Login." });
  }
});

// Aktuellen User holen
app.get("/me", auth, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("profiles")
      .select("id, email, username, role, plan")
      .eq("id", req.user.id)
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Profil konnte nicht geladen werden." });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Serverfehler." });
  }
});

// =============================
// CHAT
// =============================

// Alle Nachrichten des Users
app.get("/messages", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Nachrichten konnten nicht geladen werden." });
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET /messages:", err);
    res.status(500).json({ error: "Serverfehler." });
  }
});

// Neue Nachricht + AI-Antwort
app.post("/message", auth, async (req, res) => {
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Inhalt darf nicht leer sein." });
  }

  try {
    // User-Nachricht speichern
    const { error: userMsgErr } = await supabase.from("messages").insert([
      {
        user_id: req.user.id,
        content,
        sender: "user",
      },
    ]);

    if (userMsgErr) {
      console.error(userMsgErr);
      return res.status(500).json({ error: "Nachricht konnte nicht gespeichert werden." });
    }

    // HIER später: richtiger AI-Call (OpenAI / eigenes LLM)
    // ========= KI-Antwort erzeugen =========

// Optional: RAG vorbereiten (Platzhalter – wir bauen es später ein)
// const context = await buildRAGContext(req.user.id, content);

let aiText = "";

try {
  // ================ OpenAI ================
  if (process.env.OPENAI_API_KEY) {
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Du bist AptiQ – die KI von NoCxAI. Antworte klar, hilfsbereit und modern." },
          { role: "user", content: content }
        ]
      })
    });

    const json = await completion.json();
    aiText = json?.choices?.[0]?.message?.content || "Fehler: Keine Antwort erhalten.";
  }

  // ================ Groq ================
  else if (process.env.GROQ_API_KEY) {
    const completion = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [
          { role: "system", content: "Du bist AptiQ – die moderne KI von NoCxAI." },
          { role: "user", content: content }
        ]
      })
    });

    const json = await completion.json();
    aiText = json?.choices?.[0]?.message?.content || "Fehler: Keine Antwort erhalten.";
  }

  // ================ HuggingFace ================
  else if (process.env.HF_API_KEY && process.env.HF_MODEL) {
    const hfRes = await fetch(`https://api-inference.huggingface.co/models/${process.env.HF_MODEL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.HF_API_KEY}`,
      },
      body: JSON.stringify({ inputs: content })
    });

    const json = await hfRes.json();
    aiText = json?.[0]?.generated_text || "Fehler: Keine Antwort erhalten.";
  }

  else {
    aiText = "⚠️ Kein KI-Anbieter konfiguriert. Bitte OPENAI_API_KEY, GROQ_API_KEY oder HF_API_KEY setzen.";
  }
} catch (e) {
  console.error("AI ERROR:", e);
  aiText = "⚠️ Fehler bei der KI-Anfrage.";
}


    const { error: aiMsgErr } = await supabase.from("messages").insert([
      {
        user_id: req.user.id,
        content: aiText,
        sender: "assistant",
      },
    ]);

    if (aiMsgErr) {
      console.error(aiMsgErr);
      return res.status(500).json({ error: "AI-Antwort konnte nicht gespeichert werden." });
    }

    res.json({ reply: aiText });
  } catch (err) {
    console.error("POST /message:", err);
    res.status(500).json({ error: "Serverfehler." });
  }
});

// =============================
// FILE UPLOAD
// =============================

app.post("/upload", auth, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Keine Datei hochgeladen." });

  try {
    const fileBuffer = fs.readFileSync(file.path);
    const ext = path.extname(file.originalname);
    const safeName = `${req.user.id}/${Date.now()}_${Math.round(
      Math.random() * 1e6
    )}${ext}`;

    const { data: uploadResult, error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(safeName, fileBuffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    fs.unlinkSync(file.path); // tmp löschen

    if (uploadErr) {
      console.error(uploadErr);
      return res.status(500).json({ error: "Upload zu Supabase Storage fehlgeschlagen." });
    }

    const { error: insertErr } = await supabase.from("files").insert([
      {
        user_id: req.user.id,
        name: file.originalname,
        path: uploadResult.path,
        size: file.size,
        mime_type: file.mimetype,
      },
    ]);

    if (insertErr) {
      console.error(insertErr);
      return res.status(500).json({ error: "Datei-Metadaten konnten nicht gespeichert werden." });
    }

    res.json({ success: true, path: uploadResult.path });
  } catch (err) {
    console.error("POST /upload:", err);
    res.status(500).json({ error: "Serverfehler beim Upload." });
  }
});

// Dateien des Users auflisten
app.get("/files", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Dateien konnten nicht geladen werden." });
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET /files:", err);
    res.status(500).json({ error: "Serverfehler." });
  }
});

// =============================
// ADMIN ROUTES
// =============================

app.get("/admin/users", auth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, username, role, plan, created_at");

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Benutzer konnten nicht geladen werden." });
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET /admin/users:", err);
    res.status(500).json({ error: "Serverfehler." });
  }
});

app.get("/admin/messages", auth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Nachrichten konnten nicht geladen werden." });
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET /admin/messages:", err);
    res.status(500).json({ error: "Serverfehler." });
  }
});

app.get("/admin/files", auth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("files")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Dateien konnten nicht geladen werden." });
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET /admin/files:", err);
    res.status(500).json({ error: "Serverfehler." });
  }
});

// =============================
// START SERVER
// =============================

app.listen(PORT, () => {
  console.log(`AptiQ Backend läuft auf Port ${PORT}`);
});
