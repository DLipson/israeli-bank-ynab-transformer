import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  getYnabAccounts,
  getYnabBudgets,
  getYnabImportConfig,
  getYnabTokenStatus,
  saveYnabImportConfig,
  saveYnabToken,
  type YnabImportConfig,
  type YnabOption,
} from "@/api/client";

export function YnabPage() {
  const [config, setConfig] = useState<YnabImportConfig>({ budgetId: "", mappings: {} });
  const [budgets, setBudgets] = useState<YnabOption[]>([]);
  const [ynabAccounts, setYnabAccounts] = useState<YnabOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const loadBudgets = async () => {
    setError("");
    try {
      setBudgets(await getYnabBudgets());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load YNAB budgets");
    }
  };

  useEffect(() => {
    Promise.all([getYnabImportConfig(), getYnabTokenStatus()])
      .then(async ([loadedConfig, token]) => {
        setConfig(loadedConfig);
        setTokenSaved(token.saved);
        if (token.saved) await loadBudgets();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load YNAB settings"))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveToken = async () => {
    setSavingToken(true);
    setError("");
    try {
      await saveYnabToken(tokenInput);
      setTokenSaved(true);
      setTokenInput("");
      await loadBudgets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save token");
    } finally {
      setSavingToken(false);
    }
  };

  useEffect(() => {
    if (!config.budgetId || !tokenSaved) {
      setYnabAccounts([]);
      return;
    }
    getYnabAccounts(config.budgetId)
      .then(setYnabAccounts)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load YNAB accounts"));
  }, [config.budgetId, tokenSaved]);

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
          <Label htmlFor="ynab-token">
            API token {tokenSaved && <span className="text-green-600">(saved)</span>}
          </Label>
          <div className="flex gap-2">
            <Input
              id="ynab-token"
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={tokenSaved ? "Enter a new token to replace it" : "Paste your YNAB token"}
            />
            <Button onClick={handleSaveToken} disabled={savingToken || !tokenInput.trim()}>
              {savingToken ? "Saving..." : "Save token"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Create one in YNAB: Account Settings → Developer Settings → New Token.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ynab-budget">Budget</Label>
          <Select
            id="ynab-budget"
            className="h-9 w-full"
            value={config.budgetId}
            disabled={!tokenSaved}
            onChange={setBudget}
            options={budgets.map((budget) => ({ value: budget.id, label: budget.name }))}
            emptyLabel="Select a budget"
          />
        </div>

        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sources yet. Run a scrape first.</p>
        ) : (
          <div className="space-y-3 border-t pt-4">
            {sources.map((source) => (
              <div key={source} className="grid items-center gap-2 sm:grid-cols-2">
                <Label htmlFor={`map-${source}`}>{source}</Label>
                <Select
                  id={`map-${source}`}
                  className="h-9 w-full"
                  value={config.mappings[source]}
                  disabled={!config.budgetId}
                  onChange={(accountId) => setMapping(source, accountId)}
                  options={ynabAccounts.map((account) => ({ value: account.id, label: account.name }))}
                  emptyLabel="Do not import"
                />
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
