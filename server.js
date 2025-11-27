// ==============================
// AptiQ Backend – Final Version
// ==============================

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

// Init
dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// ==============================
// Supabase Client
// ==============================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Test-Log Render ENV
console.log("AptiQ Backend gestartet.");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "OK" : "MISSING");
console.log(
  "SERVICE_ROLE_KEY:",
  process.env.SUPABASE_SERVICE_ROLE_KEY ? "OK" : "MISSING"
);

// ==============================
// Helper – JWT erstellen
// ==============================

function createToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email
    },
    process.env.JWT_SECRET || "default-secret",
    { expiresIn: "2h" }
  );
}

// ==============================
// REGISTER
// ==============================

app.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "E-Mail und Passwort sind erforderlich." });
    }

    // Passwort hashen
    const hashedPassword = await bcrypt.hash(password, 10);

    // Datensatz in Supabase schreiben
    const { data, error } = await supabase
      .from("profiles")
      .insert([
        {
          email,
          password: hashedPassword,
          name: name || null
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("REGISTER ERROR:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Fehler beim Erstellen des Benutzers."
      });
    }

    return res.json({ success: true, user: data });
  } catch (err) {
    console.error("REGISTER CRASH:", err);
    return res
      .status(500)
      .json({ success: false, message: "Interner Fehler beim Registrieren." });
  }
});

// ==============================
// LOGIN
// ==============================

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validieren
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "E-Mail und Passwort sind erforderlich." });
    }

    // User holen
    const { data: user, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      console.log("LOGIN FAILED: User existiert nicht");
      return res.status(400).json({ error: "Ungültige Login-Daten." });
    }

    // Passwort prüfen
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      console.log("LOGIN FAILED: Passwort falsch");
      return res.status(400).json({ error: "Ungültige Login-Daten." });
    }

    const token = createToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (err) {
    console.error("LOGIN CRASH:", err);
    return res.status(500).json({ error: "Interner Serverfehler." });
  }
});

// ==============================
// MESSAGE Endpoint (KI)
// ==============================

app.post("/message", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Nachricht fehlt." });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: message
        }
      ]
    });

    return res.json({
      success: true,
      response: completion.choices[0].message.content
    });
  } catch (err) {
    console.error("MESSAGE ERROR:", err);
    return res.status(500).json({ error: "Fehler bei der KI-Abfrage." });
  }
});

// ==============================
// Server Start
// ==============================

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("AptiQ Backend läuft auf Port", PORT);
});
