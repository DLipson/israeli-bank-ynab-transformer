import express from "express";
import accountsRouter from "./routes/accounts.js";
import scrapeRouter from "./routes/scrape.js";
import ynabRouter from "./routes/ynab.js";
import historyRouter from "./routes/history.js";
import categorizeRouter from "./routes/categorize.js";
import spendingRouter from "./routes/spending.js";
import { loadAppEnv } from "../env.js";

const app = express();
// PORT lets a second checkout (e.g. a git worktree) run next to the main one.
const PORT = Number(process.env.PORT) || 3001;

loadAppEnv();

app.use(express.json({ limit: "50mb" }));

// Routes
app.use("/api/accounts", accountsRouter);
app.use("/api/ynab", ynabRouter);
app.use("/api/history", historyRouter);
app.use("/api/categorize", categorizeRouter);
app.use("/api/spending", spendingRouter);
app.use("/api", scrapeRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

