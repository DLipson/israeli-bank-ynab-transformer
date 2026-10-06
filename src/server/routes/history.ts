import { Router } from "express";
import { getRun, listRuns } from "../../history.js";

const router = Router();

router.get("/", (_req, res) => {
  try {
    res.json({ runs: listRuns() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get("/:id", (req, res) => {
  try {
    const run = getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(run);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
