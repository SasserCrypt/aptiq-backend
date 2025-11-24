import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

// WICHTIG: Body Parser vor CORS
app.use(express.json());
app.use(cors({
  origin: ["https://nocxai.com", "http://localhost:5500"],
}));

// OpenAI Client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Healthcheck
app.get("/", (req, res) => {
  res.json({ status: "AptiQ Backend läuft auf Render ✅" });
});

// API Chat
app.post("/api/chat", async (req, res) => {
  try {
    console.log("BODY:", req.body); // DEBUG
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message fehlt" });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Du bist AptiQ, ein klarer, technischer Assistent." },
        { role: "user", content: message }
      ]
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });

  } catch (err) {
    console.error("AptiQ Fehler:", err);
    res.status(500).json({ error: "KI-Fehler", details: err.message });
  }
});

// Render Port
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("AptiQ Backend läuft auf Port", PORT));
