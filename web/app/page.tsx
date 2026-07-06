import { AppShell } from "@/components/shell/AppShell";
import { AppProvider } from "@/lib/store";

// The app shell HTML references hashed CSS/JS that changes each deploy, so it
// must not be durably edge-cached (that stranded iOS PWAs on old bundles). But
// force-dynamic (render every request) removed all caching and tripped rate
// limits. Middle ground: revalidate every 60s — cacheable enough to absorb
// traffic, fresh enough that a deploy lands within a minute, and the client
// self-updater/version.json closes the remaining gap.
export const revalidate = 60;

export default function Page() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
