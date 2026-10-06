import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  getYnabAccounts,
  getYnabBudgets,
  getYnabImportConfig,
  saveYnabImportConfig,
  type YnabImportConfig,
  type YnabOption,
} from "@/api/client";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function YnabPage() {
  const [config, setConfig] = useState<YnabImportConfig>({ budgetId: "", mappings: {} });
  const [budgets, setBudgets] = useState<YnabOption[]>([]);
  const [ynabAccounts, setYnabAccounts] = useState<YnabOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getYnabImportConfig(), getYnabBudgets()])
      .then(([loadedConfig, loadedBudgets]) => {
        setConfig(loadedConfig);
        setBudgets(loadedBudgets);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load YNAB settings"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!config.budgetId) {
      setYnabAccounts([]);
      return;
    }
    getYnabAccounts(config.budgetId)
      .then(setYnabAccounts)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load YNAB accounts"));
  }, [config.budgetId]);

  const setBudget = (budgetId: string) => {
    // Account ids belong to one budget, so a budget change clears the mappings.
    setConfig({
      budgetId,
      mappings: Object.fromEntries(Object.keys(config.mappings).map((source) => [source, ""])),
    });
    setStatus("");
  };

  const setMapping = (source: string, accountId: string) => {
    setConfig({ ...config, mappings: { ...config.mappings, [source]: accountId } });
    setStatus("");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      setConfig(await saveYnabImportConfig(config));
      setStatus("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-muted-foreground">Loading YNAB settings...</div>;
  }

  const sources = Object.keys(config.mappings).sort();

  return (
    <Card>
      <CardHeader>
        <CardTitle>YNAB Import</CardTitle>
        <p className="text-xs text-muted-foreground">
          Map each scraped source to a YNAB account. Sources appear here after their first scrape.
          Unmapped sources are not sent to YNAB.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-2">
          <Label htmlFor="ynab-budget">Budget</Label>
          <select
            id="ynab-budget"
            className={selectClass}
            value={config.budgetId}
            onChange={(e) => setBudget(e.target.value)}
          >
            <option value="">Select a budget</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
          </select>
        </div>

        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sources yet. Run a scrape first.</p>
        ) : (
          <div className="space-y-3 border-t pt-4">
            {sources.map((source) => (
              <div key={source} className="grid items-center gap-2 sm:grid-cols-2">
                <Label htmlFor={`map-${source}`}>{source}</Label>
                <select
                  id={`map-${source}`}
                  className={selectClass}
                  value={config.mappings[source]}
                  disabled={!config.budgetId}
                  onChange={(e) => setMapping(source, e.target.value)}
                >
                  <option value="">Do not import</option>
                  {ynabAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          {status && <span className="text-sm text-green-600">{status}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
