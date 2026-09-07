import * as React from "react";
import { KBButton, type KBButtonProps } from "./KBButton";

export type KBToolbarButtonProps = Omit<KBButtonProps, "size">;

export const KBToolbarButton = React.forwardRef<HTMLButtonElement, KBToolbarButtonProps>(
  (props, ref) => <KBButton ref={ref} size="lg" {...props} />
);
KBToolbarButton.displayName = "KBToolbarButton";
