import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { AccountInfo } from "@/api/client";

interface ScrapeSettingsProps {
  daysBack: number;
  setDaysBack: (v: number) => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  split: boolean;
  setSplit: (v: boolean) => void;
  showBrowser: boolean;
  setShowBrowser: (v: boolean) => void;
  enableDetailedLogging: boolean;
  setEnableDetailedLogging: (v: boolean) => void;
  detailedLoggingLimit: number;
  setDetailedLoggingLimit: (v: number) => void;
  concurrency: number;
  setConcurrency: (v: number) => void;
  accounts: AccountInfo[];
  selectedAccounts: string[];
  setSelectedAccounts: (v: string[]) => void;
  accountsLoading: boolean;
  accountsError: string;
  onStart: () => void;
  disabled: boolean;
}

export function ScrapeSettings({
  daysBack,
  setDaysBack,
  outputDir,
  setOutputDir,
  split,
  setSplit,
  showBrowser,
  setShowBrowser,
  enableDetailedLogging,
  setEnableDetailedLogging,
  detailedLoggingLimit,
  setDetailedLoggingLimit,
  concurrency,
  setConcurrency,
  accounts,
  selectedAccounts,
  setSelectedAccounts,
  accountsLoading,
  accountsError,
  onStart,
  disabled,
}: ScrapeSettingsProps) {
  const enabledAccounts = accounts.filter((account) => account.enabled);
  const toggleAccount = (name: string) => {
    if (selectedAccounts.includes(name)) {
      setSelectedAccounts(selectedAccounts.filter((account) => account !== name));
    } else {
      setSelectedAccounts([...selectedAccounts, name]);
    }
  };

  const selectAll = () => setSelectedAccounts(enabledAccounts.map((account) => account.name));
  const clearAll = () => setSelectedAccounts([]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="daysBack">Days Back</Label>
          <Input
            id="daysBack"
            type="number"
            min={1}
            value={daysBack}
            onChange={(e) => setDaysBack(parseInt(e.target.value) || 60)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="outputDir">Output Directory</Label>
          <Input id="outputDir" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch id="split" checked={split} onCheckedChange={setSplit} />
          <Label htmlFor="split">Split by account</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="showBrowser" checked={showBrowser} onCheckedChange={setShowBrowser} />
          <Label htmlFor="showBrowser">Show browser</Label>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="concurrency">Concurrency</Label>
        <Input
          id="concurrency"
          type="number"
          min={1}
          value={concurrency}
          onChange={(e) => setConcurrency(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-32"
        />
      </div>

      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <Switch
            id="enableDetailedLogging"
            checked={enableDetailedLogging}
            onCheckedChange={setEnableDetailedLogging}
          />
          <Label htmlFor="enableDetailedLogging">Enable detailed logging</Label>
        </div>
        {enableDetailedLogging && (
          <div className="space-y-2 ml-8">
            <Label htmlFor="detailedLoggingLimit" className="text-sm text-muted-foreground">
              Log item limit (0 = all items)
            </Label>
            <Input
              id="detailedLoggingLimit"
              type="number"
              min={0}
              value={detailedLoggingLimit}
              onChange={(e) => setDetailedLoggingLimit(parseInt(e.target.value) || 0)}
              className="w-32"
            />
          </div>
        )}
      </div>

      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Accounts to scrape</Label>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={selectAll} disabled={disabled}>
              Select all
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={clearAll} disabled={disabled}>
              Clear
            </Button>
          </div>
        </div>

        {accountsLoading && (
          <div className="text-xs text-muted-foreground">Loading accounts...</div>
        )}

        {!accountsLoading && accountsError && (
          <div className="text-xs text-destructive">{accountsError}</div>
        )}

        {!accountsLoading && !accountsError && enabledAccounts.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No configured accounts. Add credentials in the Accounts tab.
          </div>
        )}

        {!accountsLoading && !accountsError && enabledAccounts.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {enabledAccounts.map((account) => (
              <label key={account.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedAccounts.includes(account.name)}
                  onChange={() => toggleAccount(account.name)}
                  disabled={disabled}
                />
                <span>{account.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <Button
        onClick={onStart}
        disabled={disabled || selectedAccounts.length === 0}
        className="w-full"
      >
        {disabled ? "Scraping..." : "Start Scraping"}
      </Button>
    </div>
  );
}
