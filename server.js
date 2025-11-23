import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors({
  origin: ["https://nocxai.com", "http://localhost:5500"] // deine Domains
}));
app.use(express.json());

// OpenAI-Client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Healthcheck
app.get("/", (req, res) => {
  res.json({ status: "AptiQ API läuft auf Render" });
});

// Chat-Endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "message fehlt" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Du bist AptiQ, ein klarer, technisch versierter Assistent." },
        { role: "user", content: message }
      ]
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error("AptiQ Fehler:", err);
    res.status(500).json({ error: "Interner KI-Fehler", details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("AptiQ Backend läuft auf Port", PORT);
});
