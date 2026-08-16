"use client";

export function PrintButton() {
  return (
    <button className="nova-btn-ghost" onClick={() => window.print()}>
      Print Report
    </button>
  );
}
