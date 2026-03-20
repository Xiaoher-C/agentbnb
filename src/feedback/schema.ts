import { z } from 'zod';

/**
 * Zod schema for structured feedback submitted after a capability transaction.
 * All fields are required unless marked optional.
 */
export const StructuredFeedbackSchema = z.object({
  transaction_id: z.string().uuid(),  // must match a request_log entry id
  provider_agent: z.string().min(1),
  skill_id: z.string().min(1),
  requester_agent: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  latency_ms: z.number().int().min(0),
  result_quality: z.enum(['excellent', 'good', 'acceptable', 'poor', 'failed']),
  quality_details: z.string().max(500).optional(),
  would_reuse: z.boolean(),
  cost_value_ratio: z.enum(['great', 'fair', 'overpriced']),
  timestamp: z.string().datetime(),
});

export type StructuredFeedback = z.infer<typeof StructuredFeedbackSchema>;

/**
 * Response shape returned by POST /api/feedback on success.
 */
export const FeedbackResponseSchema = z.object({
  feedback_id: z.string().uuid(),
  received_at: z.string().datetime(),
});

export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
