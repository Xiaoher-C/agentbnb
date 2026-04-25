import type { NodeProps } from 'reactflow';
import type { SkillFlowNodeData } from '../layout.js';
import { useInspector } from '../InspectorContext.js';
import {
  NODE_TYPE_CONFIG,
  resolveToolCallIcon,
  resolveToolCallSubtype,
} from '../nodeTypeConfig.js';
import BaseNode from './BaseNode.js';

const EMPTY: readonly never[] = [];
const CONFIG = NODE_TYPE_CONFIG['tool-call'];

/**
 * Pull a command string out of a ToolCall node. Parser may attach it as a
 * `hints.command` string — if absent, the content's first line is the next
 * best signal (ToolCall content is usually the command invocation itself).
 */
function commandOf(data: SkillFlowNodeData): string {
  const hint = data.node.hints?.command;
  if (typeof hint === 'string' && hint.trim()) return hint;
  const firstLine = data.node.content.split('\n').find((l) => l.trim());
  return firstLine ?? '';
}

export default function ToolCallNode(props: NodeProps<SkillFlowNodeData>): JSX.Element {
  const { overlay, provenanceState, risksByNode, selectedNodeId } = useInspector();
  const command = commandOf(props.data);
  const icon = resolveToolCallIcon(command);
  const subTypeChip = resolveToolCallSubtype(command);

  return (
    <BaseNode
      {...props}
      accent={CONFIG.color}
      typeLabel={CONFIG.label}
      icon={icon}
      borderStyle={CONFIG.borderStyle}
      subTypeChip={subTypeChip}
      risks={risksByNode.get(props.id) ?? EMPTY}
      overlay={overlay}
      provenanceState={provenanceState}
      isAnySelected={selectedNodeId !== null}
    />
  );
}
