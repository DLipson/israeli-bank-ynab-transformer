import { useEffect, useState } from "react";
import { createAccount, getAccounts, type AccountInfo } from "@/api/client";
import { AccountCard } from "@/components/AccountCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function AddAccountForm({ bankName, onAdded }: { bankName: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleAdd = async () => {
    setSaving(true);
    setError("");
    try {
      await createAccount(bankName, name);
      setName("");
      setOpen(false);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add account");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add login
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed px-3 py-3">
      <Label htmlFor={`add-${bankName}`}>New {bankName} login name</Label>
      <Input
        id={`add-${bankName}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`e.g. ${bankName} Work`}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleAdd} disabled={saving || !name.trim()}>
          {saving ? "Adding..." : "Add"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError("");
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAccounts = async () => {
    try {
      setError("");
      const data = await getAccounts();
      setAccounts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  if (loading) {
    return <div className="p-4 text-muted-foreground">Loading accounts...</div>;
  }

  if (error) {
    return <div className="p-4 text-destructive">{error}</div>;
  }

  const bankNames: string[] = [];
  const byBank = new Map<string, AccountInfo[]>();
  for (const account of accounts) {
    if (!byBank.has(account.bankName)) {
      byBank.set(account.bankName, []);
      bankNames.push(account.bankName);
    }
    byBank.get(account.bankName)!.push(account);
  }

  return (
    <div className="space-y-6">
      {bankNames.map((bankName) => (
        <div key={bankName} className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">{bankName}</h3>
          {byBank.get(bankName)!.map((account) => (
            <AccountCard key={account.name} account={account} onUpdated={fetchAccounts} />
          ))}
          <AddAccountForm bankName={bankName} onAdded={fetchAccounts} />
        </div>
      ))}
    </div>
  );
}
