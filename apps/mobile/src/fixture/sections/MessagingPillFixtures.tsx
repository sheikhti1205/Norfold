import { ConversationStrip, type StripPerson } from "../../components/ConversationStrip";
import { MessagePill } from "../../components/MessagePill";
import { ALL_VARIANTS, FixtureFrame, FixtureSection } from "../FixtureSection";

const people: StripPerson[] = Array.from({ length: 8 }, (_, index) => ({
  conversationId: `fixture-person-${index}`,
  name: index === 7 ? "AnUnbreakablyLongFixtureNameForOverflowTesting" : `Person ${index + 1}`,
  username: `fixture${index}`,
}));

function noop() {}

export function MessagingPillFixtures() {
  return <FixtureSection id="messaging-pill" title="Messaging strip and pill" description="Conversation strip sizes and message pill.">
    {ALL_VARIANTS.map((variant) => <FixtureFrame key={variant} section="messaging-pill" variant={variant}>
      <ConversationStrip people={[]} onOpen={noop} />
      <ConversationStrip people={people.slice(0, 1)} onOpen={noop} />
      <ConversationStrip people={people} onOpen={noop} />
      {/* The pill is `position: fixed` in production, so inside the frame it
          anchors to the frame's own box (contain: paint). The spacer keeps it
          from covering the strip variants it is being reviewed next to. */}
      <div className="min-h-[200px]" />
      <MessagePill person={people[0]!} preview="A fixture message" onOpen={noop} onDismiss={noop} />
    </FixtureFrame>)}
  </FixtureSection>;
}
