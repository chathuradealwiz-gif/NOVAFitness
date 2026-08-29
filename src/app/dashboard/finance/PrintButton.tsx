"use client";

import { IconPrint } from "@/components/icons";

export function PrintButton() {
  return (
    <button className="nova-btn-ghost" onClick={() => window.print()}>
      <IconPrint size={16} />
      Print Report
    </button>
  );
}
