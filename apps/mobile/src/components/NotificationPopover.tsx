import { useState, type ReactNode } from "react";
import { Button, Dialog, DialogTrigger } from "react-aria-components";
import { LayeredPopover } from "./overlayFoundation";
import { useHoverLabel } from "./HoverLabel";
import { Notifications } from "../screens/Notifications";

/** A quick inbox presentation, not a second data cache or mutation owner. */
export function NotificationPopover({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { hoverLabel } = useHoverLabel();
  // 440px is the whole panel: ~94px header and filters, a 44px "See all"
  // footer, and ~300px of scrolling activity (3-4 rows). The quick inbox is a
  // preview, not a second route, so it must not claim the window.
  return <DialogTrigger isOpen={open} onOpenChange={setOpen}>
    <Button aria-label="Notifications" className="fb-icon-control relative" {...hoverLabel("Notifications")}>{trigger}</Button>
    <LayeredPopover placement="bottom end" offset={6} maxHeight={440} className="fb-notification-popover">
      <Dialog className="fb-notification-dialog">
        <Notifications preview onNavigate={() => setOpen(false)} />
      </Dialog>
    </LayeredPopover>
  </DialogTrigger>;
}
