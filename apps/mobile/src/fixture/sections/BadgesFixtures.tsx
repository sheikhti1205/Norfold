import { PostIdentityHeader } from "../../components/PostAnatomy";
import { ALL_VARIANTS, FixtureFrame, FixtureSection } from "../FixtureSection";
import { makePost } from "../posts";

const base = makePost("badge-fixture");
const tiers = [
  ["none", false, false],
  ["email", true, false],
  ["phone", false, true],
  ["both", true, true],
] as const;

export function BadgesFixtures() {
  return <FixtureSection id="badges" title="Verification badges" description="Identity lines for each verification tier.">
    {ALL_VARIANTS.map((variant) => <FixtureFrame key={variant} section="badges" variant={variant}>
      {tiers.map(([tier, emailVerified, phoneVerified]) => <div key={tier} data-testid={`fixture-badge-tier-${tier}`}>
        <PostIdentityHeader post={{ ...base, author: { ...base.author, emailVerified, phoneVerified } }} />
      </div>)}
    </FixtureFrame>)}
  </FixtureSection>;
}
