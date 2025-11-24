import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

app.use(cors({
  origin: ["https://nocxai.com", "http://localhost:5500"],
}));
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.json({ status: "AptiQ Backend läuft auf Render ✅" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message fehlt" });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [
        { role: "system", content: "Du bist AptiQ, ein klarer, technischer Assistent von NoCxAI." },
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("AptiQ Backend läuft auf Port", PORT);
});
