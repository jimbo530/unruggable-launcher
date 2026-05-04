// ElizaOS Plugin — Unruggable Launcher
// Gives agents access to Unruggable network data on Base

import { Plugin, Action, ActionExample } from "@elizaos/core";

const API_BASE = "https://tasern.quest/api/unruggable";

const getTokenomics: Action = {
  name: "GET_UNRUGGABLE_TOKENOMICS",
  description: "Get infrastructure token overview for the Unruggable Launcher network on Base. Returns MfT, BB, EB, AZUSD, CHAR token addresses, roles, reactor chain mechanics, and agent strategies.",
  similes: ["unruggable tokenomics", "MfT infrastructure", "BB EB tokens", "reactor chain"],
  examples: [
    [{ user: "user1", content: { text: "What are the Unruggable infrastructure tokens?" } }],
    [{ user: "user1", content: { text: "How does the MfT reactor chain work?" } }],
    [{ user: "user1", content: { text: "What can I do as an agent on Unruggable?" } }],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (_runtime, _message, _state, _options, callback) => {
    const res = await fetch(`${API_BASE}/tokenomics`);
    const data = await res.json();
    callback({ text: JSON.stringify(data, null, 2) });
  },
};

const getLaunchedTokens: Action = {
  name: "GET_UNRUGGABLE_TOKENS",
  description: "List all tokens launched on the Unruggable Launcher with metadata, images, and reactor addresses.",
  similes: ["launched tokens", "unruggable tokens", "meme tokens base"],
  examples: [
    [{ user: "user1", content: { text: "What tokens have been launched on Unruggable?" } }],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (_runtime, _message, _state, _options, callback) => {
    const res = await fetch(`${API_BASE}/all`);
    const data = await res.json();
    callback({ text: JSON.stringify(data, null, 2) });
  },
};

const getTokenMetadata: Action = {
  name: "GET_UNRUGGABLE_TOKEN_INFO",
  description: "Get metadata for a specific token launched on Unruggable, including name, symbol, reactor address, seed amount, and image.",
  similes: ["token info", "token metadata", "token details"],
  examples: [
    [{ user: "user1", content: { text: "Tell me about this Unruggable token: 0x..." } }],
  ] as ActionExample[][],
  validate: async () => true,
  handler: async (_runtime, message, _state, _options, callback) => {
    const match = message.content.text.match(/0x[0-9a-fA-F]{40}/);
    if (!match) {
      callback({ text: "Please provide a token address (0x...)." });
      return;
    }
    const res = await fetch(`${API_BASE}/metadata/${match[0]}`);
    const data = await res.json();
    callback({ text: JSON.stringify(data, null, 2) });
  },
};

export const unruggablePlugin: Plugin = {
  name: "unruggable",
  description: "Unruggable Launcher on Base — infrastructure token data, launched tokens, reactor chain mechanics. MfT/BB/EB are index funds for the network.",
  actions: [getTokenomics, getLaunchedTokens, getTokenMetadata],
  evaluators: [],
  providers: [],
};

export default unruggablePlugin;
