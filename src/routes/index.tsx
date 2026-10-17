import { createFileRoute } from "@tanstack/react-router";
import { RaceView } from "@/components/race-view";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <RaceView />;
}
