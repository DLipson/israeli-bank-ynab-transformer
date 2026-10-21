import { useState } from "react";
import { RotateCw, Settings } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrapePage } from "@/pages/ScrapePage";
import { HistoryPage } from "@/pages/HistoryPage";
import { CategorizePage } from "@/pages/CategorizePage";
import { HomePage } from "@/pages/HomePage";
import { InboxPage } from "@/pages/InboxPage";
import { CardsPage } from "@/pages/CardsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SpendingProvider } from "@/pages/SpendingPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { ScrapeRunProvider } from "@/components/ScrapeRunProvider";
import { UpdateChip } from "@/components/UpdateChip";
import { useSpending } from "@/lib/spending";
import { cn } from "@/lib/utils";

/** Old tab names that pages still pass to navigate(). */
const OLD_TABS: Record<string, string> = { review: "inbox", setup: "settings" };

function Shell() {
  const { data, loading, reload } = useSpending();
  const [tab, setTab] = useState("home");
  const [views, setViews] = useState<Record<string, string>>({ settings: "main" });
  const setView = (t: string) => (v: string) => setViews((all) => ({ ...all, [t]: v }));
  const navigate = (t: string, v?: string) => {
    const target = OLD_TABS[t] ?? t;
    if (v) setView(target)(v);
    setTab(target);
  };
  const schedules = data?.suggestions.length ?? 0;
  const uncategorized = data?.uncategorizedCount ?? 0;
  const unusual = data?.anomalies.length ?? 0;
  const missing = data?.missing.length ?? 0;
  // While the Inbox is open its own queue gives the count; otherwise the counts from the numbers.
  // Keep this sum in step with buildQueue (gui/src/lib/inbox.ts): one term per kind of card.
  const [inboxQueueLeft, setInboxQueueLeft] = useState<number | null>(null);
  const inboxLeft = inboxQueueLeft ?? schedules + uncategorized + unusual + missing;

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
          <UpdateChip openScrape={() => setTab("scrape")} />
          <button
            type="button"
            aria-label="Refresh from YNAB"
            title="Refresh from YNAB"
            onClick={() => reload()}
            disabled={loading}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-60"
          >
            <RotateCw className={cn("h-[18px] w-[18px]", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            aria-label="Settings"
            onClick={() => navigate("settings", "main")}
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
          <ScrapePage openInbox={() => setTab("inbox")} openHistory={() => setTab("history")} />
        </TabsContent>

        <TabsContent value="history">
          <HistoryPage />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsPage view={views.settings ?? "main"} setView={setView("settings")} />
        </TabsContent>

        <TabsContent value="reports">
          <ReportsPage />
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
