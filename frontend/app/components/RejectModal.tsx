"use client";

import { useState } from "react";
import type { RejectReasonCategory } from "../lib/rec-types";

export type { RejectReasonCategory };

const CATEGORIES: Array<{ id: RejectReasonCategory; label: string; hint: string }> = [
  { id: "quality_risk",     label: "Quality risk",     hint: "Faithfulness, preference, or latency concern." },
  { id: "cost_unclear",     label: "Cost unclear",     hint: "Can't verify the projected savings." },
  { id: "business_context", label: "Business context", hint: "A reason our pipeline can't see." },
  { id: "other",            label: "Other",            hint: "Describe below." },
];

export function RejectModal({
  recTitle,
  onClose,
  onSubmit,
}: {
  recTitle: string;
  onClose: () => void;
  onSubmit: (category: RejectReasonCategory, note: string) => void;
}) {
  const [category, setCategory] = useState<RejectReasonCategory | null>(null);
  const [note, setNote] = useState("");

  return (
    <div className="tr-modal-scrim" onClick={onClose}>
      <div className="tr-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="tr-modal-head">
          <div>
            <div className="tr-modal-eyebrow">Reject recommendation</div>
            <div className="tr-modal-title">{recTitle}</div>
          </div>
          <button className="tr-icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="tr-modal-body">
          <div className="tr-set-row-label">Reason</div>
          <div className="tr-modal-cats">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`tr-modal-cat ${category === c.id ? "active" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                <div className="tr-modal-cat-label">{c.label}</div>
                <div className="tr-modal-cat-hint">{c.hint}</div>
              </button>
            ))}
          </div>

          <label className="tr-set-row-label" style={{ marginTop: 18, display: "block" }}>
            Note (optional)
          </label>
          <textarea
            className="tr-modal-textarea"
            placeholder="Context for the team. Powers the confidence model."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </div>

        <div className="tr-modal-actions">
          <button className="tr-btn tr-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="tr-btn tr-btn-primary"
            disabled={!category}
            onClick={() => category && onSubmit(category, note.trim())}
            style={{ opacity: category ? 1 : 0.5, cursor: category ? "pointer" : "not-allowed" }}
          >
            Reject recommendation
          </button>
        </div>
      </div>
    </div>
  );
}
