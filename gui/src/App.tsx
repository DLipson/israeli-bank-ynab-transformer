import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountsPage } from "@/pages/AccountsPage";
import { ScrapePage } from "@/pages/ScrapePage";
import { ReconcilePage } from "@/pages/ReconcilePage";
import { ReportPage } from "@/pages/ReportPage";

export default function App() {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Israeli Bank YNAB</h1>

      <Tabs defaultValue="accounts">
        <TabsList className="mb-4">
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="scrape">Scrape</TabsTrigger>
          <TabsTrigger value="reconcile">Reconcile</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          <AccountsPage />
        </TabsContent>

        <TabsContent value="scrape">
          <ScrapePage />
        </TabsContent>

        <TabsContent value="reconcile">
          <ReconcilePage />
        </TabsContent>

        <TabsContent value="report">
          <ReportPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
