// =============================
// APTIQ – SERVER.JS (FINAL)
// =============================

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// SUPABASE CLIENT
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

// JWT
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// FILE UPLOAD HANDLER
const upload = multer({ dest: "uploads/" });

// =============================
// AUTH
// =============================
app.post("/register", async (req, res) => {
  try {
    const { email, password, username } = req.body;

    const { data: authUser, error: signUpError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (signUpError) return res.status(400).json({ error: signUpError.message });

    await supabase
  .from("profiles")
  .insert({ id: user.id, email: email, username: username });

    return res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(400).json({ error: error.message });

  const token = jwt.sign({ uid: data.user.id }, JWT_SECRET, { expiresIn: "7d" });

  res.json({ token });
});

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing token" });

  try {
    const token = header.split(" ")[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// =============================
// CHAT MESSAGES
// =============================
app.get("/messages", auth, async (req, res) => {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("user_id", req.user.uid)
    .order("created_at", { ascending: true });

  res.json(data);
});

app.post("/message", auth, async (req, res) => {
  const { content } = req.body;

  await supabase.from("messages").insert({
    user_id: req.user.uid,
    content,
    sender: "user"
  });

  const aiResponse = "AptiQ antwortet später hier...";

  await supabase.from("messages").insert({
    user_id: req.user.uid,
    content: aiResponse,
    sender: "assistant"
  });

  res.json({ reply: aiResponse });
});

// =============================
// FILE UPLOADS
// =============================
app.post("/upload", auth, upload.single("file"), async (req, res) => {
  const file = req.file;

  const fileData = fs.readFileSync(file.path);

  const { data: uploadResult, error: uploadError } = await supabase.storage
    .from("user-files")
    .upload(`${req.user.uid}/${file.originalname}`, fileData, {
      contentType: file.mimetype
    });

  if (uploadError) return res.status(400).json({ error: uploadError.message });

  await supabase.from("files").insert({
    user_id: req.user.uid,
    name: file.originalname,
    path: uploadResult.path,
    size: file.size,
    mime_type: file.mimetype
  });

  fs.unlinkSync(file.path);

  res.json({ success: true });
});

// =============================
// ADMIN DASHBOARD
// =============================
app.get("/admin/users", auth, async (req, res) => {
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.uid)
    .single();

  if (me.role !== "admin") return res.status(403).json({ error: "Not admin" });

  const { data: users } = await supabase.from("profiles").select("*");
  res.json(users);
});

app.get("/admin/messages", auth, async (req, res) => {
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.uid)
    .single();

  if (me.role !== "admin") return res.status(403).json({ error: "Not admin" });

  const { data } = await supabase.from("messages").select("*");
  res.json(data);
});

app.get("/admin/files", auth, async (req, res) => {
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.uid)
    .single();

  if (me.role !== "admin") return res.status(403).json({ error: "Not admin" });

  const { data } = await supabase.from("files").select("*");
  res.json(data);
});

// =============================
// SERVER START
// =============================
app.listen(3000, () => console.log("AptiQ backend running on port 3000"));
