import { AppBar } from "../components/AppBar";

export function Reactions() {
  return <div className="h-full overflow-y-auto">
    <AppBar title="Reactions" backTo="/" />
    <div className="space-y-6 px-4 py-5">
      <section aria-labelledby="liked-reports"><h2 id="liked-reports" className="text-lg font-semibold">Liked reports</h2><p>Your liked reports are not available here yet.</p></section>
      <section aria-labelledby="disliked-reports"><h2 id="disliked-reports" className="text-lg font-semibold">Disliked reports</h2><p>Your disliked reports are not available here yet.</p></section>
    </div>
  </div>;
}
