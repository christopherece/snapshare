import { logoMarkSvg } from "@snapshare/brand/logo";
import { useMemo } from "react";

/** SnapShare mark + wordmark (styles: .ss-logo in @snapshare/brand/tokens.css). */
export function Logo({ size = 28, label }: { size?: number; label?: string }) {
  const svg = useMemo(() => ({ __html: logoMarkSvg(size) }), [size]);
  return (
    <span className="ss-logo">
      <span className="ss-logo-mark" dangerouslySetInnerHTML={svg} />
      <span className="ss-logo-word">SnapShare</span>
      {label && <span className="ss-logo-label">{label}</span>}
    </span>
  );
}
