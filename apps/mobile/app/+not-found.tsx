import { router } from "expo-router";
import { Button, EmptyState, Screen } from "../src/components/ui";

/** A link the app doesn't recognise (an old or mistyped one). */
export default function NotFound() {
  return (
    <Screen>
      <EmptyState icon="compass-outline" title="That link didn't lead anywhere" body="It may be out of date. You can still scan the event's QR code or type its code.">
        <Button label="Go to the start" onPress={() => router.replace("/")} />
      </EmptyState>
    </Screen>
  );
}
