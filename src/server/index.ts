import express from "express";
import accountsRouter from "./routes/accounts.js";
import scrapeRouter from "./routes/scrape.js";
import ynabRouter from "./routes/ynab.js";
import historyRouter from "./routes/history.js";
import { loadAppEnv } from "../env.js";

const app = express();
const PORT = 3001;

loadAppEnv();

app.use(express.json({ limit: "50mb" }));

// Routes
app.use("/api/accounts", accountsRouter);
app.use("/api/ynab", ynabRouter);
app.use("/api/history", historyRouter);
app.use("/api", scrapeRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

