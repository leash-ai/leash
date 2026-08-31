"use client";

import { BotBuilder } from "./BotBuilder";

interface Props {
  onClose: () => void;
  onCreated: (name: string, strategy: string) => void;
}

/** The builder in a dialog, for when you reach the duel form without a bot. */
export function CreateBotModal({ onClose, onCreated }: Props) {
  return (
    <div className="fixed inset-0 bg-track/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="bg-track-soft border border-track-line rounded-xl p-6 w-full max-w-lg flex flex-col"
        style={{ maxHeight: "88vh" }}
      >
        <h2 className="text-xl font-bold mb-1">Create a bot</h2>
        <p className="text-xs text-ink-faint font-mono mb-4">
          Describe how it should trade. It runs on your machine — nobody sees it, not even
          your opponent.
        </p>

        <BotBuilder
          onCreated={onCreated}
          footer={
            <button
              onClick={onClose}
              className="text-xs text-ink-faint hover:text-ink-dim mt-3 self-center mx-auto block"
            >
              Cancel
            </button>
          }
        />
      </div>
    </div>
  );
}
