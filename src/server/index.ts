import express from "express";
import cors from "cors";
import accountsRouter from "./routes/accounts.js";
import scrapeRouter from "./routes/scrape.js";
import reconcileRouter from "./routes/reconcile.js";
import reportRouter from "./routes/report.js";
import { loadAppEnv } from "../env.js";

const app = express();
const PORT = 3001;

loadAppEnv();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Routes
app.use("/api/accounts", accountsRouter);
app.use("/api", scrapeRouter);
app.use("/api/reconcile", reconcileRouter);
app.use("/api", reportRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
