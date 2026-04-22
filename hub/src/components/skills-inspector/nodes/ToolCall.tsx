import type { NodeProps } from 'reactflow';
import type { SkillFlowNodeData } from '../layout.js';
import { useInspector } from '../InspectorContext.js';
import BaseNode from './BaseNode.js';

const EMPTY: readonly never[] = [];

export default function ToolCallNode(props: NodeProps<SkillFlowNodeData>): JSX.Element {
  const { overlay, provenanceState, risksByNode } = useInspector();
  return (
    <BaseNode
      {...props}
      accent="#C084FC"
      icon="⚙"
      typeLabel="Tool Call"
      risks={risksByNode.get(props.id) ?? EMPTY}
      overlay={overlay}
      provenanceState={provenanceState}
    />
  );
}
