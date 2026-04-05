import { SessionManager } from './session-manager.js';
import {
  SESSION_MESSAGE_TYPES,
  SessionOpenMessageSchema,
  SessionMessageMessageSchema,
  SessionEndMessageSchema,
} from './session-types.js';

/**
 * Thin adapter that wires SessionManager into the relay's message handler.
 *
 * Returns a handler function that checks if a parsed relay message is a
 * session type and routes it to the SessionManager. Returns true if the
 * message was handled, false otherwise (so the relay continues with
 * normal processing).
 */
export function attachSessionHandler(opts: {
  sessionManager: SessionManager;
}): {
  /**
   * Attempt to handle a relay message as a session message.
   * @param msg - Parsed relay message (already validated by RelayMessageSchema).
   * @param senderKey - Connection key of the sender.
   * @returns true if handled, false if not a session message type.
   */
  handleSessionMessage(msg: { type: string; [key: string]: unknown }, senderKey: string): boolean;
} {
  const { sessionManager } = opts;

  return {
    handleSessionMessage(msg: { type: string; [key: string]: unknown }, senderKey: string): boolean {
      if (!SESSION_MESSAGE_TYPES.has(msg.type)) return false;

      switch (msg.type) {
        case 'session_open': {
          const parsed = SessionOpenMessageSchema.parse(msg);
          sessionManager.openSession(parsed, senderKey);
          return true;
        }
        case 'session_message': {
          const parsed = SessionMessageMessageSchema.parse(msg);
          sessionManager.routeMessage(parsed, senderKey);
          return true;
        }
        case 'session_end': {
          const parsed = SessionEndMessageSchema.parse(msg);
          sessionManager.endSession(parsed, senderKey);
          return true;
        }
        // session_ack, session_settled, session_error are relay→agent only
        // They should not arrive from agents, but we silently absorb them
        case 'session_ack':
        case 'session_settled':
        case 'session_error':
          return true;
        default:
          return false;
      }
    },
  };
}
