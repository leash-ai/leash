"use client";

import { BotBuilder } from "./BotBuilder";

interface Props {
  onClose: () => void;
  onCreated: (name: string, strategy: string) => void;
}

/** The builder in a dialog, for when you reach the duel form without a bot. */
export function CreateBotModal({ onClose, onCreated }: Props) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 w-full max-w-lg flex flex-col"
        style={{ maxHeight: "88vh" }}
      >
        <h2 className="text-xl font-bold mb-1">Create a bot</h2>
        <p className="text-xs text-zinc-500 font-mono mb-4">
          Describe how it should trade. It runs on your machine — nobody sees it, not even
          your opponent.
        </p>

        <BotBuilder
          onCreated={onCreated}
          footer={
            <button
              onClick={onClose}
              className="text-xs text-zinc-600 hover:text-zinc-400 mt-3 self-center mx-auto block"
            >
              Cancel
            </button>
          }
        />
      </div>
    </div>
  );
}
