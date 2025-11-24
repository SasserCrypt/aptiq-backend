import express from "express";
import cors from "cors";

const app = express();

app.use(express.json());  // BODY PARSER
app.use(cors());

// DEBUG-ROUTE
app.post("/api/chat", (req, res) => {
  console.log("RAW BODY:", req.body);
  return res.json({
    received: req.body,
    message: req.body?.message || null,
    info: "Wenn hier {} steht, kommt kein Body an."
  });
});

// Healthcheck
app.get("/", (req, res) => {
  res.json({ status: "DEBUG SERVER läuft" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("DEBUG Server läuft auf Port", PORT));
