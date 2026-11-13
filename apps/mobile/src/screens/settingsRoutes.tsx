import { Navigate, Route } from "react-router";
import { NativeOnly, RequireAdmin } from "../components/Guards";
import { RequireCapability } from "../components/RequireCapability";
import { AccountSettings } from "./AccountSettings";
import { Devices } from "./Devices";
import { BackupSettings } from "./BackupSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { AccessibilitySettings } from "./AccessibilitySettings";
import { FeedLayoutSettings } from "./FeedLayoutSettings";
import { MediaSettings } from "./MediaSettings";
import { NotificationPreferences } from "./NotificationPreferences";
import { PrivacySettings } from "./PrivacySettings";
import { MessagingPrivacy } from "./MessagingPrivacy";
import { BlockedUsers } from "./BlockedUsers";
import { SafetyReports } from "./SafetyReports";
import { MyAppeals } from "./MyAppeals";
import { FeedbackForm } from "./FeedbackForm";
import { Returns } from "./Returns";
import { ModerationQueue } from "./ModerationQueue";
import { StaffAppeals, StaffAppeal } from "./StaffAppeals";
import { StaffFeedback, StaffFeedbackDetail } from "./StaffFeedback";
import { AiSettings } from "./AiSettings";
import { AiConnection } from "./AiConnection";
import { CloudModels } from "./CloudModels";
import { AiPrivacy } from "./AiPrivacy";
import { LocalIntelligence } from "./LocalIntelligence";
import { DownloadedModels } from "./DownloadedModels";
import { HelpGuide } from "./HelpGuide";
import { AdminTeam } from "./AdminTeam";
import { AdminBootstrap } from "./AdminBootstrap";
import { AdminInvite } from "./AdminInvite";
import { AdminAuditLog } from "./AdminAuditLog";
import { Updates } from "./Updates";
import { About } from "./About";
import { CommunityGuidelines, PrivacyPolicy, Terms } from "./Legal";
import { Diagnostics } from "./Diagnostics";

/**
 * The settings subtree, declared once.
 *
 * The same rows feed the inline `/settings` route and the floating settings
 * window. Keeping one list means a settings page can never exist in the window
 * and be missing at its URL, or the reverse. Returned as route elements (not a
 * wrapper component) because `<Routes>` only accepts Route/Fragment children.
 */
export function settingsRouteElements() {
  return <>
    {/* Eligibility and the claim itself are server-controlled. An
        existing admin role must not be required to reach setup. */}
    <Route path="/settings/administrator" element={<AdminBootstrap />} />
    <Route path="/settings/account" element={<AccountSettings />} />
    <Route path="/settings/devices" element={<Devices />} />
    <Route path="/settings/backup" element={<BackupSettings />} />
    <Route path="/settings/appearance" element={<AppearanceSettings />} />
    <Route path="/settings/accessibility" element={<AccessibilitySettings />} />
    <Route path="/settings/feed-layout" element={<FeedLayoutSettings />} />
    <Route path="/settings/media" element={<MediaSettings />} />
    <Route path="/settings/notifications" element={<NotificationPreferences />} />
    <Route path="/settings/privacy" element={<PrivacySettings />} />
    <Route path="/settings/privacy/messages" element={<MessagingPrivacy />} />
    <Route path="/settings/privacy/blocked" element={<BlockedUsers />} />
    <Route path="/settings/privacy/reports" element={<SafetyReports />} />
    <Route path="/settings/privacy/appeals" element={<MyAppeals />} />
    <Route path="/settings/feedback" element={<FeedbackForm />} />
    <Route path="/settings/returns" element={<Returns />} />
    <Route path="/settings/moderation/queue" element={<RequireCapability capability="reports_review"><ModerationQueue /></RequireCapability>} />
    <Route path="/settings/moderation/appeals" element={<StaffAppeals />} />
    <Route path="/settings/moderation/appeals/:appealId" element={<StaffAppeal />} />
    <Route path="/settings/moderation/feedback" element={<StaffFeedback />} />
    <Route path="/settings/moderation/feedback/:feedbackId" element={<StaffFeedbackDetail />} />
    <Route path="/settings/ai" element={<AiSettings />} />
    <Route path="/settings/ai/connections" element={<AiConnection />} />
    <Route path="/settings/ai/chat-models" element={<CloudModels />} />
    <Route path="/settings/ai/privacy" element={<AiPrivacy />} />
    <Route path="/settings/ai/models" element={<NativeOnly><Navigate to="/settings/local-intelligence" replace /></NativeOnly>} />
    <Route path="/settings/local-intelligence" element={<NativeOnly><LocalIntelligence /></NativeOnly>} />
    <Route path="/settings/local-intelligence/downloads" element={<NativeOnly><DownloadedModels /></NativeOnly>} />
    <Route path="/settings/help" element={<HelpGuide />} />
    {/* Staff console. The Settings row is role-gated and these routes are
        guarded too, so a typed URL never reaches the console. */}
    <Route path="/settings/team" element={<RequireAdmin><AdminTeam /></RequireAdmin>} />
    <Route path="/settings/team/invite" element={<RequireAdmin><AdminInvite /></RequireAdmin>} />
    <Route path="/settings/team/audit" element={<RequireAdmin><AdminAuditLog /></RequireAdmin>} />
    <Route path="/settings/updates" element={<Updates />} />
    <Route path="/settings/about" element={<About />} />
    <Route path="/settings/terms" element={<Terms />} />
    <Route path="/settings/privacy-policy" element={<PrivacyPolicy />} />
    <Route path="/settings/community-guidelines" element={<CommunityGuidelines />} />
    <Route path="/settings/diagnostics" element={<Diagnostics />} />
  </>;
}
