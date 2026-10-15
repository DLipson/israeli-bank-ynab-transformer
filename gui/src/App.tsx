import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountsPage } from "@/pages/AccountsPage";
import { ScrapePage } from "@/pages/ScrapePage";
import { YnabPage } from "@/pages/YnabPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { CategorizePage } from "@/pages/CategorizePage";
import { HomePage } from "@/pages/HomePage";
import { ReconcilePage } from "@/pages/ReconcilePage";
import { AnomaliesPanel, ReportsPanel, SchedulesPanel, SpendingProvider, SpendingSettingsPanel } from "@/pages/SpendingPage";
import { ScrapeRunProvider } from "@/components/ScrapeRunProvider";
import { useSpending } from "@/lib/spending";

/** A second row of tabs inside a top tab (e.g. Review: Categorize | Schedules). */
function SubTabs({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: Array<{ value: string; label: ReactNode; content: ReactNode }>;
}) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList className="mb-3 h-8">
        {items.map((i) => (
          <TabsTrigger key={i.value} value={i.value} className="gap-1.5 py-0.5 text-xs">
            {i.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((i) => (
        <TabsContent key={i.value} value={i.value}>
          {i.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function Count({ n }: { n: number }) {
  return n > 0 ? <span className="rounded-full bg-amber-100 px-1.5 text-[11px] leading-4 text-amber-800">{n}</span> : null;
}

function Shell() {
  const { data } = useSpending();
  const [tab, setTab] = useState("home");
  const [views, setViews] = useState<Record<string, string>>({ scrape: "scrape", review: "categorize", setup: "accounts" });
  const setView = (t: string) => (v: string) => setViews((all) => ({ ...all, [t]: v }));
  const navigate = (t: string, v?: string) => {
    if (v) setView(t)(v);
    setTab(t);
  };
  const schedules = data?.suggestions.length ?? 0;
  const uncategorized = data?.uncategorizedCount ?? 0;
  const unusual = data?.anomalies.length ?? 0;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Israeli Bank YNAB</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="scrape">Scrape</TabsTrigger>
          <TabsTrigger value="review" className="gap-1.5">
            Review <Count n={schedules + uncategorized + unusual} />
          </TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>

        <TabsContent value="home">
          <HomePage navigate={navigate} />
        </TabsContent>

        <TabsContent value="scrape">
          <SubTabs
            value={views.scrape}
            onChange={setView("scrape")}
            items={[
              { value: "scrape", label: "Scrape", content: <ScrapePage /> },
              { value: "history", label: "Past runs", content: <HistoryPage /> },
            ]}
          />
        </TabsContent>

        <TabsContent value="review">
          <SubTabs
            value={views.review}
            onChange={setView("review")}
            items={[
              { value: "categorize", label: <>Categorize <Count n={uncategorized} /></>, content: <CategorizePage /> },
              { value: "schedules", label: <>Schedules <Count n={schedules} /></>, content: <SchedulesPanel /> },
              { value: "unusual", label: <>Unusual <Count n={unusual} /></>, content: <AnomaliesPanel /> },
              { value: "reconcile", label: "Reconcile", content: <ReconcilePage /> },
            ]}
          />
        </TabsContent>

        <TabsContent value="reports">
          <ReportsPanel />
        </TabsContent>

        <TabsContent value="setup">
          <SubTabs
            value={views.setup}
            onChange={setView("setup")}
            items={[
              { value: "accounts", label: "Bank accounts", content: <AccountsPage /> },
              { value: "ynab", label: "YNAB import", content: <YnabPage /> },
              { value: "spending", label: "Spending settings", content: <SpendingSettingsPanel /> },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function App() {
  return (
    <SpendingProvider>
      <ScrapeRunProvider>
        <Shell />
      </ScrapeRunProvider>
    </SpendingProvider>
  );
}
