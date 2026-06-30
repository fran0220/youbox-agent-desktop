package agent

// EventCallback is invoked for key WebSocket lifecycle events.
type EventCallback func(userID, event string, properties map[string]interface{})

// AgentEndCallback is invoked when the Pi agent finishes processing (agent_end event).
type AgentEndCallback func(userID, sessionKey string)
