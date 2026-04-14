import { useState } from "react";
import {
  previewCategoryReport,
  sendTestCategoryReportEmail,
  type CategoryReportPreviewResponse,
} from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function statusVariant(status: "red" | "yellow" | "green"): "destructive" | "warning" | "success" {
  if (status === "red") return "destructive";
  if (status === "yellow") return "warning";
  return "success";
}

function statusLabel(status: "red" | "yellow" | "green"): string {
  if (status === "red") return "Red";
  if (status === "yellow") return "Yellow";
  return "Green";
}

export function ReportPage() {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [preview, setPreview] = useState<CategoryReportPreviewResponse | null>(null);

  const handlePreview = async () => {
    setLoading(true);
    setError("");
    setSendStatus("");
    try {
      const next = await previewCategoryReport();
      setPreview(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate report preview");
    } finally {
      setLoading(false);
    }
  };

  const handleSendTestEmail = async () => {
    setSending(true);
    setError("");
    setSendStatus("");
    try {
      const result = await sendTestCategoryReportEmail();
      setSendStatus(`Sent test email to ${result.recipientEmail}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test email");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Category Availability Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Generate a backend preview of the selected YNAB categories without using CLI.
          </p>
          <Button onClick={handlePreview} disabled={loading}>
            {loading ? "Generating..." : "Generate Preview"}
          </Button>
          <Button variant="outline" onClick={handleSendTestEmail} disabled={sending}>
            {sending ? "Sending..." : "Send Test Email"}
          </Button>
          {sendStatus && <p className="text-sm text-green-700">{sendStatus}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {preview && (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <span className="font-medium">Generated:</span> {preview.report.generatedAtLocal}
                </p>
                <p>
                  <span className="font-medium">Timezone:</span> {preview.report.timezone}
                </p>
                <p>
                  <span className="font-medium">Budget:</span> {preview.report.budgetId}
                </p>
                <p>
                  <span className="font-medium">Categories:</span> {preview.report.totals.count}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="destructive">Red: {preview.report.totals.red}</Badge>
                <Badge variant="warning">Yellow: {preview.report.totals.yellow}</Badge>
                <Badge variant="success">Green: {preview.report.totals.green}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview Rows</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.report.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                      </TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.groupName}</TableCell>
                      <TableCell className="text-right">{row.available}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
