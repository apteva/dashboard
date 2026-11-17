/** Structural contract exposed by Conversations 0.24.19 and later. */
export interface ConversationComposerHandle {
  insertText(text: string, options?: {
    requestId?: string; projectId?: string; agentId?: number;
    conversationId?: string; focus?: boolean;
  }): Promise<{ requestId: string; status: string; conversationId?: string }>;
}

export interface HelperDraftRequest {
  id: string;
  text: string;
  projectId: string;
  agentId: number;
}

export function helperDraftRequest(text: string | undefined, projectId: string, agentId: number): HelperDraftRequest {
  return { id: crypto.randomUUID(), text: text || "Help me build in this project.", projectId, agentId };
}

export const helperWelcomeSettings = {
  welcome_text: "What would you like to build? Describe your idea, and we’ll shape it using agents and apps.",
  suggestions: [
    { id: "idea", label: "Build from an idea", text: "Help me turn an idea into an agent system. Start by asking what I want to achieve." },
    { id: "explain", label: "Explain my system", text: "Explain this project’s agents and capabilities, and how they fit together." },
    { id: "try", label: "Try a small task", text: "Suggest a small useful task for the agents and apps already in this project." },
  ],
  context_label: "Discussing",
};

export function composerFallbackReason(status: string): string {
  switch (status) {
    case "wrong_project": return "This conversation belongs to another project. Open the correct conversation before inserting.";
    case "wrong_agent": return "This conversation is for another agent. Open Helper’s conversation before inserting.";
    case "conversation_not_open": return "Open or create a conversation to insert this suggestion.";
    case "archived": return "This conversation is archived. Open an active conversation to insert this suggestion.";
    case "voice_active": return "Finish the voice session before inserting this suggestion.";
    case "empty_text": return "The suggestion contains no text.";
    case "unavailable": return "Open a conversation to insert this suggestion. Older Conversations versions support copying instead.";
    default: return "The suggestion could not be inserted. Try again or copy it into the conversation.";
  }
}
