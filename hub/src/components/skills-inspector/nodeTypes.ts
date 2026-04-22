import type { NodeTypes } from 'reactflow';
import TriggerNode from './nodes/Trigger.js';
import DecisionNode from './nodes/Decision.js';
import InstructionNode from './nodes/Instruction.js';
import ToolCallNode from './nodes/ToolCall.js';
import ExampleNode from './nodes/Example.js';
import ReferenceNode from './nodes/Reference.js';
import OutputShapeNode from './nodes/OutputShape.js';

/**
 * Map NodeType → React Flow component. Keys must match the `type` field
 * emitted by the Layer 1 parser (packages/skill-inspector/src/types.ts).
 * Declared once as a module-level const so React Flow does not recompute
 * equality on every canvas render.
 */
export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  decision: DecisionNode,
  instruction: InstructionNode,
  'tool-call': ToolCallNode,
  example: ExampleNode,
  reference: ReferenceNode,
  'output-shape': OutputShapeNode,
};
