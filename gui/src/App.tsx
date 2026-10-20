import { useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountsPage } from "@/pages/AccountsPage";
import { ScrapePage } from "@/pages/ScrapePage";
import { YnabPage } from "@/pages/YnabPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { CategorizePage } from "@/pages/CategorizePage";
import { HomePage } from "@/pages/HomePage";
import { ReconcilePage } from "@/pages/ReconcilePage";
import { InboxPage } from "@/pages/InboxPage";
import { CardsPage } from "@/pages/CardsPage";
import {
  ReportsPanel,
  SpendingProvider,
  SpendingSettingsPanel,
} from "@/pages/SpendingPage";
import { ScrapeRunProvider } from "@/components/ScrapeRunProvider";
import { UpdateChip } from "@/components/UpdateChip";
import { useSpending } from "@/lib/spending";
import { cn } from "@/lib/utils";

/** A second row of tabs inside a top tab (e.g. Scrape: Scrape | Past runs). */
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

/** Old tab names that pages still pass to navigate(). */
const OLD_TABS: Record<string, string> = { review: "inbox", setup: "settings" };

function Shell() {
  const { data } = useSpending();
  const [tab, setTab] = useState("home");
  const [views, setViews] = useState<Record<string, string>>({ scrape: "scrape", settings: "spending" });
  const setView = (t: string) => (v: string) => setViews((all) => ({ ...all, [t]: v }));
  const navigate = (t: string, v?: string) => {
    const target = OLD_TABS[t] ?? t;
    if (v) setView(target)(v);
    setTab(target);
  };
  const schedules = data?.suggestions.length ?? 0;
  const uncategorized = data?.uncategorizedCount ?? 0;
  const unusual = data?.anomalies.length ?? 0;
  // While the Inbox is open its own queue gives the count; otherwise the counts from the numbers.
  const [inboxQueueLeft, setInboxQueueLeft] = useState<number | null>(null);
  const inboxLeft = inboxQueueLeft ?? schedules + uncategorized + unusual;

  return (
    <div className="mx-auto max-w-[680px] px-4 py-6">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="home">Home</TabsTrigger>
            <TabsTrigger value="inbox">Inbox{inboxLeft > 0 && ` · ${inboxLeft}`}</TabsTrigger>
            <TabsTrigger value="cards">Cards</TabsTrigger>
            <TabsTrigger value="scrape">Scrape</TabsTrigger>
          </TabsList>
          <span className="flex-1" />
          <UpdateChip openScrape={() => navigate("scrape", "scrape")} />
          <button
            type="button"
            aria-label="Settings"
            onClick={() => setTab("settings")}
            className={cn("rounded-md p-1.5 hover:bg-muted", tab === "settings" ? "text-foreground" : "text-muted-foreground")}
          >
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </div>

        <TabsContent value="home">
          <HomePage navigate={navigate} />
        </TabsContent>

        <TabsContent value="inbox">
          <InboxPage onLeft={setInboxQueueLeft} openList={() => setTab("categorize")} />
        </TabsContent>

        <TabsContent value="categorize">
          <CategorizePage />
        </TabsContent>

        <TabsContent value="cards">
          <CardsPage navigate={navigate} openGroup={views.cards} />
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

        <TabsContent value="settings">
          <SubTabs
            value={views.settings}
            onChange={setView("settings")}
            items={[
              { value: "spending", label: "Spending settings", content: <SpendingSettingsPanel /> },
              { value: "accounts", label: "Bank accounts", content: <AccountsPage /> },
              { value: "ynab", label: "YNAB import", content: <YnabPage /> },
              { value: "reconcile", label: "Reconcile", content: <ReconcilePage /> },
            ]}
          />
        </TabsContent>

        <TabsContent value="reports">
          <ReportsPanel />
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
