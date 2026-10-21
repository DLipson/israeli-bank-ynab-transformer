import { useState, type ReactNode } from "react";
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

/** "14:32" today, else "20 Oct 14:32". */
function readTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString("en-IL", { day: "numeric", month: "short" })} ${time}`;
}

function Pane({ value, visited, children }: { value: string; visited: Set<string>; children: ReactNode }) {
  if (!visited.has(value)) return null;
  return (
    <TabsContent value={value} forceMount className="data-[state=inactive]:hidden">
      {children}
    </TabsContent>
  );
}

/** Old tab names that pages still pass to navigate(). */
const OLD_TABS: Record<string, string> = { review: "inbox", setup: "settings" };

function Shell() {
  const { data, loading, reload, freshCount } = useSpending();
  const [tab, setTab] = useState("home");
  // A tab mounts when it is first opened and then stays mounted, so opening it again does not reload its data.
  const [visited, setVisited] = useState(() => new Set(["home"]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));
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
          {data?.ynabReadAt && (
            <span className="text-xs text-muted-foreground" title={`Numbers read from YNAB at ${new Date(data.ynabReadAt).toLocaleString("en-IL")}`}>
              YNAB {readTime(data.ynabReadAt)}
            </span>
          )}
          <button
            type="button"
            aria-label="Refresh from YNAB"
            title="Refresh from YNAB"
            onClick={() => reload({ fresh: true })}
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

        <Pane value="home" visited={visited}>
          <HomePage navigate={navigate} />
        </Pane>

        <Pane value="inbox" visited={visited}>
          <InboxPage key={freshCount} onLeft={setInboxQueueLeft} openList={() => setTab("categorize")} />
        </Pane>

        <Pane value="categorize" visited={visited}>
          <CategorizePage />
        </Pane>

        <Pane value="cards" visited={visited}>
          <CardsPage navigate={navigate} openGroup={views.cards} />
        </Pane>

        <Pane value="scrape" visited={visited}>
          <ScrapePage openInbox={() => setTab("inbox")} openHistory={() => setTab("history")} />
        </Pane>

        <Pane value="history" visited={visited}>
          <HistoryPage />
        </Pane>

        <Pane value="settings" visited={visited}>
          <SettingsPage view={views.settings ?? "main"} setView={setView("settings")} />
        </Pane>

        <Pane value="reports" visited={visited}>
          <ReportsPage />
        </Pane>
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
