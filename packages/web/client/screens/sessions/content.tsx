import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { SessionsSlotsScreen } from "./SessionsSlotsScreen.tsx";

type Navigate = ReturnType<typeof useScout>["navigate"];

export function SessionsContent({
  route,
  navigate,
}: {
  route: Route;
  navigate: Navigate;
}) {
  if (route.view !== "sessions") return null;
  return <SessionsSlotsScreen route={route} navigate={navigate} />;
}
