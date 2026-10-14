import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import type { AccountInfo } from "@/api/client";
import { saveCredentials, deleteCredentials } from "@/api/client";

interface AccountCardProps {
  account: AccountInfo;
  onUpdated: () => void;
}

function fieldId(accountName: string, field: string): string {
  return `${accountName}-${field}`.replace(/[^A-Za-z0-9_-]+/g, "_");
}

export function AccountCard({ account, onUpdated }: AccountCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of account.fields) {
      initial[f] = "";
    }
    return initial;
  });
  const [showFields, setShowFields] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await saveCredentials(account.name, fields);
      onUpdated();
      setExpanded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await deleteCredentials(account.name);
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const toggleShow = (field: string) => {
    setShowFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-medium">{account.name}</span>
          {account.primary && <Badge variant="outline">Default</Badge>}
        </span>
        <Badge variant={account.enabled ? "success" : "secondary"}>
          {account.enabled ? "Configured" : "Not configured"}
        </Badge>
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-3 py-3">
          {account.fields.map((field) => {
            const id = fieldId(account.name, field);
            return (
              <div key={field} className="space-y-1">
                <Label htmlFor={id}>{field}</Label>
                <div className="flex gap-2">
                  <Input
                    id={id}
                    type={showFields[field] ? "text" : "password"}
                    value={fields[field] ?? ""}
                    onChange={(e) =>
                      setFields((prev) => ({ ...prev, [field]: e.target.value }))
                    }
                    placeholder={account.enabled ? "(saved - enter new value to update)" : ""}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleShow(field)}
                    type="button"
                  >
                    {showFields[field] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            );
          })}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? "Saving..." : "Save"}
            </Button>
            {(account.enabled || !account.primary) && (
              <Button
                onClick={handleDelete}
                disabled={deleting}
                variant="destructive"
                size="sm"
              >
                {deleting ? "Removing..." : "Remove"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
